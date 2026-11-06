import { bilingualText } from "./observability/error-message-backfill.js";
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
  DuplicateTreasuryAccountCodeError,
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
  createAccount,
  previewChartOfAccountsImport,
  orderChartOfAccountsRows,
  previewOpeningTrialBalanceImport,
  previewJournalEntriesImport,
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
import { callerUserId, createPermissionGate, getAuthContext, maySeeItemCost, type AuthContextResolver } from "./permission-gate.js";

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
  readonly reasonsEn?: readonly string[];
}

class RowReasons {
  private readonly ar: string[] = [];
  private readonly en: string[] = [];
  add(ar: string, en: string): void {
    this.ar.push(ar);
    this.en.push(en);
  }
  get length(): number {
    return this.ar.length;
  }
  error(rowNumber: number): DataMigrationRowError {
    return { rowNumber, reasons: this.ar, reasonsEn: this.en };
  }
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

function errorReasons(err: unknown): { reasons: string[]; reasonsEn: string[] } {
  const ar = errorMessage(err);
  const en = err instanceof Error ? (err as { messageEn?: string }).messageEn : undefined;
  return { reasons: [ar], reasonsEn: [en && en.trim() !== "" ? en : ar] };
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
      errors.push({ rowNumber, ...errorReasons(err) });
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

function checkDuplicateInBatch(code: string, seenCodes: Set<string>, reasons: RowReasons): void {
  if (seenCodes.has(code)) reasons.add(`الكود "${code}" مكرر في نفس الملف`, `The code "${code}" is duplicated in the same file`);
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
  /**
   * القيود اليومية — historical journal entries, each on its own date. ALL the
   * entries of one file post inside ONE transaction: a migration that lands
   * half its months is worse than one that lands none. Requires `accounts`
   * and `fiscalPeriods` too.
   */
  readonly postImportedJournalEntries?: (entries: readonly {
    readonly id: string;
    readonly date: string;
    readonly memo: string;
    readonly lines: readonly { readonly accountId: string; readonly debit: Money; readonly credit: Money; readonly memo: string | null }[];
  }[], options?: { readonly createFiscalYears?: readonly number[] }) => Promise<void>;
  /**
   * When set, a date no fiscal period covers is not an error: the commit
   * creates the missing year(s) — open, in the SAME transaction as the
   * postings — because importing past months is exactly when a business has no
   * periods for them yet. A period that exists but is closed or locked is
   * still refused; this never reopens anything.
   */
  readonly createsMissingFiscalYears?: boolean;
  /** Whether an entry id is already on the ledger — a re-uploaded file must not post twice. */
  readonly journalEntryExists?: (id: string) => Promise<boolean>;
  /** Accounts every line of which must name a project; an imported line names none. */
  readonly projectRequiredAccountIds?: () => Promise<ReadonlySet<string>>;
  readonly countImportedJournalEntries?: () => Promise<number>;
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود القسم مطلوب", "The department code is required");
        if (!nameAr) reasons.add("اسم القسم مطلوب", "The department name is required");
        if (code) {
          if (existingCodes.has(code)) reasons.add(`القسم بالكود "${code}" مسجل بالفعل`, `A department with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود الموظف مطلوب", "The employee code is required");
        if (!nameAr) reasons.add("اسم الموظف مطلوب", "The employee name is required");
        if (!hireDate) reasons.add("تاريخ التعيين مطلوب", "The hire date is required");
        const department = departmentCode ? departments.find((d) => d.code === departmentCode) : undefined;
        if (departmentCode && !department) reasons.add(`القسم بالكود "${departmentCode}" غير موجود — استورد الأقسام أولاً`, `No department with the code "${departmentCode}" exists; import the departments first`);
        if (code) {
          if (existingCodes.has(code)) reasons.add(`الموظف بالكود "${code}" مسجل بالفعل`, `An employee with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        const branchId = await resolveDefaultBranchId(deps.branches, optStr(row, "branchCode"));
        if (!branchId) reasons.add("لا يوجد فرع لربط الموظف به — أضف فرعًا أولاً", "There is no branch to link the employee to; add a branch first");
        if (reasons.length > 0) return reasons.error(rowNumber);
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
    let leafHeaderRefusal: { ar: string; en: string } | null = null;
    if (ledgerAccounts && rows.some((row) => !optStr(row, "glAccountId"))) {
      try {
        await cashAndBankHeader(ledgerAccounts);
      } catch (err) {
        if (!(err instanceof InvalidParentAccountError)) throw err;
        leafHeaderRefusal = { ar: err.message, en: err.messageEn };
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود حساب الخزينة مطلوب", "The treasury account code is required");
        if (!name) reasons.add("اسم حساب الخزينة مطلوب", "The treasury account name is required");
        const branchId = await resolveDefaultBranchId(deps.branches, optStr(row, "branchCode"));
        if (!branchId) reasons.add("لا يوجد فرع لربط الحساب به — أضف فرعًا أولاً", "There is no branch to link the account to; add a branch first");
        if (code) {
          if (existingCodes.has(code)) reasons.add(`حساب الخزينة بالكود "${code}" مسجل بالفعل`, `A treasury account with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        const openingBalanceStr = optStr(row, "openingBalance");
        if (openingBalanceStr !== undefined && type === "cash") {
          try {
            if (Money.fromMajor(openingBalanceStr).scaled < 0n) reasons.add("لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي سالبًا", "The opening balance of a cash account cannot be negative");
          } catch {
            reasons.add("الرصيد الافتتاحي رقم غير صالح", "The opening balance is not a valid number");
          }
        }
        const glAccountId = optStr(row, "glAccountId");
        if (!glAccountId && leafHeaderRefusal) reasons.add(leafHeaderRefusal.ar, leafHeaderRefusal.en);
        if (glAccountId && ledgerAccounts) {
          try {
            await assertTreasuryLedgerAccount({ glAccountId }, ledgerAccounts);
          } catch (err) {
            if (!(err instanceof InvalidTreasuryLedgerAccountError)) throw err;
            reasons.add(err.message, err.messageEn);
          }
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
      const conflict = err instanceof DuplicateAccountCodeError || err instanceof DuplicateTreasuryAccountCodeError;
      if (!conflict && !(err instanceof InvalidParentAccountError) && !(err instanceof InvalidTreasuryLedgerAccountError)) throw err;
      return c.json({ validCount: 0, message: err.message, messageEn: err.messageEn, errors: [{ rowNumber: persisting, reasons: [err.message], reasonsEn: [err.messageEn] }] }, conflict ? 409 : 422);
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود المورد مطلوب", "The supplier code is required");
        if (!nameAr) reasons.add("اسم المورد مطلوب", "The supplier name is required");
        if (code) {
          if (existingCodes.has(code)) reasons.add(`المورد بالكود "${code}" مسجل بالفعل`, `A supplier with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
          return { rowNumber, ...errorReasons(err) };
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود العميل مطلوب", "The customer code is required");
        if (!nameAr) reasons.add("اسم العميل مطلوب", "The customer name is required");
        if (code) {
          if (existingCodes.has(code)) reasons.add(`العميل بالكود "${code}" مسجل بالفعل`, `A customer with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
          return { rowNumber, ...errorReasons(err) };
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود الصنف مطلوب", "The item code is required");
        if (!nameAr) reasons.add("اسم الصنف مطلوب", "The item name is required");
        if (!baseUnitCode) reasons.add("وحدة القياس الأساسية مطلوبة", "The base unit of measure is required");
        if (code) {
          if (existingCodes.has(code)) reasons.add(`الصنف بالكود "${code}" مسجل بالفعل`, `An item with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
        const id = randomId();
        const salePriceStr = optStr(row, "salePrice");
        const costPriceStr = maySeeItemCost(c) ? optStr(row, "costPrice") : undefined;
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
          return { rowNumber, ...errorReasons(err) };
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
        const reasons = new RowReasons();
        if (!itemCode) reasons.add("كود الصنف مطلوب", "The item code is required");
        const item = byCode.get(itemCode);
        if (itemCode && !item) reasons.add(`الصنف بالكود "${itemCode}" غير موجود — استورد الأصناف أولاً`, `No item with the code "${itemCode}" exists; import the items first`);
        if (!unitCode) reasons.add("كود الوحدة مطلوب", "The unit code is required");
        if (factor === undefined || factor <= 0) reasons.add("معامل التحويل يجب أن يكون رقمًا أكبر من صفر", "The conversion factor must be a number greater than zero");
        const batchKey = `${itemCode}::${unitCode}`;
        checkDuplicateInBatch(batchKey, seenCodes, reasons);
        if (item && item.alternateUnits.some((u) => u.code === unitCode)) {
          reasons.add(`الوحدة "${unitCode}" مسجلة بالفعل على الصنف "${itemCode}"`, `The unit "${unitCode}" is already registered on the item "${itemCode}"`);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
    // Optional ledger links — without them a category posts to the defaults
    // (1510 / 5400 / 1590), so a vehicles category would carry its assets on
    // the equipment account and the register would not tie to 1520.
    const chart = deps.accounts ? await deps.accounts.list() : [];
    const accountByCode = new Map(chart.map((a) => [a.code, a]));
    const result = await runStep<Record<string, unknown>, CreateAssetCategoryCommand>(
      rows,
      async (row, rowNumber, seenCodes) => {
        const code = str(row, "code");
        const nameAr = str(row, "nameAr");
        const usefulLifeMonths = optNum(row, "defaultUsefulLifeMonths");
        const salvagePercent = optNum(row, "defaultSalvagePercent") ?? 0;
        const reasons = new RowReasons();
        if (!code) reasons.add("كود التصنيف مطلوب", "The category code is required");
        if (!nameAr) reasons.add("اسم التصنيف مطلوب", "The category name is required");
        if (usefulLifeMonths === undefined || usefulLifeMonths <= 0) reasons.add("العمر الإنتاجي (بالأشهر) يجب أن يكون أكبر من صفر", "The useful life (in months) must be greater than zero");
        if (salvagePercent < 0 || salvagePercent > 100) reasons.add("نسبة القيمة التخريدية يجب أن تكون بين 0 و 100", "The salvage value percentage must be between 0 and 100");
        const linked: Record<string, string> = {};
        for (const [column, field, labelAr, labelEn] of [
          ["assetAccountCode", "assetAccountId", "حساب الأصل", "asset account"],
          ["accumulatedDepreciationAccountCode", "accumulatedDepreciationAccountId", "حساب مجمع الإهلاك", "accumulated depreciation account"],
          ["depreciationExpenseAccountCode", "depreciationExpenseAccountId", "حساب مصروف الإهلاك", "depreciation expense account"],
        ] as const) {
          const accountCode = optStr(row, column);
          if (!accountCode) continue;
          const account = accountByCode.get(accountCode);
          if (!account) reasons.add(`${labelAr} بالكود "${accountCode}" غير موجود في دليل الحسابات`, `No ${labelEn} with the code "${accountCode}" exists in the chart of accounts`);
          else if (account.isHeader) reasons.add(`${labelAr} "${accountCode}" حساب رئيسي ولا يقبل الترحيل`, `The ${labelEn} "${accountCode}" is a header account and cannot be posted to`);
          else linked[field] = account.id;
        }
        if (code) {
          if (existingCodes.has(code)) reasons.add(`تصنيف الأصول بالكود "${code}" مسجل بالفعل`, `An asset category with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
        const id = randomId();
        return {
          id,
          item: { id, code, nameAr, nameEn: optStr(row, "nameEn"), defaultUsefulLifeMonths: usefulLifeMonths!, defaultSalvagePercent: salvagePercent, ...linked },
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
        const reasons = new RowReasons();
        if (!code) reasons.add("كود الأصل مطلوب", "The asset code is required");
        if (!nameAr) reasons.add("اسم الأصل مطلوب", "The asset name is required");
        const category = categories.find((cat) => cat.code === categoryCode);
        if (!categoryCode) reasons.add("كود تصنيف الأصل مطلوب", "The asset category code is required");
        else if (!category) reasons.add(`تصنيف الأصول بالكود "${categoryCode}" غير موجود — استورد تصنيفات الأصول أولاً`, `No asset category with the code "${categoryCode}" exists; import the asset categories first`);
        if (!acquisitionDate) reasons.add("تاريخ الاقتناء مطلوب", "The acquisition date is required");
        if (!acquisitionCostStr) reasons.add("تكلفة الاقتناء مطلوبة", "The acquisition cost is required");
        // Optional depreciation terms; blank keeps the category's defaults and
        // starts depreciation on the acquisition date (editable later, until
        // the first depreciation posts).
        const depreciationStartDate = optStr(row, "depreciationStartDate");
        const usefulLifeMonths = optNum(row, "usefulLifeMonths");
        const salvageValueStr = optStr(row, "salvageValue");
        if (depreciationStartDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(depreciationStartDate)) reasons.add(`تاريخ بدء الإهلاك "${depreciationStartDate}" غير صحيح — استخدم الصيغة YYYY-MM-DD`, `The depreciation start date "${depreciationStartDate}" is not valid; use YYYY-MM-DD`);
        if (optStr(row, "usefulLifeMonths") !== undefined && (usefulLifeMonths === undefined || !Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0)) reasons.add("العمر الإنتاجي (بالأشهر) يجب أن يكون عدداً صحيحاً أكبر من صفر", "The useful life (in months) must be a whole number greater than zero");
        if (salvageValueStr !== undefined && !/^\d+(\.\d+)?$/.test(salvageValueStr)) reasons.add(`القيمة التخريدية "${salvageValueStr}" ليست رقماً صحيحاً`, `The salvage value "${salvageValueStr}" is not a valid amount`);
        if (code) {
          if (existingCodes.has(code)) reasons.add(`الأصل بالكود "${code}" مسجل بالفعل`, `An asset with the code "${code}" is already registered`);
          checkDuplicateInBatch(code, seenCodes, reasons);
        }
        if (reasons.length > 0) return reasons.error(rowNumber);
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
              ...(depreciationStartDate ? { depreciationStartDate } : {}),
              ...(usefulLifeMonths !== undefined ? { usefulLifeMonths } : {}),
              ...(salvageValueStr !== undefined ? { salvageValue: Money.fromMajor(salvageValueStr) } : {}),
            },
          };
        } catch (err) {
          return { rowNumber, ...errorReasons(err) };
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
      const errors = preview.errors.map((e) => ({ rowNumber: e.rowNumber, reasons: e.reasons, ...(e.reasonsEn ? { reasonsEn: e.reasonsEn } : {}) }));
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
        return c.json({ validCount: preview.valid.length, errors: [{ rowNumber: 0, ...errorReasons(err) }] }, 422);
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

  function partyControlRowRefusal(code: string, kind: "customer" | "supplier"): { ar: string; en: string } {
    return kind === "customer"
      ? {
          ar: `الحساب "${code}" حساب مراقبة العملاء ولا يُستورد رصيده من الميزان: أدخل أرصدة العملاء الافتتاحية على بطاقة كل عميل (أو باستيراد فواتيرهم المفتوحة)، واجعل مقابلها في هذا الميزان على حساب 3210.`,
          en: `Account "${code}" is the customer control account and cannot be imported from the trial balance: enter customer balances through the customer opening balances (or by importing their open invoices), and offset them in this trial balance with account 3210.`,
        }
      : {
          ar: `الحساب "${code}" حساب مراقبة الموردين ولا يُستورد رصيده من الميزان: أدخل أرصدة الموردين الافتتاحية على بطاقة كل مورد (أو باستيراد فواتيرهم المفتوحة)، واجعل مقابلها في هذا الميزان على حساب 3210.`,
          en: `Account "${code}" is the supplier control account and cannot be imported from the trial balance: enter supplier balances through the supplier opening balances (or by importing their open invoices), and offset them in this trial balance with account 3210.`,
        };
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
    ): Promise<{ date: string; adjusted: boolean; noteAr: string | null; noteEn: string | null } | { refusal: string; refusalEn: string }> {
      if (requested) {
        const period = await tbPeriods!.findByDate(requested);
        if (!period) return { refusal: `لا توجد فترة مالية تشمل ${requested} — أنشئ الفترة أولاً.`, refusalEn: `No fiscal period covers ${requested}; create the period first.` };
        if (period.status !== "open") return { refusal: `الفترة المالية التي تشمل ${requested} ليست مفتوحة للترحيل.`, refusalEn: `The fiscal period covering ${requested} is not open for posting.` };
        return { date: requested, adjusted: false, noteAr: null, noteEn: null };
      }
      const open = (await tbPeriods!.list())
        .filter((p) => p.status === "open")
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      const first = open[0];
      if (!first) return { refusal: "لا توجد فترة مالية مفتوحة — أنشئ السنة المالية أولاً.", refusalEn: "No fiscal period is open; create the fiscal year first." };
      const preferred = dayBefore(first.startDate);
      const period = await tbPeriods!.findByDate(preferred);
      if (period && period.status === "open") return { date: preferred, adjusted: false, noteAr: null, noteEn: null };
      return {
        date: first.startDate,
        adjusted: true,
        noteAr: `اليوم السابق لأول فترة مفتوحة (${preferred}) لا يقع في فترة مالية مفتوحة، فسيُرحَّل الرصيد الافتتاحي بتاريخ ${first.startDate}. افتح الفترة السابقة إن أردت ترحيله قبل بداية السنة.`,
        noteEn: `The day before the first open period (${preferred}) does not fall in an open fiscal period, so the opening balance will be posted on ${first.startDate}. Open the earlier period if you want it posted before the start of the year.`,
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
      const errors: DataMigrationRowError[] = preview.errors.map((e) => ({ rowNumber: e.rowNumber, reasons: e.reasons, ...(e.reasonsEn ? { reasonsEn: e.reasonsEn } : {}) }));

      const byCode = new Map((await tbAccounts!.list()).map((a) => [a.code, a]));
      const partyControls = (await deps.partyControlAccounts?.()) ?? new Map<string, "customer" | "supplier">();
      const tbProjectRequired = (await deps.projectRequiredAccountIds?.()) ?? new Set<string>();
      const lines: { accountId: string; debit: Money; credit: Money }[] = [];
      for (const row of preview.valid) {
        const account = byCode.get(row.accountCode);
        if (!account) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب بالكود "${row.accountCode}" غير موجود`], reasonsEn: [`No account with the code "${row.accountCode}" exists`] });
          continue;
        }
        if (account.isHeader) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب "${row.accountCode}" حساب رئيسي ولا يقبل الترحيل`], reasonsEn: [`Account "${row.accountCode}" is a header account and cannot be posted to`] });
          continue;
        }
        if (account.status !== "active") {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الحساب "${row.accountCode}" غير نشط`], reasonsEn: [`Account "${row.accountCode}" is not active`] });
          continue;
        }
        const partyKind = partyControls.get(account.id);
        if (partyKind) {
          const refusal = partyControlRowRefusal(row.accountCode, partyKind);
          errors.push({ rowNumber: row.rowNumber, reasons: [refusal.ar], reasonsEn: [refusal.en] });
          continue;
        }
        // The commit's posting refuses a line on a project account that names no
        // project, and a trial balance row names none — so the preview must say so
        // rather than show a clean file the commit then refuses.
        if (tbProjectRequired.has(account.id)) {
          errors.push({
            rowNumber: row.rowNumber,
            reasons: [`الحساب "${row.accountCode}" حساب مشروعات — كل سطر عليه يجب أن يحمل مشروعاً، وميزان المراجعة الافتتاحي لا يحمل مشروعاً. اختر حساباً آخر.`],
            reasonsEn: [`Account "${row.accountCode}" is a project account: every line on it must name a project, and an opening trial balance names none. Choose another account.`],
          });
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
          dateNoteEn: "refusal" in resolved ? null : resolved.noteEn,
          refusal: "refusal" in resolved ? resolved.refusal : null,
          refusalEn: "refusal" in resolved ? resolved.refusalEn : null,
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
                reasonsEn: [`The trial balance is not balanced: debit ${preview.totalDebit.toString()}, credit ${preview.totalCredit.toString()}, difference ${preview.difference.toString()}`],
              },
            ],
          },
          422,
        );
      }
      if ("refusal" in resolved) {
        return c.json({ ...summary, errors: [{ rowNumber: 0, reasons: [resolved.refusal], reasonsEn: [resolved.refusalEn] }] }, 422);
      }
      const entryId = `OPENING-TB:${resolved.date}`;
      try {
        await tbPost!({ id: entryId, date: resolved.date, memo: "الرصيد الافتتاحي", lines });
      } catch (err) {
        return c.json({ ...summary, errors: [{ rowNumber: 0, ...errorReasons(err) }] }, 422);
      }
      return c.json(
        { ...summary, errors: [], date: resolved.date, dateAdjusted: resolved.adjusted, dateNoteAr: resolved.noteAr, dateNoteEn: resolved.noteEn, createdIds: [entryId] },
        201,
      );
    }
    app.post("/opening-trial-balance/preview", gate("admin.settings.view"), (c) => openingTrialBalanceStep(c, false));
    app.post("/opening-trial-balance/commit", gate("accounting.journal.create"), (c) => openingTrialBalanceStep(c, true));
  }

  // --- القيود اليومية (Historical journal entries) ---
  const jeAccounts = deps.accounts;
  const jePeriods = deps.fiscalPeriods;
  const jePost = deps.postImportedJournalEntries;
  if (jeAccounts && jePeriods && jePost) {
    async function journalEntriesStep(c: Context, commit: boolean) {
      const body = (await c.req.json()) as { rows?: unknown };
      const rows = rowsOf(body);
      const preview = previewJournalEntriesImport(
        rows.map((row, i) => ({
          rowNumber: Number(str(row, "rowNumber")) || i + 2,
          entryRef: str(row, "entryRef"),
          date: str(row, "date"),
          accountCode: str(row, "accountCode"),
          debit: str(row, "debit"),
          credit: str(row, "credit"),
          description: str(row, "description"),
        })),
      );
      const errors: DataMigrationRowError[] = preview.errors.map((e) => ({ rowNumber: e.rowNumber, reasons: [...e.reasons], ...(e.reasonsEn ? { reasonsEn: [...e.reasonsEn] } : {}) }));
      const byCode = new Map((await jeAccounts!.list()).map((a) => [a.code, a]));
      const partyControls = (await deps.partyControlAccounts?.()) ?? new Map<string, "customer" | "supplier">();
      const projectRequired = (await deps.projectRequiredAccountIds?.()) ?? new Set<string>();
      const periodStatus = new Map<string, string | null>();
      const yearsToCreate = new Set<number>();

      const postable: { id: string; date: string; memo: string; lines: { accountId: string; debit: Money; credit: Money; memo: string | null }[] }[] = [];
      for (const entry of preview.entries) {
        const lineErrors: DataMigrationRowError[] = [];
        const lines: { accountId: string; debit: Money; credit: Money; memo: string | null }[] = [];
        for (const line of entry.lines) {
          const account = byCode.get(line.accountCode);
          const refuse = (ar: string, en: string) => lineErrors.push({ rowNumber: line.rowNumber, reasons: [ar], reasonsEn: [en] });
          if (!account) refuse(`الحساب بالكود "${line.accountCode}" غير موجود`, `No account with the code "${line.accountCode}" exists`);
          else if (account.isHeader) refuse(`الحساب "${line.accountCode}" حساب رئيسي ولا يقبل الترحيل`, `Account "${line.accountCode}" is a header account and cannot be posted to`);
          else if (account.status !== "active") refuse(`الحساب "${line.accountCode}" غير نشط`, `Account "${line.accountCode}" is not active`);
          else if (partyControls.has(account.id)) {
            const refusal = partyControlRowRefusal(line.accountCode, partyControls.get(account.id)!);
            refuse(refusal.ar, refusal.en);
          } else if (projectRequired.has(account.id)) {
            refuse(
              `الحساب "${line.accountCode}" حساب مشروعات — كل سطر عليه يجب أن يحمل مشروعاً، وملف القيود لا يحمل مشروعاً. اختر حساباً آخر.`,
              `Account "${line.accountCode}" is a project account: every line on it must name a project, and the journal file names none. Choose another account.`,
            );
          } else lines.push({ accountId: account.id, debit: line.debit, credit: line.credit, memo: line.description });
        }
        const firstRow = entry.lines[0]!.rowNumber;
        if (!periodStatus.has(entry.date)) periodStatus.set(entry.date, (await jePeriods!.findByDate(entry.date))?.status ?? null);
        const status = periodStatus.get(entry.date);
        if (status === null && deps.createsMissingFiscalYears) {
          yearsToCreate.add(Number(entry.date.slice(0, 4)));
        } else if (status === null) {
          lineErrors.push({ rowNumber: firstRow, reasons: [`لا توجد فترة مالية تشمل ${entry.date} — أنشئ السنة المالية أولاً من «الفترات المالية».`], reasonsEn: [`No fiscal period covers ${entry.date}; generate that fiscal year first under Fiscal periods.`] });
        } else if (status !== "open") {
          lineErrors.push({ rowNumber: firstRow, reasons: [`الفترة المالية التي تشمل ${entry.date} ليست مفتوحة للترحيل.`], reasonsEn: [`The fiscal period covering ${entry.date} is not open for posting.`] });
        }
        const id = `IMPORT-JE:${entry.entryRef}`;
        if (deps.journalEntryExists && (await deps.journalEntryExists(id))) {
          lineErrors.push({ rowNumber: firstRow, reasons: [`القيد "${entry.entryRef}" مستورد من قبل — لا يُستورد مرتين.`], reasonsEn: [`Entry "${entry.entryRef}" was already imported; it is never imported twice.`] });
        }
        if (lineErrors.length > 0) {
          errors.push(...lineErrors);
          continue;
        }
        postable.push({ id, date: entry.date, memo: entry.memo, lines });
      }
      errors.sort((a, b) => a.rowNumber - b.rowNumber);

      const totalDebit = Money.sum(postable.flatMap((e) => e.lines.map((l) => l.debit)));
      const summary = {
        validCount: postable.length,
        total: new Set(rows.map((row) => str(row, "entryRef").trim()).filter((ref) => ref !== "")).size,
        entryCount: postable.length,
        lineCount: postable.reduce((n, e) => n + e.lines.length, 0),
        totalDebit: totalDebit.toString(),
        totalCredit: totalDebit.toString(),
        fromDate: postable.length > 0 ? postable.map((e) => e.date).sort()[0]! : null,
        toDate: postable.length > 0 ? postable.map((e) => e.date).sort().at(-1)! : null,
        /** Fiscal years the commit will create because no period covers some entry's date. */
        fiscalYearsToCreate: [...yearsToCreate].sort((a, b) => a - b),
        errors,
      };
      if (!commit) return c.json(summary);
      if (errors.length > 0 || postable.length === 0) return c.json(summary, 422);
      try {
        await jePost!(postable, { createFiscalYears: [...yearsToCreate] });
      } catch (err) {
        return c.json({ ...summary, errors: [{ rowNumber: 0, ...errorReasons(err) }] }, 422);
      }
      return c.json({ ...summary, createdIds: postable.map((e) => e.id) }, 201);
    }
    app.post("/journal-entries/preview", gate("admin.settings.view"), (c) => journalEntriesStep(c, false));
    app.post("/journal-entries/commit", gate("accounting.journal.create"), (c) => journalEntriesStep(c, true));
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
      journalEntries: deps.countImportedJournalEntries ? await deps.countImportedJournalEntries() : 0,
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
      const errors: DataMigrationRowError[] = [...preview.errors];
      const lines: { itemId: string; qty: Qty; unitCost: Money }[] = [];
      for (const row of preview.valid) {
        const item = await deps.items.findByCode(row.itemCode);
        if (!item) {
          errors.push({ rowNumber: row.rowNumber, reasons: [`الصنف بالكود "${row.itemCode}" غير موجود`], reasonsEn: [`No item with the code "${row.itemCode}" exists`] });
          continue;
        }
        if (item.trackBatches || item.trackExpiry) {
          errors.push({
            rowNumber: row.rowNumber,
            reasons: [`الصنف "${row.itemCode}" يتتبع التشغيلات والصلاحية: أدخل رصيده الافتتاحي من شاشة تسويات المخزون مع رقم التشغيلة وتاريخ الصلاحية`],
            reasonsEn: [`Item "${row.itemCode}" tracks batches and expiry: enter its opening balance from the stock adjustments screen with the batch and expiry`],
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
        const text = bilingualText(err instanceof Error ? err.message : String(err), { ar: "تعذّر استيراد الأرصدة الافتتاحية.", en: "The opening balances could not be imported." });
        return c.json({ error: "OPENING_BALANCE_IMPORT_FAILED", message: text.ar, messageEn: text.en }, 422);
      }
    });
  }

  return app;
}
