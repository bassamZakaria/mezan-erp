import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { ALL_SCOPE, can, type AuthContext } from "@mezan/domain";
import type { AuthContextResolver } from "./permission-gate.js";

export const VIEW_UNATTRIBUTED_PERMISSION = "accounting.reports.view_unattributed";

export enum BranchPolicy {
  Scoped = "scoped",
  CompanyWide = "company_wide",
  MasterDataShared = "master_data_shared",
  SharedReadOnly = "shared_read_only",
  SelfOnly = "self_only",
  Public = "public",
}

export enum BranchRecordKind {
  Branch = "branch",
  Warehouse = "warehouse",
  TreasuryAccount = "treasury_account",
  SalesInvoice = "sales_invoice",
  SalesQuote = "sales_quote",
  SalesReturn = "sales_return",
  PurchaseOrder = "purchase_order",
  GoodsReceipt = "goods_receipt",
  PurchaseInvoice = "purchase_invoice",
  PurchaseReturn = "purchase_return",
  Rfq = "rfq",
  LandedCost = "landed_cost",
  Voucher = "voucher",
  VoucherAllocation = "voucher_allocation",
  Cheque = "cheque",
  BankStatement = "bank_statement",
  JournalEntry = "journal_entry",
  RecurringTemplate = "recurring_template",
  RecurringRun = "recurring_run",
  StockAdjustment = "stock_adjustment",
  StockTransfer = "stock_transfer",
  PostedStockDocument = "posted_stock_document",
  PhysicalCount = "physical_count",
  WritedownRun = "writedown_run",
  WorkOrder = "work_order",
  ConfigInstance = "config_instance",
  Asset = "asset",
  DepreciationRun = "depreciation_run",
  Van = "van",
  VanTrip = "van_trip",
  Employee = "employee",
  EmployeeContract = "employee_contract",
  Attendance = "attendance",
  LeaveRequest = "leave_request",
  LeaveBalance = "leave_balance",
  EmployeeAdvance = "employee_advance",
  Garnishment = "garnishment",
  PayrollRun = "payroll_run",
  Payslip = "payslip",
  PosTerminal = "pos_terminal",
  ShiftTemplate = "shift_template",
  CostCenter = "cost_center",
  Customer = "customer",
  Supplier = "supplier",
  CrmOpportunity = "crm_opportunity",
  CrmActivity = "crm_activity",
  InstallmentPlan = "installment_plan",
  CollectionFollowUp = "collection_follow_up",
  ApprovalRequest = "approval_request",
  EtaSubmission = "eta_submission",
  EtaReceipt = "eta_receipt",
  AnyInvoice = "any_invoice",
  SourceDocument = "source_document",
  AnyDocument = "any_document",
}

export enum ScopedReads {
  Rows = "rows",
  HandlerNarrows = "handler_narrows",
  Refused = "refused",
}

/**
 * Where a record's branch is read from. `null` means no such record;
 * an empty or all-null list means it exists and no branch owns it.
 */
export enum BranchAccess {
  Read = "read",
  Write = "write",
}

export interface BranchDirectory {
  branchesOf(kind: BranchRecordKind, id: string, access: BranchAccess): Promise<readonly (string | null)[] | null> | readonly (string | null)[] | null;
}

export interface BranchPolicyEntry {
  readonly prefix: string;
  readonly policy: BranchPolicy;
  readonly params?: Readonly<Record<string, BranchRecordKind | null>>;
  readonly reads?: ScopedReads;
  readonly rows?: BranchRecordKind;
  readonly handlerNarrowed?: readonly string[];
  readonly companyWide?: readonly string[];
  readonly defaultsBranch?: boolean;
  readonly defaultsLineBranch?: boolean;
  readonly exemptBodyKeys?: readonly string[];
  readonly query?: Readonly<Record<string, BranchRecordKind>>;
}

const K = BranchRecordKind;
const COUNTS_AND_STATS = ["/counts", "/stats"] as const;

function scoped(prefix: string, record: BranchRecordKind, extra: Partial<BranchPolicyEntry> = {}): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.Scoped, rows: record, reads: ScopedReads.Rows, ...extra, params: { id: record, ...extra.params } };
}

function handlerScoped(prefix: string, extra: Partial<BranchPolicyEntry> = {}): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.Scoped, reads: ScopedReads.HandlerNarrows, ...extra };
}

function shared(prefix: string, params?: Readonly<Record<string, BranchRecordKind | null>>): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.MasterDataShared, ...(params ? { params } : {}) };
}

function readOnly(prefix: string): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.SharedReadOnly };
}

function companyWide(prefix: string): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.CompanyWide };
}

function own(prefix: string): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.SelfOnly };
}

function open(prefix: string): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.Public };
}

/**
 * SECURITY INVARIANT: this table is the only thing that opens a route to a
 * branch-restricted session. A mounted route whose path matches no prefix is
 * refused to one (`branch-policy.structure.test.ts` fails the build first), so
 * a family added later is closed until someone declares what it is.
 */
export const BRANCH_POLICY_TABLE: readonly BranchPolicyEntry[] = [
  open("/health"),
  open("/auth"),
  open("/bootstrap/status"),
  companyWide("/bootstrap"),
  open("/license"),
  open("/entitlements"),
  open("/plan-usage"),
  open("/tenant"),
  open("/documents/types"),
  handlerScoped("/documents/journal"),
  own("/profile"),
  own("/preferences"),
  own("/notifications"),
  own("/hr/self"),
  { ...own("/lan"), companyWide: ["GET /sessions", "/sessions/:sessionId"] },

  readOnly("/settings"),
  readOnly("/accounting"),
  readOnly("/accounts"),
  readOnly("/fiscal-periods"),
  readOnly("/tax-rates"),
  readOnly("/tax-groups"),
  readOnly("/exchange-rates"),
  readOnly("/sequences"),
  readOnly("/roles"),
  shared("/users"),
  readOnly("/branches"),
  readOnly("/barcode-config"),
  readOnly("/print-template-config"),
  readOnly("/label-layouts"),
  readOnly("/notification-rules"),
  readOnly("/workflow/configs"),
  readOnly("/pos/settings"),
  readOnly("/pos/payment-methods"),
  readOnly("/eta/config"),
  readOnly("/eta/activity-codes"),
  readOnly("/eta/branch-codes"),
  readOnly("/eta/item-mappings"),
  readOnly("/eta/tax-subtypes"),
  readOnly("/eta/unit-codes"),
  readOnly("/eta/unit-mappings"),
  readOnly("/gl/party-control-accounts"),
  readOnly("/hr/payroll/statutory-flag"),
  readOnly("/hr/payroll/statutory-tables"),
  readOnly("/hr/payroll/components"),
  readOnly("/hr/holidays"),
  readOnly("/hr/leave-policies"),
  readOnly("/hr/departments"),
  readOnly("/hr/job-titles"),
  readOnly("/bank-statements/rules"),
  readOnly("/crm/pipeline-stages"),
  readOnly("/assets/categories"),
  readOnly("/manufacturing/work-stations"),

  shared("/items"),
  shared("/item-units"),
  shared("/item-categories"),
  shared("/item-brands"),
  shared("/item-seasons"),
  shared("/item-specifications"),
  shared("/inventory/product-templates"),
  shared("/price-lists"),
  shared("/promotions"),
  shared("/manufacturing/boms"),
  shared("/manufacturing/configurable-products"),
  shared("/customers", { id: K.Customer }),
  shared("/suppliers", { id: K.Supplier }),
  shared("/cost-centers", { id: K.CostCenter }),

  companyWide("/data-migration"),
  companyWide("/security-reports"),
  companyWide("/audit/verify"),
  companyWide("/revaluation"),
  companyWide("/reconciliation"),
  companyWide("/tax"),
  companyWide("/gl/year-end-close"),
  companyWide("/gl/vat-filings"),
  companyWide("/gl/opening-balance-duplicates"),
  companyWide("/gl/balances-by-currency"),
  companyWide("/gl/recurring/generate-due"),
  companyWide("/gl/recurring/due"),
  companyWide("/gl/recurring/depreciation-due"),
  companyWide("/gl/recurring/skips"),
  companyWide("/sales/historical-import"),
  companyWide("/purchases/historical-import"),
  companyWide("/inventory/rebuild"),
  companyWide("/inventory/drift"),
  companyWide("/projects"),
  companyWide("/contracting"),
  companyWide("/crm/leads"),
  companyWide("/hr/dashboard"),
  companyWide("/hr/leave-accrual-batches"),
  companyWide("/hr/payroll/provisions"),
  companyWide("/manufacturing/dashboard"),
  companyWide("/eta/receipts/summary"),
  companyWide("/eta/reports"),
  companyWide("/eta/test-connection"),
  companyWide("/eta/submissions/process"),
  companyWide("/eta/submissions/submit-all"),
  companyWide("/eta/submissions/bulk-requeue-submit"),
  companyWide("/installments/plans/overdue"),

  handlerScoped("/audit"),
  handlerScoped("/dashboard"),
  handlerScoped("/cash-forecast"),
  handlerScoped("/cost-center-pl"),
  handlerScoped("/financial-reports"),
  handlerScoped("/reports", { params: { id: null } }),
  handlerScoped("/attachments", { params: { id: null } }),
  handlerScoped("/gl/journal-entries", { params: { id: K.JournalEntry }, defaultsLineBranch: true }),
  handlerScoped("/gl/accounts", { params: { accountId: null } }),
  scoped("/gl/recurring/templates", K.RecurringTemplate, { params: { entryId: K.JournalEntry } }),
  scoped("/gl/recurring/runs", K.RecurringRun),

  scoped("/warehouses", K.Warehouse),
  scoped("/treasury-accounts", K.TreasuryAccount, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/sales-invoices", K.SalesInvoice, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/sales-quotes", K.SalesQuote, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/sales-returns", K.SalesReturn, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/purchases/orders", K.PurchaseOrder, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/purchases/receipts", K.GoodsReceipt, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/purchases/invoices", K.PurchaseInvoice, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/purchase-returns", K.PurchaseReturn, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/rfqs", K.Rfq, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/landed-costs", K.LandedCost),
  scoped("/vouchers", K.Voucher, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/allocations", K.VoucherAllocation),
  scoped("/open-invoices", K.AnyInvoice),
  scoped("/cheques", K.Cheque, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/bank-statements", K.BankStatement, {
    params: { treasuryAccountId: K.TreasuryAccount, lineId: null, suggestionId: null },
  }),
  scoped("/assets", K.Asset, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/assets/depreciation/runs", K.DepreciationRun, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/field/vans", K.Van),
  scoped("/field/van-trips", K.VanTrip),
  scoped("/pos/terminals", K.PosTerminal),
  scoped("/shift-templates", K.ShiftTemplate),
  scoped("/crm/opportunities", K.CrmOpportunity),
  scoped("/crm/activities", K.CrmActivity),
  scoped("/installments/plans", K.InstallmentPlan, { handlerNarrowed: [] }),
  scoped("/installments/follow-ups", K.CollectionFollowUp),
  scoped("/workflow/requests", K.ApprovalRequest, { handlerNarrowed: ["/pending-count"] }),
  scoped("/eta/submissions", K.EtaSubmission),
  scoped("/eta/receipts", K.EtaReceipt, { params: { internalId: K.EtaReceipt, kind: null, docId: K.SourceDocument }, rows: K.EtaReceipt }),

  scoped("/inventory/stock-adjustments", K.StockAdjustment, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/inventory/stock-transfers", K.StockTransfer, { handlerNarrowed: COUNTS_AND_STATS, exemptBodyKeys: ["toWarehouseId"] }),
  scoped("/inventory/physical-counts", K.PhysicalCount, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/inventory/writedown-runs", K.WritedownRun),
  scoped("/inventory/adjustments", K.PostedStockDocument),
  scoped("/inventory/transfers", K.PostedStockDocument, { exemptBodyKeys: ["toWarehouseId"] }),
  handlerScoped("/inventory", { params: { itemId: null }, query: { warehouseId: K.Warehouse } }),

  scoped("/manufacturing/work-orders", K.WorkOrder, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/manufacturing/config-instances", K.ConfigInstance),

  scoped("/hr/employees", K.Employee),
  scoped("/hr/contracts", K.EmployeeContract),
  scoped("/hr/attendance", K.Attendance, { companyWide: ["/import"] }),
  scoped("/hr/leave-requests", K.LeaveRequest),
  scoped("/hr/leave-balances", K.LeaveBalance),
  scoped("/hr/advances", K.EmployeeAdvance),
  scoped("/hr/payroll/garnishments", K.Garnishment),
  scoped("/hr/payroll/runs", K.PayrollRun, { defaultsBranch: true }),
  scoped("/hr/payroll/payslips", K.Payslip),
];

/**
 * The record a body key names. A request that names one outside the grant is
 * refused before its handler runs, whatever the route — so a new route that
 * accepts `receiptId` is held to the grant without knowing this table exists.
 */
export const BODY_REFERENCE_KEYS: Readonly<Record<string, BranchRecordKind>> = {
  branchId: K.Branch,
  warehouseId: K.Warehouse,
  sourceWarehouseId: K.Warehouse,
  destinationWarehouseId: K.Warehouse,
  fromWarehouseId: K.Warehouse,
  toWarehouseId: K.Warehouse,
  wipWarehouseId: K.Warehouse,
  vanWarehouseId: K.Warehouse,
  transitWarehouseId: K.Warehouse,
  treasuryAccountId: K.TreasuryAccount,
  counterTreasuryAccountId: K.TreasuryAccount,
  bankTreasuryAccountId: K.TreasuryAccount,
  drawerTreasuryAccountId: K.TreasuryAccount,
  sourceTreasuryAccountId: K.TreasuryAccount,
  vanTreasuryAccountId: K.TreasuryAccount,
  receiptId: K.GoodsReceipt,
  purchaseOrderId: K.PurchaseOrder,
  orderId: K.SourceDocument,
  quoteId: K.SalesQuote,
  invoiceId: K.AnyInvoice,
  sourceInvoiceId: K.SourceDocument,
  voucherId: K.Voucher,
  chequeId: K.Cheque,
  statementId: K.BankStatement,
  rfqId: K.Rfq,
  vanId: K.Van,
  tripId: K.VanTrip,
  terminalId: K.PosTerminal,
  employeeId: K.Employee,
  runId: K.PayrollRun,
  assetId: K.Asset,
  workOrderId: K.WorkOrder,
  opportunityId: K.CrmOpportunity,
  relatedOpportunityId: K.CrmOpportunity,
  costCenterId: K.CostCenter,
  installmentPlanId: K.InstallmentPlan,
  planId: K.InstallmentPlan,
  templateId: K.RecurringTemplate,
  docId: K.AnyDocument,
};

export const TREASURY_HOLDER_KEYS: ReadonlySet<string> = new Set(["treasuryAccountId", "drawerTreasuryAccountId"]);
const RESTRICTED_TREASURY_HOLDER_KEYS: ReadonlySet<string> = new Set([...TREASURY_HOLDER_KEYS, "bankTreasuryAccountId"]);

const DOCUMENT_BRANCH_KEYS: ReadonlySet<string> = new Set(["branchId", "warehouseId", "sourceWarehouseId", "destinationWarehouseId", "fromWarehouseId"]);

const NAMED_LOCATION_KINDS: ReadonlySet<BranchRecordKind> = new Set([K.Branch, K.Warehouse, K.TreasuryAccount]);
const QUERY_BRANCH_KEYS = ["branchId", "branchIds", "branch"] as const;
const UNATTRIBUTED_QUERY_VALUE = "__unattributed__";
const BODY_SCAN_DEPTH = 6;

export enum BranchRefusalCode {
  NotFound = "NOT_FOUND",
  BranchOutOfScope = "BRANCH_OUT_OF_SCOPE",
  CompanyWideOnly = "COMPANY_WIDE_REPORT",
  PolicyUndeclared = "BRANCH_POLICY_UNDECLARED",
  BranchRequired = "BRANCH_REQUIRED",
  TreasuryBranchMismatch = "TREASURY_BRANCH_MISMATCH",
}

export interface BranchRefusalBody {
  readonly error: BranchRefusalCode;
  readonly message: string;
  readonly messageEn: string;
}

export const BRANCH_REFUSALS: Readonly<Record<BranchRefusalCode, BranchRefusalBody>> = {
  [BranchRefusalCode.NotFound]: {
    error: BranchRefusalCode.NotFound,
    message: "المستند غير موجود أو يخص فرعًا خارج صلاحيتك.",
    messageEn: "This document does not exist or belongs to a branch outside the branches granted to you.",
  },
  [BranchRefusalCode.BranchOutOfScope]: {
    error: BranchRefusalCode.BranchOutOfScope,
    message: "لا يمكنك تنفيذ هذا الإجراء: يمس فرعًا خارج صلاحيتك.",
    messageEn: "You cannot do this: it touches a branch outside the branches granted to you.",
  },
  [BranchRefusalCode.CompanyWideOnly]: {
    error: BranchRefusalCode.CompanyWideOnly,
    message: "هذه البيانات على مستوى الشركة كلها، ولا تتاح لحساب مقيّد بفروع محددة.",
    messageEn: "This is company-wide data and is not available to an account restricted to specific branches.",
  },
  [BranchRefusalCode.PolicyUndeclared]: {
    error: BranchRefusalCode.PolicyUndeclared,
    message: "هذه الشاشة غير متاحة لحساب مقيّد بفروع محددة.",
    messageEn: "This surface is not available to an account restricted to specific branches.",
  },
  [BranchRefusalCode.BranchRequired]: {
    error: BranchRefusalCode.BranchRequired,
    message: "حدد الفرع: حسابك مصرح له بأكثر من فرع، ولا يُسجَّل مستند بلا فرع.",
    messageEn: "Choose a branch: your account holds several, and a document cannot be recorded without one.",
  },
  [BranchRefusalCode.TreasuryBranchMismatch]: {
    error: BranchRefusalCode.TreasuryBranchMismatch,
    message: "الخزينة أو الحساب البنكي يتبع فرعًا غير فرع المستند.",
    messageEn: "The cash or bank account belongs to a different branch from the document.",
  },
};

const REFUSAL_STATUS: Readonly<Record<BranchRefusalCode, 400 | 403 | 404>> = {
  [BranchRefusalCode.NotFound]: 404,
  [BranchRefusalCode.BranchOutOfScope]: 403,
  [BranchRefusalCode.CompanyWideOnly]: 403,
  [BranchRefusalCode.PolicyUndeclared]: 403,
  [BranchRefusalCode.BranchRequired]: 400,
  [BranchRefusalCode.TreasuryBranchMismatch]: 403,
};

export function branchRefusal(c: Context, code: BranchRefusalCode): Response {
  return c.json(BRANCH_REFUSALS[code], REFUSAL_STATUS[code]);
}

export function branchPolicyFor(routePath: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchPolicyEntry | undefined {
  let best: BranchPolicyEntry | undefined;
  for (const entry of table) {
    const matches = routePath === entry.prefix || routePath.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best;
}

function subPathListed(entry: BranchPolicyEntry, routePath: string, list: readonly string[] | undefined, method?: string): boolean {
  if (!list) return false;
  const rest = routePath.slice(entry.prefix.length);
  return list.some((listed) => {
    const [first, second] = listed.split(" ");
    const sub = second ?? first!;
    if (second !== undefined && first !== method) return false;
    return rest === sub || (second === undefined && rest.startsWith(`${sub}/`));
  });
}

export function paramNamesOf(routePath: string): string[] {
  return routePath
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1).replace(/[{?].*$/, ""));
}

export function undeclaredPolicyOf(routePath: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): string | null {
  const entry = branchPolicyFor(routePath, table);
  if (!entry) return "no branch policy declared";
  if (entry.policy !== BranchPolicy.Scoped || subPathListed(entry, routePath, entry.companyWide)) return null;
  const missing = paramNamesOf(routePath).filter((name) => entry.params?.[name] === undefined);
  return missing.length > 0 ? `scoped route has no stored-branch resolver for :${missing.join(", :")}` : null;
}

function terminalRoutePathOf(c: Context): string | undefined {
  // The FIRST concrete match is the handler that answers: `/receipts/stats`
  // also matches a later `/receipts/:id`, and reading that one would resolve
  // "stats" as a document id.
  return matchedRoutes(c).find((route) => !route.path.endsWith("*"))?.path;
}

function paramsOf(routePath: string, pathname: string): Record<string, string> {
  const pattern = routePath.split("/");
  const actual = pathname.split("/");
  const params: Record<string, string> = {};
  pattern.forEach((segment, index) => {
    if (!segment.startsWith(":")) return;
    const value = actual[index];
    if (value !== undefined && value !== "") params[segment.slice(1).replace(/[{?].*$/, "")] = decodeURIComponent(value);
  });
  return params;
}

interface NamedReference {
  readonly key: string;
  readonly kind: BranchRecordKind;
  readonly id: string;
  readonly depth: number;
}

function referencesNamedIn(value: unknown, depth = 0, found: NamedReference[] = []): NamedReference[] {
  if (depth > BODY_SCAN_DEPTH || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) referencesNamedIn(item, depth + 1, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const kind = BODY_REFERENCE_KEYS[key];
    const pluralKind = key.endsWith("Ids") ? BODY_REFERENCE_KEYS[`${key.slice(0, -1)}`] : undefined;
    if (typeof child === "string") {
      if (kind && child !== "") found.push({ key, kind, id: child, depth });
    } else if (pluralKind && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string" && id !== "") found.push({ key: key.slice(0, -1), kind: pluralKind, id, depth });
    } else {
      referencesNamedIn(child, depth + 1, found);
    }
  }
  return found;
}

const BRANCH_DIRECTORY_KEY = "branchDirectory" as const;
const GRANTED_WAREHOUSES_KEY = "grantedWarehouseIds" as const;
const BRANCH_SESSION_KEY = "branchSession" as const;

declare module "hono" {
  interface ContextVariableMap {
    branchDirectory?: BranchDirectory;
    grantedWarehouseIds?: readonly string[];
    branchSession?: Session;
  }
}

export function branchDirectoryOf(c: Context): BranchDirectory | undefined {
  return c.get(BRANCH_DIRECTORY_KEY);
}

export function grantedWarehouseIdsOf(c: Context): readonly string[] | undefined {
  return c.get(GRANTED_WAREHOUSES_KEY);
}

interface Session {
  readonly ctx: AuthContext;
  readonly grant: readonly string[];
  readonly seesUnattributed: boolean;
  readonly directory: BranchDirectory | undefined;
  readonly access: BranchAccess;
  readonly cache: Map<string, Promise<readonly (string | null)[] | null>>;
}

function lookup(session: Session, kind: BranchRecordKind, id: string): Promise<readonly (string | null)[] | null> {
  if (kind === K.Branch) return Promise.resolve([id]);
  const key = `${kind}\u0000${id}`;
  let pending = session.cache.get(key);
  if (!pending) {
    pending = Promise.resolve(session.directory ? session.directory.branchesOf(kind, id, session.access) : null);
    session.cache.set(key, pending);
  }
  return pending;
}

enum Standing {
  Granted = "granted",
  Unattributed = "unattributed",
  PartlyForeign = "partly_foreign",
  Foreign = "foreign",
  Absent = "absent",
}

function standingOf(session: Session, branches: readonly (string | null)[] | null): Standing {
  if (branches === null) return Standing.Absent;
  const attributed = branches.filter((id): id is string => typeof id === "string" && id !== "");
  if (attributed.length === 0) return Standing.Unattributed;
  const foreign = attributed.filter((id) => !session.grant.includes(id));
  if (foreign.length === 0) return Standing.Granted;
  return foreign.length === attributed.length ? Standing.Foreign : Standing.PartlyForeign;
}

function isRead(c: Context): boolean {
  return c.req.method === "GET" || c.req.method === "HEAD";
}

async function storedRecordRefusal(c: Context, session: Session, entry: BranchPolicyEntry, routePath: string): Promise<Response | null> {
  const params = paramsOf(routePath, new URL(c.req.url).pathname);
  const sharedData = entry.policy === BranchPolicy.MasterDataShared;
  if (sharedData && isRead(c)) return null;
  for (const [name, value] of Object.entries(params)) {
    const kind = entry.params?.[name];
    if (kind === null) continue;
    if (kind === undefined) {
      if (sharedData) continue;
      return branchRefusal(c, BranchRefusalCode.PolicyUndeclared);
    }
    const standing = standingOf(session, await lookup(session, kind, value));
    if (standing === Standing.Granted) continue;
    if (standing === Standing.Unattributed && (sharedData || session.seesUnattributed)) continue;
    if (standing === Standing.Absent && sharedData) continue;
    if (standing === Standing.PartlyForeign) {
      if (isRead(c)) continue;
      return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
    }
    return branchRefusal(c, BranchRefusalCode.NotFound);
  }
  return null;
}

async function readJsonBody(c: Context): Promise<unknown> {
  // SECURITY: read whatever the declared content type. Every route parses its
  // body with `c.req.json()`, which ignores the header — so trusting the
  // header here let `content-type: text/plain` carry a foreign branch past.
  try {
    return JSON.parse(await c.req.text());
  } catch {
    return undefined;
  }
}

/**
 * INVARIANT: every write by a branch-restricted session passes through here,
 * so a body that NAMES another record — a source document, a warehouse, the
 * account the money is held in — is held to the grant by the record's stored
 * branch, on every route, including one added later.
 */
async function bodyRefusal(c: Context, session: Session, entry: BranchPolicyEntry, body: unknown): Promise<Response | null> {
  for (const reference of referencesNamedIn(body)) {
    if (entry.exemptBodyKeys?.includes(reference.key)) continue;
    const standing = standingOf(session, await lookup(session, reference.kind, reference.id));
    if (standing === Standing.Foreign || standing === Standing.PartlyForeign) {
      return branchRefusal(c, NAMED_LOCATION_KINDS.has(reference.kind) ? BranchRefusalCode.BranchOutOfScope : BranchRefusalCode.NotFound);
    }
  }
  return null;
}

/**
 * LEDGER INVARIANT, for every session: money is not paid out of, or into, an
 * account held by a branch other than the document's. The journal is stamped
 * with the document's branch, so a mismatch books one branch's cash movement
 * on another branch's drawer. A session restricted to branches is also held
 * to it for the bank a cheque is banked in.
 */
async function treasuryMismatchRefusal(
  c: Context,
  resolve: (kind: BranchRecordKind, id: string) => Promise<readonly (string | null)[] | null>,
  holderKeys: ReadonlySet<string>,
  entry: BranchPolicyEntry | undefined,
  routePath: string,
  body: unknown,
): Promise<Response | null> {
  const references = referencesNamedIn(body);
  const holders = references.filter((reference) => holderKeys.has(reference.key));
  if (holders.length === 0) return null;
  const attributed = async (kind: BranchRecordKind, id: string) => ((await resolve(kind, id)) ?? []).filter((branch): branch is string => typeof branch === "string" && branch !== "");
  const documentBranches = new Set<string>();
  if (entry) {
    for (const [name, value] of Object.entries(paramsOf(routePath, new URL(c.req.url).pathname))) {
      const kind = entry.params?.[name];
      if (!kind || kind === K.TreasuryAccount) continue;
      for (const id of await attributed(kind, value)) documentBranches.add(id);
    }
  }
  if (documentBranches.size === 0) {
    for (const reference of references) {
      if (reference.depth === 0 && DOCUMENT_BRANCH_KEYS.has(reference.key)) for (const id of await attributed(reference.kind, reference.id)) documentBranches.add(id);
    }
  }
  if (documentBranches.size === 0) return null;
  for (const holder of holders) {
    const held = await attributed(holder.kind, holder.id);
    if (held.some((id) => !documentBranches.has(id))) return branchRefusal(c, BranchRefusalCode.TreasuryBranchMismatch);
  }
  return null;
}

/**
 * A create that names no branch lands in the session's only branch; a session
 * holding several must say which. Without this a branch user's document posted
 * unattributed and its own author then could not open it.
 */
function defaultBranchRefusal(c: Context, session: Session, entry: BranchPolicyEntry, routePath: string, body: unknown): Response | null {
  if (!entry.defaultsBranch && !entry.defaultsLineBranch) return null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const sole = session.grant.length === 1 ? session.grant[0]! : undefined;
  let defaulted: Record<string, unknown> | undefined;

  if (entry.defaultsLineBranch && Array.isArray(record["lines"])) {
    const lines = record["lines"] as unknown[];
    const needsBranch = (line: unknown): line is Record<string, unknown> => {
      if (line === null || typeof line !== "object") return false;
      const stated = (line as Record<string, unknown>)["branchId"];
      if (typeof stated === "string" && stated !== "") return false;
      return !(stated === null && session.seesUnattributed);
    };
    if (lines.some(needsBranch)) {
      if (!sole) return session.seesUnattributed ? null : branchRefusal(c, BranchRefusalCode.BranchRequired);
      defaulted = { ...record, lines: lines.map((line) => (needsBranch(line) ? { ...line, branchId: sole } : line)) };
    }
  } else if (entry.defaultsBranch && c.req.method === "POST" && paramNamesOf(routePath).length === 0) {
    const statesBranch = [...DOCUMENT_BRANCH_KEYS].some((key) => typeof record[key] === "string" && record[key] !== "");
    if (!statesBranch && !(record["branchId"] === null && session.seesUnattributed)) {
      if (!sole) return session.seesUnattributed ? null : branchRefusal(c, BranchRefusalCode.BranchRequired);
      defaulted = { ...record, branchId: sole };
    }
  }
  if (!defaulted) return null;
  // Hono keeps the body it already read as a promise under `bodyCache`; the
  // handler's `c.req.json()` is served from it, which is what makes the
  // defaulted branch the one the handler stores.
  const cache = c.req.bodyCache as Record<string, unknown>;
  delete cache["json"];
  cache["text"] = Promise.resolve(JSON.stringify(defaulted));
  return null;
}

async function queryRefusal(c: Context, session: Session, entry: BranchPolicyEntry): Promise<Response | null> {
  for (const key of QUERY_BRANCH_KEYS) {
    for (const raw of c.req.queries(key) ?? []) {
      for (const id of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
        if (id === "*" || id === "all") continue;
        if (id === UNATTRIBUTED_QUERY_VALUE) {
          if (!session.seesUnattributed) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
          continue;
        }
        if (!session.grant.includes(id)) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
      }
    }
  }
  for (const [key, kind] of Object.entries(entry.query ?? {})) {
    for (const id of c.req.queries(key) ?? []) {
      if (id === "") continue;
      const standing = standingOf(session, await lookup(session, kind, id));
      if (standing === Standing.Foreign || standing === Standing.PartlyForeign) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
    }
  }
  return null;
}

/**
 * Whether a record is inside the caller's branch grant — for a handler that
 * counts or folds rows the middleware cannot see. True for an unrestricted
 * session.
 */
export async function recordInBranchGrant(c: Context, kind: BranchRecordKind, id: string): Promise<boolean> {
  const session = c.get(BRANCH_SESSION_KEY);
  if (!session) return true;
  const standing = standingOf(session, await lookup(session, kind, id));
  if (standing === Standing.Granted || standing === Standing.PartlyForeign) return true;
  return standing === Standing.Unattributed && session.seesUnattributed;
}

export async function recordsInBranchGrant<Row>(c: Context, kind: BranchRecordKind, rows: readonly Row[], idOf: (row: Row) => string): Promise<readonly Row[]> {
  if (!c.get(BRANCH_SESSION_KEY)) return rows;
  const kept: Row[] = [];
  for (const row of rows) if (await recordInBranchGrant(c, kind, idOf(row))) kept.push(row);
  return kept;
}

async function rowVisible(session: Session, kind: BranchRecordKind, row: unknown): Promise<boolean> {
  if (row === null || typeof row !== "object") return true;
  const record = row as Record<string, unknown>;
  let branches: readonly (string | null)[] | null = typeof record["id"] === "string" ? await lookup(session, kind, record["id"]) : null;
  if (branches === null) {
    const named: (string | null)[] = [];
    for (const reference of referencesNamedIn(record)) named.push(...((await lookup(session, reference.kind, reference.id)) ?? []));
    branches = named;
  }
  const standing = standingOf(session, branches);
  if (standing === Standing.Granted || standing === Standing.PartlyForeign) return true;
  return standing === Standing.Unattributed && session.seesUnattributed;
}

async function narrowRows(session: Session, kind: BranchRecordKind, rows: readonly unknown[]): Promise<unknown[]> {
  const kept: unknown[] = [];
  for (const row of rows) if (await rowVisible(session, kind, row)) kept.push(row);
  return kept;
}

async function narrowListResponse(c: Context, session: Session, kind: BranchRecordKind): Promise<void> {
  const response = c.res;
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("application/json")) return;
  const payload: unknown = await response.clone().json();
  let narrowed: unknown;
  if (Array.isArray(payload)) {
    narrowed = await narrowRows(session, kind, payload);
  } else if (payload !== null && typeof payload === "object") {
    const record = { ...(payload as Record<string, unknown>) };
    let sawRows = false;
    for (const [key, value] of Object.entries(record)) {
      if (!Array.isArray(value)) continue;
      sawRows = true;
      const kept = await narrowRows(session, kind, value);
      if (typeof record["total"] === "number" && record["total"] === value.length) record["total"] = kept.length;
      record[key] = kept;
    }
    if (!sawRows) {
      c.res = undefined as unknown as Response;
      c.res = branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
      return;
    }
    narrowed = record;
  } else {
    return;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  c.res = undefined as unknown as Response;
  c.res = new Response(JSON.stringify(narrowed), { status: 200, headers });
}

export interface BranchPolicyEnforcementOptions {
  readonly resolveAuthContext: AuthContextResolver;
  readonly directory?: BranchDirectory;
  readonly table?: readonly BranchPolicyEntry[];
}

/**
 * SECURITY INVARIANT — deny by default. Mounted once, above every route: a
 * session restricted to some branches reaches a route only through the policy
 * its family declares. The per-route permission gates run after this and know
 * nothing of it, which is the point — a route nobody wired is still closed.
 *
 * An unrestricted session is one with NO branch restriction; holding `"*"`
 * does not make a narrow grant wide.
 */
export function branchPolicyEnforcement(options: BranchPolicyEnforcementOptions): MiddlewareHandler {
  const table = options.table ?? BRANCH_POLICY_TABLE;
  return async function enforceBranchPolicy(c, next) {
    if (options.directory) c.set(BRANCH_DIRECTORY_KEY, options.directory);
    const routePath = terminalRoutePathOf(c);
    if (!routePath) return next();
    const ctx = await options.resolveAuthContext(c);
    if (!ctx.authenticated) return next();
    const directory = options.directory;
    if (ctx.branchGrant === ALL_SCOPE) {
      if (isRead(c) || !directory) return next();
      const resolve = async (kind: BranchRecordKind, id: string) => (kind === K.Branch ? [id] : directory.branchesOf(kind, id, BranchAccess.Write));
      const mismatch = await treasuryMismatchRefusal(c, resolve, TREASURY_HOLDER_KEYS, branchPolicyFor(routePath, table), routePath, await readJsonBody(c));
      return mismatch ?? next();
    }

    const session: Session = {
      ctx,
      grant: ctx.branchGrant,
      seesUnattributed: can(ctx, VIEW_UNATTRIBUTED_PERMISSION),
      directory: options.directory,
      access: isRead(c) ? BranchAccess.Read : BranchAccess.Write,
      cache: new Map(),
    };
    c.set(BRANCH_SESSION_KEY, session);
    const branchByWarehouse = await c.get("warehouseBranches")?.();
    if (branchByWarehouse) {
      c.set(GRANTED_WAREHOUSES_KEY, [...branchByWarehouse].filter(([, branchId]) => session.grant.includes(branchId)).map(([id]) => id));
    }

    const entry = branchPolicyFor(routePath, table);
    if (!entry) return branchRefusal(c, BranchRefusalCode.PolicyUndeclared);
    if (entry.policy === BranchPolicy.CompanyWide || subPathListed(entry, routePath, entry.companyWide, c.req.method)) {
      return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    }
    if (entry.policy === BranchPolicy.Public || entry.policy === BranchPolicy.SelfOnly) return next();
    if (entry.policy === BranchPolicy.SharedReadOnly) {
      return isRead(c) ? next() : branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    }

    const outsideQuery = await queryRefusal(c, session, entry);
    if (outsideQuery) return outsideQuery;
    const stored = await storedRecordRefusal(c, session, entry, routePath);
    if (stored) return stored;
    if (!isRead(c)) {
      const body = await readJsonBody(c);
      const refusal =
        (await bodyRefusal(c, session, entry, body)) ??
        (await treasuryMismatchRefusal(c, (kind, id) => lookup(session, kind, id), RESTRICTED_TREASURY_HOLDER_KEYS, entry, routePath, body)) ??
        defaultBranchRefusal(c, session, entry, routePath, body);
      if (refusal) return refusal;
      return next();
    }
    if (entry.policy !== BranchPolicy.Scoped || paramNamesOf(routePath).length > 0) return next();

    const reads = subPathListed(entry, routePath, entry.handlerNarrowed) ? ScopedReads.HandlerNarrows : (entry.reads ?? ScopedReads.Refused);
    if (reads === ScopedReads.Refused) return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    await next();
    if (reads === ScopedReads.Rows && entry.rows) await narrowListResponse(c, session, entry.rows);
  };
}
