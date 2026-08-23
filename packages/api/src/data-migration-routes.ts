import { Hono, type Context } from "hono";
import {
  Money,
  createDepartment,
  createEmployee,
  createTreasuryAccount,
  createSupplier,
  createCustomer,
  createItem,
  createAssetCategory,
  createAsset,
  type DepartmentRepository,
  type EmployeeRepository,
  type TreasuryAccountRepository,
  type SupplierRepository,
  type CustomerRepository,
  type ItemRepository,
  type AssetCategoryRepository,
  type AssetRepository,
  type BranchRepository,
  type CreateDepartmentCommand,
  type CreateEmployeeCommand,
  type CreateTreasuryAccountCommand,
  type Supplier,
  type Customer,
  type CreateItemCommand,
  type CreateAssetCategoryCommand,
  type CreateAssetCommand,
  type AlternateUnit,
} from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * نقل البيانات (Data Migration wizard) — docs/catalog/09 §"نقل البيانات":
 * the one-time go-live bulk-import tool. This module covers the 9
 * MASTER-DATA steps (steps 1-9 of the 13-step dependency-ordered import —
 * الأقسام، الموظفين، حسابات الخزينة، الموردين، العملاء، الأصناف، وحدات
 * الأصناف، تصنيفات الأصول، الأصول الثابتة). Each row-batch commits an
 * ALL-OR-NOTHING transaction: every row is validated FIRST (against the
 * already-persisted list AND against every other row in the same batch); if
 * even one row fails, NOTHING in the batch is persisted and every error is
 * reported back so the whole file can be fixed and re-submitted. Preview is
 * the identical validation pass with no persistence at all (a pure dry-run).
 *
 * The 4 HISTORICAL-DOCUMENT steps (10-13: فواتير/مرتجعات المبيعات/المشتريات
 * السابقة) are NOT here — they reuse the existing
 * `/purchases/historical-import` routes and the sibling
 * `/sales/historical-import` routes directly (docType selects
 * invoice-vs-return), since that machinery already implements the
 * settled/partial-balance archive rule this wizard also promises for those
 * steps. This module's `GET /status` endpoint separately accepts optional
 * historical-document counts (via `deps.historicalCounts`) so the wizard can
 * show one unified "registered: N" badge set across all 13 steps.
 */

// --- Shared row-batch engine -------------------------------------------------

export interface DataMigrationRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}

export interface DataMigrationStepResult {
  readonly validCount: number;
  readonly errors: readonly DataMigrationRowError[];
  /** Only present on a successful commit (empty `errors`, `commit: true`). */
  readonly createdIds?: readonly string[];
}

interface BuiltRow<T> {
  readonly id: string;
  readonly item: T;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const reasons = (err as { reasons?: readonly string[] }).reasons;
    if (reasons && reasons.length > 0) return reasons.join("، ");
    return err.message;
  }
  return String(err);
}

/**
 * Runs one row-batch through `build` (validation + domain-object
 * construction, no I/O beyond read-only lookups), then — only when `commit`
 * is true AND every row built cleanly — persists every built row via
 * `persist`. Any row-level failure (or `commit: false`) short-circuits
 * persistence entirely: all-or-nothing.
 */
async function runStep<TRow, TItem>(
  rows: readonly TRow[],
  build: (row: TRow, rowNumber: number, seenCodes: Set<string>) => Promise<BuiltRow<TItem> | DataMigrationRowError>,
  persist: (item: TItem) => Promise<void>,
  commit: boolean,
): Promise<DataMigrationStepResult> {
  const errors: DataMigrationRowError[] = [];
  const built: BuiltRow<TItem>[] = [];
  const seenCodes = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1;
    try {
      const result = await build(rows[i] as TRow, rowNumber, seenCodes);
      if ("reasons" in result) errors.push(result);
      else built.push(result);
    } catch (err) {
      errors.push({ rowNumber, reasons: [errorMessage(err)] });
    }
  }

  if (!commit || errors.length > 0) {
    return { validCount: built.length, errors };
  }

  for (const row of built) await persist(row.item);
  return { validCount: built.length, errors: [], createdIds: built.map((r) => r.id) };
}

function str(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

function optStr(row: Record<string, unknown>, key: string): string | undefined {
  const v = str(row, key);
  return v === "" ? undefined : v;
}

function optNum(row: Record<string, unknown>, key: string): number | undefined {
  const v = optStr(row, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function checkDuplicateInBatch(code: string, seenCodes: Set<string>, reasons: string[]): void {
  if (seenCodes.has(code)) reasons.push(`الكود "${code}" مكرر في نفس الملف`);
  else seenCodes.add(code);
}

const randomId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// --- Deps --------------------------------------------------------------------

export interface DataMigrationRoutesDeps {
  readonly departments: DepartmentRepository;
  readonly employees: EmployeeRepository;
  readonly treasuryAccounts: TreasuryAccountRepository;
  readonly suppliers: SupplierRepository;
  readonly customers: CustomerRepository;
  readonly items: ItemRepository;
  readonly assetCategories: AssetCategoryRepository;
  readonly assets: AssetRepository;
  readonly branches: BranchRepository;
  /** Optional counts for the 4 historical-document steps, aggregated from the sales/purchases historical-import archives, so `GET /status` can report all 13 steps in one call. */
  readonly historicalCounts?: () => Promise<{
    salesInvoices: number;
    salesReturns: number;
    purchaseInvoices: number;
    purchaseReturns: number;
  }>;
  readonly resolveAuthContext?: AuthContextResolver;
}

async function resolveDefaultBranchId(branches: BranchRepository, branchCode: string | undefined): Promise<string | undefined> {
  const all = await branches.findAll();
  if (branchCode) return all.find((b) => b.code === branchCode)?.id;
  return (all.find((b) => b.isMain) ?? all[0])?.id;
}

export function createDataMigrationRoutes(
  deps: DataMigrationRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function readBody(c: Context) {
    return c.req.json() as Promise<{ rows?: unknown }>;
  }

  function rowsOf(body: { rows?: unknown }): Record<string, unknown>[] {
    return Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  }

  // --- 1. الأقسام (Departments) ---
  async function departmentsStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.departments.list();
    const existingCodes = new Set(existing.map((d) => d.code));
    const result = await runStep<Record<string, unknown>, CreateDepartmentCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const nameEn = optStr(row, "nameEn");
        const reasons: string[] = [];
        if (!code) reasons.push("كود القسم مطلوب");
        if (!nameAr) reasons.push("اسم القسم مطلوب");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`القسم بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        // `name` is the department's required primary name field (mirrors the
        // real hr/master-data `CreateDepartmentCommand` — English/primary
        // name required, `nameAr` optional) — this Arabic-first wizard feeds
        // the Arabic value into both when no separate English name is given.
        return { id, item: { id, code, name: nameEn ?? nameAr, nameAr } };
      },
      async (item) => {
        await createDepartment(item, deps.departments);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/departments/preview", gate("admin.settings.view"), (c) => departmentsStep(c, false));
  app.post("/departments/commit", gate("admin.settings.edit"), (c) => departmentsStep(c, true));

  // --- 2. الموظفين (Employees) ---
  async function employeesStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const [existing, departments] = await Promise.all([deps.employees.list(), deps.departments.list()]);
    const existingCodes = new Set(existing.map((e) => e.code));
    const result = await runStep<Record<string, unknown>, CreateEmployeeCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const departmentCode = str(row, "departmentCode");
        const hireDate = str(row, "hireDate");
        const reasons: string[] = [];
        if (!code) reasons.push("كود الموظف مطلوب");
        if (!nameAr) reasons.push("اسم الموظف مطلوب");
        if (!hireDate) reasons.push("تاريخ التعيين مطلوب");
        const department = departmentCode ? departments.find((d) => d.code === departmentCode) : undefined;
        if (departmentCode && !department) reasons.push(`القسم بالكود "${departmentCode}" غير موجود — استورد الأقسام أولاً`);
        if (code) {
          if (existingCodes.has(code)) reasons.push(`الموظف بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        const branchId = await resolveDefaultBranchId(deps.branches, optStr(row, "branchCode"));
        if (!branchId) reasons.push("لا يوجد فرع لربط الموظف به — أضف فرعًا أولاً");
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        // The real `CreateEmployeeCommand` (hr/master-data) requires
        // firstName/lastName rather than one Arabic display name — split the
        // migration file's single "nameAr" column best-effort so this thin
        // wizard doesn't force a two-column name entry the catalog doesn't ask for.
        const [firstName, ...rest] = nameAr.split(/\s+/);
        const lastName = rest.length > 0 ? rest.join(" ") : firstName;
        return {
          id,
          item: {
            id,
            code,
            firstName: firstName!,
            lastName: lastName!,
            firstNameAr: firstName,
            lastNameAr: rest.length > 0 ? rest.join(" ") : null,
            departmentId: department?.id ?? null,
            branchId: branchId!,
            hireDate,
            phone: optStr(row, "phone") ?? null,
            email: optStr(row, "email") ?? null,
          },
        };
      },
      async (item) => {
        await createEmployee(item, deps.employees);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/employees/preview", gate("admin.settings.view"), (c) => employeesStep(c, false));
  app.post("/employees/commit", gate("admin.settings.edit"), (c) => employeesStep(c, true));

  // --- 3. حسابات الخزينة (Treasury accounts) ---
  async function treasuryStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.treasuryAccounts.list();
    const existingCodes = new Set(existing.map((a) => a.code));
    const result = await runStep<Record<string, unknown>, CreateTreasuryAccountCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const name = str(row, "name");
        const typeRaw = str(row, "type").toLowerCase();
        const type = typeRaw === "bank" ? "bank" : "cash";
        const reasons: string[] = [];
        if (!code) reasons.push("كود حساب الخزينة مطلوب");
        if (!name) reasons.push("اسم حساب الخزينة مطلوب");
        const branchId = await resolveDefaultBranchId(deps.branches, optStr(row, "branchCode"));
        if (!branchId) reasons.push("لا يوجد فرع لربط الحساب به — أضف فرعًا أولاً");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`حساب الخزينة بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        const openingBalanceStr = optStr(row, "openingBalance");
        if (openingBalanceStr !== undefined && type === "cash") {
          try {
            if (Money.fromMajor(openingBalanceStr).scaled < 0n) reasons.push("لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي سالبًا");
          } catch {
            reasons.push("الرصيد الافتتاحي رقم غير صالح");
          }
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        return {
          id,
          item: {
            id,
            code,
            name,
            type,
            branchId: branchId!,
            openingBalance: openingBalanceStr,
            glAccountId: optStr(row, "glAccountId") ?? undefined,
          },
        };
      },
      async (item) => {
        await createTreasuryAccount(item, deps.treasuryAccounts);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/treasury-accounts/preview", gate("admin.settings.view"), (c) => treasuryStep(c, false));
  app.post("/treasury-accounts/commit", gate("admin.settings.edit"), (c) => treasuryStep(c, true));

  // --- 4. الموردون (Suppliers) ---
  async function suppliersStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.suppliers.findAll();
    const existingCodes = new Set(existing.map((s) => s.code));
    const result = await runStep<Record<string, unknown>, Supplier>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const reasons: string[] = [];
        if (!code) reasons.push("كود المورد مطلوب");
        if (!nameAr) reasons.push("اسم المورد مطلوب");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`المورد بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        try {
          const supplier = createSupplier({
            id,
            code,
            nameAr,
            nameEn: optStr(row, "nameEn"),
            phone: optStr(row, "phone"),
            email: optStr(row, "email"),
            taxNumber: optStr(row, "taxNumber"),
            category: optStr(row, "category"),
            paymentTermsDays: optNum(row, "paymentTermsDays"),
          });
          return { id, item: supplier };
        } catch (err) {
          return { rowNumber, reasons: [errorMessage(err)] };
        }
      },
      async (item) => {
        await deps.suppliers.save(item);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/suppliers/preview", gate("admin.settings.view"), (c) => suppliersStep(c, false));
  app.post("/suppliers/commit", gate("admin.settings.edit"), (c) => suppliersStep(c, true));

  // --- 5. العملاء (Customers) ---
  async function customersStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.customers.findAll();
    const existingCodes = new Set(existing.map((s) => s.code));
    const result = await runStep<Record<string, unknown>, Customer>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const reasons: string[] = [];
        if (!code) reasons.push("كود العميل مطلوب");
        if (!nameAr) reasons.push("اسم العميل مطلوب");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`العميل بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        try {
          const creditLimitStr = optStr(row, "creditLimit");
          const customer = createCustomer({
            id,
            code,
            nameAr,
            nameEn: optStr(row, "nameEn"),
            phone: optStr(row, "phone"),
            email: optStr(row, "email"),
            taxNumber: optStr(row, "taxNumber"),
            paymentTermsDays: optNum(row, "paymentTermsDays"),
            creditLimit: creditLimitStr !== undefined ? Money.fromMajor(creditLimitStr) : undefined,
          });
          return { id, item: customer };
        } catch (err) {
          return { rowNumber, reasons: [errorMessage(err)] };
        }
      },
      async (item) => {
        await deps.customers.save(item);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/customers/preview", gate("admin.settings.view"), (c) => customersStep(c, false));
  app.post("/customers/commit", gate("admin.settings.edit"), (c) => customersStep(c, true));

  // --- 6. الأصناف (Items) ---
  async function itemsStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.items.list();
    const existingCodes = new Set(existing.map((i) => i.code));
    const result = await runStep<Record<string, unknown>, CreateItemCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const baseUnitCode = str(row, "baseUnitCode");
        const typeRaw = str(row, "type").toLowerCase();
        const type = typeRaw === "service" ? "service" : "stock";
        const reasons: string[] = [];
        if (!code) reasons.push("كود الصنف مطلوب");
        if (!nameAr) reasons.push("اسم الصنف مطلوب");
        if (!baseUnitCode) reasons.push("وحدة القياس الأساسية مطلوبة");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`الصنف بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        const salePriceStr = optStr(row, "salePrice");
        const costPriceStr = optStr(row, "costPrice");
        try {
          return {
            id,
            item: {
              id,
              code,
              nameAr,
              nameEn: optStr(row, "nameEn"),
              type,
              baseUnitCode,
              categoryId: optStr(row, "categoryId"),
              brand: optStr(row, "brand"),
              salePrice: salePriceStr !== undefined ? Money.fromMajor(salePriceStr) : undefined,
              costPrice: costPriceStr !== undefined ? Money.fromMajor(costPriceStr) : undefined,
              taxRatePercent: optNum(row, "taxRatePercent"),
            },
          };
        } catch (err) {
          return { rowNumber, reasons: [errorMessage(err)] };
        }
      },
      async (item) => {
        await createItem(item, deps.items);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/items/preview", gate("admin.settings.view"), (c) => itemsStep(c, false));
  app.post("/items/commit", gate("admin.settings.edit"), (c) => itemsStep(c, true));

  // --- 7. وحدات الأصناف (Item alternate units) — appends to an existing item's alternateUnits list. ---
  async function itemUnitsStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existingItems = await deps.items.list();
    const byCode = new Map(existingItems.map((i) => [i.code, i]));
    // Batched per item so multiple new-unit rows for the same item accumulate onto one update.
    const pendingByItemCode = new Map<string, AlternateUnit[]>();
    const result = await runStep<Record<string, unknown>, { itemCode: string; unitCode: string; factor: number }>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const itemCode = str(row, "itemCode");
        const unitCode = str(row, "unitCode");
        const unitName = optStr(row, "unitName") ?? unitCode;
        const factor = optNum(row, "factor");
        const reasons: string[] = [];
        if (!itemCode) reasons.push("كود الصنف مطلوب");
        const item = byCode.get(itemCode);
        if (itemCode && !item) reasons.push(`الصنف بالكود "${itemCode}" غير موجود — استورد الأصناف أولاً`);
        if (!unitCode) reasons.push("كود الوحدة مطلوب");
        if (factor === undefined || factor <= 0) reasons.push("معامل التحويل يجب أن يكون رقمًا أكبر من صفر");
        const batchKey = `${itemCode}::${unitCode}`;
        checkDuplicateInBatch(batchKey, seenCodes, reasons);
        if (item && item.alternateUnits.some((u) => u.code === unitCode)) {
          reasons.push(`الوحدة "${unitCode}" مسجلة بالفعل على الصنف "${itemCode}"`);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const list = pendingByItemCode.get(itemCode) ?? [];
        list.push({ code: unitCode, name: unitName, factor: factor! });
        pendingByItemCode.set(itemCode, list);
        return { id: batchKey, item: { itemCode, unitCode, factor: factor! } };
      },
      async () => {
        // no-op per row — the real persistence happens once per item below, after every row validated cleanly.
      },
      commit,
    );
    if (commit && result.errors.length === 0) {
      const createdIds: string[] = [];
      for (const [itemCode, additions] of pendingByItemCode) {
        const item = byCode.get(itemCode)!;
        await deps.items.update({ ...item, alternateUnits: [...item.alternateUnits, ...additions] });
        createdIds.push(...additions.map((a) => `${itemCode}:${a.code}`));
      }
      return c.json({ validCount: result.validCount, errors: [], createdIds }, 201);
    }
    return c.json(result);
  }
  app.post("/item-units/preview", gate("admin.settings.view"), (c) => itemUnitsStep(c, false));
  app.post("/item-units/commit", gate("admin.settings.edit"), (c) => itemUnitsStep(c, true));

  // --- 8. تصنيفات الأصول (Asset categories) ---
  async function assetCategoriesStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const existing = await deps.assetCategories.list();
    const existingCodes = new Set(existing.map((a) => a.code));
    const result = await runStep<Record<string, unknown>, CreateAssetCategoryCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const usefulLifeMonths = optNum(row, "defaultUsefulLifeMonths");
        const salvagePercent = optNum(row, "defaultSalvagePercent") ?? 0;
        const reasons: string[] = [];
        if (!code) reasons.push("كود التصنيف مطلوب");
        if (!nameAr) reasons.push("اسم التصنيف مطلوب");
        if (usefulLifeMonths === undefined || usefulLifeMonths <= 0) reasons.push("العمر الإنتاجي (بالأشهر) يجب أن يكون أكبر من صفر");
        if (salvagePercent < 0 || salvagePercent > 100) reasons.push("نسبة القيمة التخريدية يجب أن تكون بين 0 و 100");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`تصنيف الأصول بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        return {
          id,
          item: { id, code, nameAr, nameEn: optStr(row, "nameEn"), defaultUsefulLifeMonths: usefulLifeMonths!, defaultSalvagePercent: salvagePercent },
        };
      },
      async (item) => {
        await createAssetCategory(item, deps.assetCategories);
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/asset-categories/preview", gate("admin.settings.view"), (c) => assetCategoriesStep(c, false));
  app.post("/asset-categories/commit", gate("admin.settings.edit"), (c) => assetCategoriesStep(c, true));

  // --- 9. الأصول الثابتة (Fixed assets) — registered as رصيد افتتاحي (opening balance): no GL posting, matches the catalog's "legacy assets need neither treasury nor supplier" note. ---
  async function assetsStep(c: Context, commit: boolean) {
    const rows = rowsOf(await readBody(c));
    const [existing, categories] = await Promise.all([deps.assets.list(), deps.assetCategories.list()]);
    const existingCodes = new Set(existing.map((a) => a.code));
    const result = await runStep<Record<string, unknown>, CreateAssetCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const categoryCode = str(row, "categoryCode");
        const acquisitionDate = str(row, "acquisitionDate");
        const acquisitionCostStr = optStr(row, "acquisitionCost");
        const reasons: string[] = [];
        if (!code) reasons.push("كود الأصل مطلوب");
        if (!nameAr) reasons.push("اسم الأصل مطلوب");
        const category = categories.find((cat) => cat.code === categoryCode);
        if (!categoryCode) reasons.push("كود تصنيف الأصل مطلوب");
        else if (!category) reasons.push(`تصنيف الأصول بالكود "${categoryCode}" غير موجود — استورد تصنيفات الأصول أولاً`);
        if (!acquisitionDate) reasons.push("تاريخ الاقتناء مطلوب");
        if (!acquisitionCostStr) reasons.push("تكلفة الاقتناء مطلوبة");
        if (code) {
          if (existingCodes.has(code)) reasons.push(`الأصل بالكود "${code}" مسجل بالفعل`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return { rowNumber, reasons };
        const id = randomId();
        try {
          return {
            id,
            item: {
              id,
              code,
              nameAr,
              nameEn: optStr(row, "nameEn"),
              categoryId: category!.id,
              acquisitionDate,
              acquisitionCost: Money.fromMajor(acquisitionCostStr!),
            },
          };
        } catch (err) {
          return { rowNumber, reasons: [errorMessage(err)] };
        }
      },
      async (item) => {
        await createAsset(item, { assets: deps.assets, categories: deps.assetCategories });
      },
      commit,
    );
    return c.json(result, commit && result.errors.length === 0 ? 201 : 200);
  }
  app.post("/assets/preview", gate("admin.settings.view"), (c) => assetsStep(c, false));
  app.post("/assets/commit", gate("admin.settings.edit"), (c) => assetsStep(c, true));

  // --- الحالة (Status) — per-step registered counts driving the wizard's checkmarks/badges. ---
  app.get("/status", gate("admin.settings.view"), async (c) => {
    const [departments, employees, treasuryAccounts, suppliers, customers, items, assetCategories, assets] = await Promise.all([
      deps.departments.list(),
      deps.employees.list(),
      deps.treasuryAccounts.list(),
      deps.suppliers.findAll(),
      deps.customers.findAll(),
      deps.items.list(),
      deps.assetCategories.list(),
      deps.assets.list(),
    ]);
    const itemUnits = items.reduce((sum, i) => sum + i.alternateUnits.length, 0);
    const historical = deps.historicalCounts
      ? await deps.historicalCounts()
      : { salesInvoices: 0, salesReturns: 0, purchaseInvoices: 0, purchaseReturns: 0 };
    return c.json({
      departments: departments.length,
      employees: employees.length,
      treasuryAccounts: treasuryAccounts.length,
      suppliers: suppliers.length,
      customers: customers.length,
      items: items.length,
      itemUnits,
      assetCategories: assetCategories.length,
      assets: assets.length,
      ...historical,
    });
  });

  return app;
}
