import { randomUUID } from "node:crypto";
import { importRowLimit } from "./import-limit.js";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  previewOpeningBalanceImport,
  createDepartment,
  createEmployee,
  createTreasuryAccount,
  assertTreasuryLedgerAccount,
  cashAndBankHeader,
  DuplicateAccountCodeError,
  InvalidParentAccountError,
  InvalidTreasuryLedgerAccountError,
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
  type WarehouseRepository,
  type DocumentService,
  type StockAdjustmentDocLine,
  type OpeningBalanceImportRowInput,
  type ImportRowError,
  createAccount,
  previewChartOfAccountsImport,
  orderChartOfAccountsRows,
  previewOpeningTrialBalanceImport,
  dayBefore,
  previewHistoricalSalesImport,
  importHistoricalSalesDocuments,
  previewHistoricalImport,
  importHistoricalPurchaseDocuments,
  type Account,
  type AccountRepository,
  type FiscalPeriodRepository,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesImportGlPostingPort,
  type HistoricalSalesImportGlAccounts,
  type HistoricalSalesImportRowInput,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalImportGlPostingPort,
  type HistoricalImportGlAccounts,
  type HistoricalImportRowInput,
  AuditChangeAction,
  type AuditSink,
} from "@mezan/domain";
import { openingBalanceImportBatchSchema, type OpeningBalanceImportRowDTO } from "@mezan/contracts";
import { tenantDay } from "./tenant-day.js";
import { recordFieldChanges } from "./admin-audit.js";
import { AUDITED_CUSTOMER_FIELDS } from "./customers-routes.js";
import { AUDITED_SUPPLIER_FIELDS } from "./suppliers-routes.js";
import { AUDITED_ITEM_FIELDS } from "./items-routes.js";
import { AUDITED_TREASURY_ACCOUNT_FIELDS } from "./treasury-accounts-routes.js";
import { AUDITED_ACCOUNT_FIELDS } from "./accounts.js";

const MIGRATION_AUDIT_DETAILS = { source: "data-migration" } as const;

/**
 * Commit must be all-or-nothing, so the route needs a transaction boundary it
 * does not own. Declared here as a port rather than imported from
 * @mezan/persistence: no other production api module depends on a driver.
 */
export interface DataMigrationTransactor {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
import { callerUserId, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

/**
 * نقل البيانات (Data Migration wizard) — docs/archive/catalog/09 §"نقل البيانات":
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
  /**
   * Optional — mounts the item opening-balance step (`/opening-balances`),
   * which posts ONE `INITIAL_STOCK` stock adjustment per committed batch
   * through the real document service. Omit all three and that step is simply
   * not served.
   */
  readonly warehouses?: WarehouseRepository;
  readonly stockAdjustments?: DocumentService<StockAdjustmentDocLine>;
  readonly transact?: DataMigrationTransactor;
  readonly resolveAuthContext?: AuthContextResolver;
  /**
   * P-5 — دليل الحسابات. Mounts `/chart-of-accounts`; omit it and that step is
   * not served rather than served empty.
   */
  readonly accounts?: AccountRepository;
  readonly cashAndBankParentAccountId?: () => Promise<string | null>;
  /**
   * P-5 — ميزان المراجعة الافتتاحي. `postOpeningEntry` posts ONE balanced
   * `INITIAL_BALANCE` journal entry; `fiscalPeriods` decides the date it
   * carries (the day before the first open period). Both are required for the
   * step to be mounted.
   */
  readonly fiscalPeriods?: FiscalPeriodRepository;
  /**
   * The routed receivable and payable control accounts (D205). An opening
   * trial balance row on one of them names no party, so the commit refuses it
   * (D212) — and the preview must say so before the operator commits (D225).
   */
  readonly partyControlAccounts?: () => Promise<ReadonlyMap<string, "customer" | "supplier">>;
  readonly postOpeningEntry?: (entry: {
    readonly id: string;
    readonly date: string;
    readonly memo: string;
    readonly lines: readonly { readonly accountId: string; readonly debit: Money; readonly credit: Money }[];
  }) => Promise<void>;
  /**
   * P-5 — أرصدة العملاء/الموردين المفتوحة. These reuse the EXISTING historical
   * import path (`importHistoricalSalesDocuments` /
   * `importHistoricalPurchaseDocuments`), which is the only path that archives
   * the document AND posts its remaining balance to 1105/2100 — so the AR/AP
   * sub-ledgers and their control accounts agree the moment the migration
   * lands. Reimplementing the posting here would give a second answer.
   */
  readonly openCustomerInvoices?: {
    readonly archives: HistoricalSalesArchiveRepository;
    readonly gl?: HistoricalSalesImportGlPostingPort;
    readonly accounts?: HistoricalSalesImportGlAccounts;
    readonly now?: () => string;
  };
  readonly openSupplierInvoices?: {
    readonly archives: HistoricalPurchaseArchiveRepository;
    readonly gl?: HistoricalImportGlPostingPort;
    readonly accounts?: HistoricalImportGlAccounts;
    readonly now?: () => string;
  };
}

function toOpeningBalanceRows(rows: readonly OpeningBalanceImportRowDTO[]): OpeningBalanceImportRowInput[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    itemCode: r.itemCode,
    qty: Qty.fromMajor(r.qty),
    unitCost: Money.fromMajor(r.unitCost),
  }));
}

async function resolveDefaultBranchId(branches: BranchRepository, branchCode: string | undefined): Promise<string | undefined> {
  const all = await branches.findAll();
  if (branchCode) return all.find((b) => b.code === branchCode)?.id;
  return (all.find((b) => b.isMain) ?? all[0])?.id;
}

export function createDataMigrationRoutes(
  deps: DataMigrationRoutesDeps,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.use("*", importRowLimit());

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
    const ledgerAccounts = deps.accounts ? { accounts: deps.accounts, cashAndBankParentAccountId: deps.cashAndBankParentAccountId } : null;
    let leafHeaderRefusal: string | null = null;
    if (ledgerAccounts && rows.some((row) => !optStr(row, "glAccountId"))) {
      try {
        await cashAndBankHeader(ledgerAccounts);
      } catch (err) {
        if (!(err instanceof InvalidParentAccountError)) throw err;
        leafHeaderRefusal = err.message;
      }
    }
    let persisting = 0;
    const run = () => runStep<Record<string, unknown>, CreateTreasuryAccountCommand>(
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
        const glAccountId = optStr(row, "glAccountId");
        if (!glAccountId && leafHeaderRefusal) reasons.push(leafHeaderRefusal);
        if (glAccountId && ledgerAccounts) {
          try {
            await assertTreasuryLedgerAccount({ glAccountId }, ledgerAccounts);
          } catch (err) {
            if (!(err instanceof InvalidTreasuryLedgerAccountError)) throw err;
            reasons.push(err.message);
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
            glAccountId,
          },
        };
      },
      async (item) => {
        persisting += 1;
        const openedLeaf = async (leaf: Account) => {
          await recordFieldChanges(audit, c, {
            entity: { module: "accounting", entityType: "ACCOUNT", entityId: leaf.id },
            action: AuditChangeAction.Create,
            before: null,
            after: leaf,
            fields: AUDITED_ACCOUNT_FIELDS,
            details: { ...MIGRATION_AUDIT_DETAILS, treasuryAccountId: item.id },
          });
        };
        const account = await createTreasuryAccount(
          item,
          deps.treasuryAccounts,
          deps.accounts ? { accounts: deps.accounts, cashAndBankParentAccountId: deps.cashAndBankParentAccountId, onOpened: openedLeaf } : undefined,
        );
        await recordFieldChanges(audit, c, {
          entity: { module: "treasury", entityType: "TREASURY_ACCOUNT", entityId: account.id },
          action: AuditChangeAction.Create,
          before: null,
          after: account,
          fields: AUDITED_TREASURY_ACCOUNT_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
      },
      commit,
    );
    let result: DataMigrationStepResult;
    try {
      result = commit && deps.transact ? await deps.transact.run(run) : await run();
    } catch (err) {
      const conflict = err instanceof DuplicateAccountCodeError;
      if (!conflict && !(err instanceof InvalidParentAccountError) && !(err instanceof InvalidTreasuryLedgerAccountError)) throw err;
      return c.json({ validCount: 0, errors: [{ rowNumber: persisting, reasons: [err.message] }] }, conflict ? 409 : 422);
    }
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
        await recordFieldChanges(audit, c, {
          entity: { module: "purchases", entityType: "SUPPLIER", entityId: item.id },
          action: AuditChangeAction.Create,
          before: null,
          after: item,
          fields: AUDITED_SUPPLIER_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
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
        await recordFieldChanges(audit, c, {
          entity: { module: "sales", entityType: "CUSTOMER", entityId: item.id },
          action: AuditChangeAction.Create,
          before: null,
          after: item,
          fields: AUDITED_CUSTOMER_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
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
        const created = await createItem(item, deps.items);
        await recordFieldChanges(audit, c, {
          entity: { module: "inventory", entityType: "ITEM", entityId: created.id },
          action: AuditChangeAction.Create,
          before: null,
          after: created,
          fields: AUDITED_ITEM_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
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
        const next = { ...item, alternateUnits: [...item.alternateUnits, ...additions] };
        await deps.items.update(next);
        await recordFieldChanges(audit, c, {
          entity: { module: "inventory", entityType: "ITEM", entityId: item.id },
          action: AuditChangeAction.Update,
          before: item,
          after: next,
          fields: AUDITED_ITEM_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
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

  // --- 10. دليل الحسابات (Chart of accounts) — P-5 ---
  const coaAccounts = deps.accounts;
  if (coaAccounts) {
    async function chartOfAccountsStep(c: Context, commit: boolean) {
      const rows = rowsOf(await readBody(c));
      const existing = await coaAccounts!.list();
      const preview = previewChartOfAccountsImport(
        rows.map((row, i) => ({
          rowNumber: i + 1,
          code: str(row, "code"),
          nameAr: str(row, "nameAr"),
          nameEn: optStr(row, "nameEn"),
          type: str(row, "type"),
          parentCode: optStr(row, "parentCode"),
          naturalBalance: optStr(row, "naturalBalance"),
          isHeader: optStr(row, "isHeader"),
        })),
        new Set(existing.map((a) => a.code)),
        new Set(existing.filter((a) => a.isHeader).map((a) => a.code)),
      );
      const errors = preview.errors.map((e) => ({ rowNumber: e.rowNumber, reasons: e.reasons }));
      if (!commit || errors.length > 0) {
        return c.json({ validCount: preview.valid.length, errors }, 200);
      }
      const idByCode = new Map(existing.map((a) => [a.code, a.id]));
      const createdIds: string[] = [];
      const write = async () => {
        for (const row of orderChartOfAccountsRows(preview.valid)) {
          const id = randomId();
          await createAccount(
            {
              id,
              code: row.code,
              nameAr: row.nameAr,
              nameEn: row.nameEn,
              type: row.type,
              naturalBalance: row.naturalBalance,
              parentId: row.parentCode ? idByCode.get(row.parentCode) ?? null : null,
              isHeader: row.isHeader,
            },
            coaAccounts!,
          );
          idByCode.set(row.code, id);
          createdIds.push(id);
        }
      };
      try {
        if (deps.transact) await deps.transact.run(write);
        else await write();
      } catch (err) {
        return c.json({ validCount: preview.valid.length, errors: [{ rowNumber: 0, reasons: [errorMessage(err)] }] }, 422);
      }
      for (const id of createdIds) {
        const account = await coaAccounts!.findById(id);
        if (!account) continue;
        await recordFieldChanges(audit, c, {
          entity: { module: "accounting", entityType: "ACCOUNT", entityId: account.id },
          action: AuditChangeAction.Create,
          before: null,
          after: account,
          fields: AUDITED_ACCOUNT_FIELDS,
          details: MIGRATION_AUDIT_DETAILS,
        });
      }
      return c.json({ validCount: preview.valid.length, errors: [], createdIds }, 201);
    }
    app.post("/chart-of-accounts/preview", gate("admin.settings.view"), (c) => chartOfAccountsStep(c, false));
    app.post("/chart-of-accounts/commit", gate("accounting.coa.manage"), (c) => chartOfAccountsStep(c, true));
  }

  function partyControlRowRefusal(code: string, kind: "customer" | "supplier"): string {
    return kind === "customer"
      ? `الحساب "${code}" حساب مراقبة العملاء ولا يُستورد رصيده من الميزان: أدخل أرصدة العملاء الافتتاحية على بطاقة كل عميل (أو باستيراد فواتيرهم المفتوحة)، واجعل مقابلها في هذا الميزان على حساب 3210. / Account "${code}" is the customer control account and cannot be imported from the trial balance: enter customer balances through the customer opening balances (or by importing their open invoices), and offset them in this trial balance with account 3210.`
      : `الحساب "${code}" حساب مراقبة الموردين ولا يُستورد رصيده من الميزان: أدخل أرصدة الموردين الافتتاحية على بطاقة كل مورد (أو باستيراد فواتيرهم المفتوحة)، واجعل مقابلها في هذا الميزان على حساب 3210. / Account "${code}" is the supplier control account and cannot be imported from the trial balance: enter supplier balances through the supplier opening balances (or by importing their open invoices), and offset them in this trial balance with account 3210.`;
  }

  // --- 11. ميزان المراجعة الافتتاحي (Opening trial balance) — P-5 ---
  const tbAccounts = deps.accounts;
  const tbPeriods = deps.fiscalPeriods;
  const tbPost = deps.postOpeningEntry;
  if (tbAccounts && tbPeriods && tbPost) {
    /**
     * The opening entry is dated the day BEFORE the first open period — that is
     * what an opening balance is: the state of the books before trading starts.
     *
     * INVARIANT: posting is only ever allowed into an OPEN period. With
     * contiguous periods the day before the first open one belongs to a closed
     * period (or to none at all), so the date falls back to the first open
     * period's own start date. The fallback is REPORTED, never silent: the
     * preview shows the operator the exact date the entry will carry before
     * they commit it.
     */
    async function openingDateFor(
      requested: string | undefined,
    ): Promise<{ date: string; adjusted: boolean; noteAr: string | null } | { refusal: string }> {
      if (requested) {
        const period = await tbPeriods!.findByDate(requested);
        if (!period) return { refusal: `لا توجد فترة مالية تشمل ${requested} — أنشئ الفترة أولاً.` };
        if (period.status !== "open") return { refusal: `الفترة المالية التي تشمل ${requested} ليست مفتوحة للترحيل.` };
        return { date: requested, adjusted: false, noteAr: null };
      }
      const open = (await tbPeriods!.list())
        .filter((p) => p.status === "open")
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      const first = open[0];
      if (!first) return { refusal: "لا توجد فترة مالية مفتوحة — أنشئ السنة المالية أولاً." };
      const preferred = dayBefore(first.startDate);
      const period = await tbPeriods!.findByDate(preferred);
      if (period && period.status === "open") return { date: preferred, adjusted: false, noteAr: null };
      return {
        date: first.startDate,
        adjusted: true,
        noteAr: `اليوم السابق لأول فترة مفتوحة (${preferred}) لا يقع في فترة مالية مفتوحة، فسيُرحَّل الرصيد الافتتاحي بتاريخ ${first.startDate}. افتح الفترة السابقة إن أردت ترحيله قبل بداية السنة.`,
      };
    }

    async function openingTrialBalanceStep(c: Context, commit: boolean) {
      const body = (await c.req.json()) as { rows?: unknown; date?: unknown };
      const rows = rowsOf(body);
      const preview = previewOpeningTrialBalanceImport(
        rows.map((row, i) => ({
          rowNumber: i + 1,
          accountCode: str(row, "accountCode"),
          debit: Money.fromMajor(str(row, "debit") || "0"),
          credit: Money.fromMajor(str(row, "credit") || "0"),
        })),
      );
      const errors = preview.errors.map((e) => ({ rowNumber: e.rowNumber, reasons: e.reasons }));

      const byCode = new Map((await tbAccounts!.list()).map((a) => [a.code, a]));
      const partyControls = (await deps.partyControlAccounts?.()) ?? new Map<string, "customer" | "supplier">();
      const lines: { accountId: string; debit: Money; credit: Money }[] = [];
      for (const row of preview.valid) {
        const account = byCode.get(row.accountCode);
        if (!account) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب بالكود "${row.accountCode}" غير موجود`] });
          continue;
        }
        if (account.isHeader) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب "${row.accountCode}" حساب رئيسي ولا يقبل الترحيل`] });
          continue;
        }
        if (account.status !== "active") {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب "${row.accountCode}" غير نشط`] });
          continue;
        }
        const partyKind = partyControls.get(account.id);
        if (partyKind) {
          errors.push({ rowNumber: row.rowNumber, reasons: [partyControlRowRefusal(row.accountCode, partyKind)] });
          continue;
        }
        lines.push({ accountId: account.id, debit: row.debit, credit: row.credit });
      }
      errors.sort((a, b) => a.rowNumber - b.rowNumber);

      const summary = {
        validCount: lines.length,
        errors,
        totalDebit: preview.totalDebit.toString(),
        totalCredit: preview.totalCredit.toString(),
        difference: preview.difference.toString(),
        balanced: preview.balanced,
      };
      const requestedDate = typeof body.date === "string" && body.date.trim() !== "" ? body.date.trim() : undefined;
      const resolved = await openingDateFor(requestedDate);
      if (!commit) {
        return c.json({
          ...summary,
          date: "refusal" in resolved ? null : resolved.date,
          dateAdjusted: "refusal" in resolved ? false : resolved.adjusted,
          dateNoteAr: "refusal" in resolved ? null : resolved.noteAr,
          refusal: "refusal" in resolved ? resolved.refusal : null,
        });
      }
      if (errors.length > 0 || lines.length === 0) return c.json(summary, 422);
      if (!preview.balanced) {
        return c.json(
          {
            ...summary,
            errors: [
              {
                rowNumber: 0,
                reasons: [`الميزان غير متوازن: المدين ${preview.totalDebit.toString()} والدائن ${preview.totalCredit.toString()} — الفرق ${preview.difference.toString()}`],
              },
            ],
          },
          422,
        );
      }
      if ("refusal" in resolved) {
        return c.json({ ...summary, errors: [{ rowNumber: 0, reasons: [resolved.refusal] }] }, 422);
      }
      const entryId = `OPENING-TB:${resolved.date}`;
      try {
        await tbPost!({ id: entryId, date: resolved.date, memo: "الرصيد الافتتاحي", lines });
      } catch (err) {
        return c.json({ ...summary, errors: [{ rowNumber: 0, reasons: [errorMessage(err)] }] }, 422);
      }
      return c.json(
        { ...summary, errors: [], date: resolved.date, dateAdjusted: resolved.adjusted, dateNoteAr: resolved.noteAr, createdIds: [entryId] },
        201,
      );
    }
    app.post("/opening-trial-balance/preview", gate("admin.settings.view"), (c) => openingTrialBalanceStep(c, false));
    app.post("/opening-trial-balance/commit", gate("accounting.journal.create"), (c) => openingTrialBalanceStep(c, true));
  }

  // --- 12. فواتير العملاء المفتوحة (Open customer invoices) — P-5 ---
  const openCustomer = deps.openCustomerInvoices;
  if (openCustomer) {
    function toSalesRows(rows: readonly Record<string, unknown>[]): HistoricalSalesImportRowInput[] {
      return rows.map((row, i) => ({
        rowNumber: i + 1,
        docType: "SALES_INVOICE" as const,
        documentNumber: str(row, "documentNumber"),
        customerId: str(row, "customerId"),
        date: str(row, "date"),
        dueDate: optStr(row, "dueDate") ?? null,
        itemId: optStr(row, "itemId") ?? null,
        description: optStr(row, "description") ?? null,
        qty: Qty.fromMajor(str(row, "qty") || "1"),
        unitCost: Money.fromMajor(str(row, "unitPrice") || str(row, "unitCost") || "0"),
        amountPaid: Money.fromMajor(str(row, "amountPaid") || "0"),
      }));
    }

    app.post("/open-customer-invoices/preview", gate("admin.settings.view"), async (c) => {
      const rows = toSalesRows(rowsOf(await readBody(c)));
      const preview = previewHistoricalSalesImport(rows);
      return c.json({
        validCount: preview.groups.length,
        errors: preview.errors,
        documents: preview.groups.map((g) => ({
          documentNumber: g.documentNumber,
          customerId: g.customerId,
          date: g.date,
          total: g.total.toString(),
          amountPaid: g.amountPaid.toString(),
          remainingBalance: g.remainingBalance.toString(),
          settled: g.settled,
        })),
      });
    });

    app.post("/open-customer-invoices/commit", gate("sales.invoice.create"), async (c) => {
      const rows = toSalesRows(rowsOf(await readBody(c)));
      const result = await importHistoricalSalesDocuments(
        {
          importBatchId: `MIG-AR-${randomId()}`,
          rows,
          createdBy: getAuthContext(c)?.userId ?? "system",
        },
        openCustomer,
      );
      const errors = [...result.errors];
      return c.json(
        { validCount: result.archived.length, errors, createdIds: result.archived.map((a) => a.id) },
        errors.length > 0 ? 422 : 201,
      );
    });
  }

  // --- 13. فواتير الموردين المفتوحة (Open supplier invoices) — P-5 ---
  const openSupplier = deps.openSupplierInvoices;
  if (openSupplier) {
    function toPurchaseRows(rows: readonly Record<string, unknown>[]): HistoricalImportRowInput[] {
      return rows.map((row, i) => ({
        rowNumber: i + 1,
        docType: "PURCHASE_INVOICE" as const,
        documentNumber: str(row, "documentNumber"),
        supplierId: str(row, "supplierId"),
        date: str(row, "date"),
        dueDate: optStr(row, "dueDate") ?? null,
        itemId: optStr(row, "itemId") ?? null,
        description: optStr(row, "description") ?? null,
        qty: Qty.fromMajor(str(row, "qty") || "1"),
        unitCost: Money.fromMajor(str(row, "unitCost") || str(row, "unitPrice") || "0"),
        amountPaid: Money.fromMajor(str(row, "amountPaid") || "0"),
      }));
    }

    app.post("/open-supplier-invoices/preview", gate("admin.settings.view"), async (c) => {
      const rows = toPurchaseRows(rowsOf(await readBody(c)));
      const preview = previewHistoricalImport(rows);
      return c.json({
        validCount: preview.groups.length,
        errors: preview.errors,
        documents: preview.groups.map((g) => ({
          documentNumber: g.documentNumber,
          supplierId: g.supplierId,
          date: g.date,
          total: g.total.toString(),
          amountPaid: g.amountPaid.toString(),
          remainingBalance: g.remainingBalance.toString(),
          settled: g.settled,
        })),
      });
    });

    app.post("/open-supplier-invoices/commit", gate("purchases.invoice.create"), async (c) => {
      const rows = toPurchaseRows(rowsOf(await readBody(c)));
      const result = await importHistoricalPurchaseDocuments(
        {
          importBatchId: `MIG-AP-${randomId()}`,
          rows,
          createdBy: getAuthContext(c)?.userId ?? "system",
        },
        openSupplier,
      );
      const errors = [...result.errors];
      return c.json(
        { validCount: result.archived.length, errors, createdIds: result.archived.map((a) => a.id) },
        errors.length > 0 ? 422 : 201,
      );
    });
  }

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
    const chartAccounts = deps.accounts ? (await deps.accounts.list()).length : 0;
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
      accounts: chartAccounts,
      ...historical,
    });
  });


  // --- item opening balances (one warehouse per batch — chosen once, not per row) ---
  const openingBalanceWarehouses = deps.warehouses;
  const openingBalanceAdjustments = deps.stockAdjustments;
  if (openingBalanceWarehouses && openingBalanceAdjustments) {
    async function resolveOpeningBalanceLines(c: Context, body: unknown) {
      const parsed = openingBalanceImportBatchSchema.safeParse(body);
      if (!parsed.success) {
        return { response: c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400) } as const;
      }
      const warehouse = await openingBalanceWarehouses!.findById(parsed.data.warehouseId);
      if (!warehouse) {
        return { response: c.json({ error: "WAREHOUSE_NOT_FOUND" }, 404) } as const;
      }
      const preview = previewOpeningBalanceImport(toOpeningBalanceRows(parsed.data.rows));
      const errors: ImportRowError[] = [...preview.errors];
      const lines: { itemId: string; qty: Qty; unitCost: Money }[] = [];
      for (const row of preview.valid) {
        const item = await deps.items.findByCode(row.itemCode);
        if (!item) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الصنف بالكود "${row.itemCode}" غير موجود`] });
          continue;
        }
        if (item.trackBatches || item.trackExpiry) {
          errors.push({
            rowNumber: row.rowNumber,
            reasons: [
              `الصنف "${row.itemCode}" يتتبع التشغيلات والصلاحية: أدخل رصيده الافتتاحي من شاشة تسويات المخزون مع رقم التشغيلة وتاريخ الصلاحية / Item "${row.itemCode}" tracks batches and expiry: enter its opening balance from the stock adjustments screen with the batch and expiry`,
            ],
          });
          continue;
        }
        lines.push({ itemId: item.id, qty: row.qty, unitCost: row.unitCost });
      }
      errors.sort((a, b) => a.rowNumber - b.rowNumber);
      return { data: parsed.data, lines, errors } as const;
    }

    app.post("/opening-balances/preview", gate("inventory.adjustment.create"), async (c) => {
      const body = await c.req.json();
      const resolved = await resolveOpeningBalanceLines(c, body);
      if ("response" in resolved) return resolved.response;
      const total = (body as { rows?: unknown[] }).rows?.length ?? 0;
      return c.json({ validCount: resolved.lines.length, total, errors: resolved.errors });
    });

    app.post("/opening-balances/commit", gate("inventory.adjustment.create"), async (c) => {
      const body = await c.req.json();
      const resolved = await resolveOpeningBalanceLines(c, body);
      if ("response" in resolved) return resolved.response;
      const total = (body as { rows?: unknown[] }).rows?.length ?? 0;
      if (resolved.errors.length > 0 || resolved.lines.length === 0) {
        return c.json({ validCount: resolved.lines.length, total, errors: resolved.errors }, 422);
      }
      try {
        const draft = await openingBalanceAdjustments!.createDraft({
          id: randomUUID(),
          date: await tenantDay(c, resolved.data.date),
          memo: "استيراد أرصدة افتتاحية",
          lines: resolved.lines.map((l) => ({
            itemId: l.itemId,
            warehouseId: resolved.data.warehouseId,
            reason: "INITIAL_STOCK",
            direction: "IN",
            qty: l.qty,
            unitCost: l.unitCost,
          })),
        });
        const { document } = await openingBalanceAdjustments!.confirm(draft.id, { actor: callerUserId(c) });
        return c.json({ validCount: resolved.lines.length, total, errors: [], createdIds: [document.id] }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: "OPENING_BALANCE_IMPORT_FAILED", message }, 422);
      }
    });
  }

  return app;
}
