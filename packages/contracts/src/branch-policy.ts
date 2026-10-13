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
  MaterialConsumption = "material_consumption",
  SiteIssue = "site_issue",
  SiteReceipt = "site_receipt",
  SiteCustody = "site_custody",
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
  /** The warehouses a stored record stands on: empty for one that names none, null when nothing holds the id. */
  warehousesOf(kind: BranchRecordKind, id: string): Promise<readonly string[] | null> | readonly string[] | null;
  /**
   * The warehouses a WRITE on a stored record draws on, when that is fewer
   * than all it names: a van trip is worked from its van, a site issue leaves
   * the store it is issued from. Null when the family has no such rule.
   */
  actingWarehousesOf(kind: BranchRecordKind, id: string): Promise<readonly string[] | null> | readonly string[] | null;
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
  /**
   * SECURITY: the only fields of a shared record a branch-restricted session
   * may set or change — an allowlist, so a field added to the record later is
   * closed to a branch until someone decides it is local.
   */
  readonly branchEditableFields?: readonly string[];
  /** SECURITY: only an unrestricted session creates a record of this family; a branch asks head office for one. */
  readonly headOfficeCreates?: boolean;
  /** Fields a branch-restricted session may also state when it CREATES the record, because the record cannot exist without them. */
  readonly branchCreatableFields?: readonly string[];
  /**
   * Fields a branch-restricted session may set when it creates the record and
   * afterwards on a record ITS OWN branch owns — never on the company's record
   * or another branch's.
   */
  readonly branchOwnedFields?: readonly string[];
  /** POST sub-paths of a read-only family that compute and store nothing. */
  readonly readPosts?: readonly string[];
  /** A family that moves stock between two warehouses, so its warehouses need not share the document's branch. */
  readonly movesBetweenWarehouses?: boolean;
  /**
   * LEDGER INVARIANT: a document of this family is booked to the branch of the
   * warehouse its goods land in, whichever branch raised the document it names
   * as its source. A return is taken where the customer brings the goods back.
   */
  readonly bookedToItsWarehouse?: boolean;
  /** A record of this family that no branch owns is the company's: readable by every session, writable only by an unrestricted one. */
  readonly unownedIsCompanys?: boolean;
  readonly query?: Readonly<Record<string, BranchRecordKind>>;
  /** What a body key that means different records on different routes names in this family. */
  readonly bodyKinds?: Readonly<Record<string, BranchRecordKind>>;
  /**
   * SECURITY: set only where the by-id read serves a record cut to the lines
   * in the caller's view (`entryInView`). A record whose branch lines are all
   * another branch's is then still read, through its «غير مخصص» lines alone,
   * by a session that may see them — the same lines its lists already show.
   */
  readonly readCutToCallersLines?: boolean;
}

const K = BranchRecordKind;
const COUNTS_AND_STATS = ["/counts", "/stats"] as const;

function scoped(prefix: string, record: BranchRecordKind, extra: Partial<BranchPolicyEntry> = {}): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.Scoped, rows: record, reads: ScopedReads.Rows, ...extra, params: { id: record, ...extra.params } };
}

function handlerScoped(prefix: string, extra: Partial<BranchPolicyEntry> = {}): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.Scoped, reads: ScopedReads.HandlerNarrows, ...extra };
}

function shared(
  prefix: string,
  params?: Readonly<Record<string, BranchRecordKind | null>>,
  branchEditableFields?: readonly string[],
  branchCreatableFields?: readonly string[],
): BranchPolicyEntry {
  return {
    prefix,
    policy: BranchPolicy.MasterDataShared,
    ...(params ? { params } : {}),
    ...(branchEditableFields ? { branchEditableFields } : {}),
    ...(branchCreatableFields ? { branchCreatableFields } : {}),
  };
}

const RECORD_IDENTITY_FIELDS = ["id", "code", "nameAr", "nameEn"] as const;
const CONTACT_FIELDS = ["phone", "email", "contactPerson", "notes"] as const;

function readOnly(prefix: string, extra: Partial<BranchPolicyEntry> = {}): BranchPolicyEntry {
  return { prefix, policy: BranchPolicy.SharedReadOnly, ...extra };
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

  shared(
    "/items",
    undefined,
    [...RECORD_IDENTITY_FIELDS, "description", "barcodes", "categoryId", "brandId", "seasonId", "specifications"],
    ["type", "baseUnitCode"],
  ),
  shared("/item-units"),
  shared("/item-categories"),
  shared("/item-brands"),
  shared("/item-seasons"),
  shared("/item-specifications"),
  shared("/inventory/product-templates"),
  readOnly("/price-lists", { readPosts: ["/resolve-price"] }),
  readOnly("/promotions", { readPosts: ["/evaluate"] }),
  readOnly("/manufacturing/boms"),
  readOnly("/manufacturing/configurable-products"),
  {
    ...shared("/customers", { id: K.Customer }, [...RECORD_IDENTITY_FIELDS, ...CONTACT_FIELDS, "address"]),
    // SECURITY: `branchId` is here, not among the always-editable fields — a
    // branch that could claim the company's customer would then own its tax identity.
    branchOwnedFields: ["branchId", "taxNumber", "nationalId", "etaBuyerType", "commercialRegistrationNumber"],
  },
  shared("/suppliers", { id: K.Supplier }, [...RECORD_IDENTITY_FIELDS, ...CONTACT_FIELDS, "addressCity", "addressDistrict", "addressStreet"]),
  shared("/cost-centers", { id: K.CostCenter }),

  companyWide("/data-migration"),
  companyWide("/security-reports"),
  companyWide("/audit/verify"),
  companyWide("/revaluation"),
  companyWide("/reconciliation"),
  companyWide("/tax"),
  companyWide("/gl/year-end-close"),
  companyWide("/period-close"),
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
  { ...companyWide("/contracting/site/issues"), params: { id: K.SiteIssue }, movesBetweenWarehouses: true },
  { ...companyWide("/contracting/site/receipts"), params: { id: K.SiteReceipt }, movesBetweenWarehouses: true },
  { ...companyWide("/contracting/site/consumptions"), params: { id: K.MaterialConsumption } },
  { ...companyWide("/contracting/site/custody"), params: { id: K.SiteCustody } },
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
  handlerScoped("/financial-reports", { companyWide: ["/vat-return"] }),
  handlerScoped("/reports", { params: { id: null } }),
  handlerScoped("/attachments", { params: { id: null } }),
  handlerScoped("/gl/journal-entries", { params: { id: K.JournalEntry }, defaultsLineBranch: true, readCutToCallersLines: true }),
  handlerScoped("/gl/accounts", { params: { accountId: null } }),
  scoped("/gl/recurring/templates", K.RecurringTemplate, { params: { entryId: K.JournalEntry } }),
  scoped("/gl/recurring/runs", K.RecurringRun, { bodyKinds: { templateId: K.RecurringTemplate } }),

  scoped("/warehouses", K.Warehouse),
  scoped("/treasury-accounts", K.TreasuryAccount, {
    handlerNarrowed: COUNTS_AND_STATS,
    unownedIsCompanys: true,
    headOfficeCreates: true,
    branchEditableFields: ["name", "nameEn"],
  }),
  scoped("/sales-invoices", K.SalesInvoice, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true, params: { lineId: null } }),
  scoped("/sales-quotes", K.SalesQuote, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/sales-returns", K.SalesReturn, { handlerNarrowed: COUNTS_AND_STATS, bookedToItsWarehouse: true, params: { lineId: null, invoiceId: null } }),
  scoped("/purchases/orders", K.PurchaseOrder, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/purchases/receipts", K.GoodsReceipt, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/purchases/invoices", K.PurchaseInvoice, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true, params: { lineId: null } }),
  scoped("/purchase-returns", K.PurchaseReturn, { handlerNarrowed: COUNTS_AND_STATS, params: { lineId: null, invoiceId: null } }),
  scoped("/rfqs", K.Rfq, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/landed-costs", K.LandedCost),
  scoped("/vouchers", K.Voucher, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/allocations", K.VoucherAllocation),
  scoped("/open-invoices", K.AnyInvoice),
  scoped("/cheques", K.Cheque, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/bank-statements", K.BankStatement, {
    params: { treasuryAccountId: K.TreasuryAccount, lineId: null, suggestionId: null },
  }),
  scoped("/assets", K.Asset, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/assets/depreciation/runs", K.DepreciationRun, { handlerNarrowed: COUNTS_AND_STATS, defaultsBranch: true }),
  scoped("/field/vans", K.Van),
  scoped("/field/van-trips", K.VanTrip, { defaultsBranch: true }),
  scoped("/pos/terminals", K.PosTerminal),
  scoped("/shift-templates", K.ShiftTemplate, { defaultsBranch: true, unownedIsCompanys: true }),
  scoped("/crm/opportunities", K.CrmOpportunity, { defaultsBranch: true }),
  scoped("/crm/activities", K.CrmActivity),
  scoped("/installments/plans", K.InstallmentPlan, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/installments/follow-ups", K.CollectionFollowUp, { handlerNarrowed: COUNTS_AND_STATS, bodyKinds: { planId: K.InstallmentPlan } }),
  scoped("/workflow/requests", K.ApprovalRequest, { handlerNarrowed: ["/pending-count"] }),
  scoped("/eta/submissions", K.EtaSubmission),
  scoped("/eta/receipts", K.EtaReceipt, { params: { internalId: K.EtaReceipt, kind: null, docId: K.SourceDocument }, rows: K.EtaReceipt }),

  scoped("/inventory/stock-adjustments", K.StockAdjustment, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/inventory/stock-transfers", K.StockTransfer, { handlerNarrowed: COUNTS_AND_STATS, movesBetweenWarehouses: true }),
  scoped("/inventory/physical-counts", K.PhysicalCount, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/inventory/writedown-runs", K.WritedownRun),
  scoped("/inventory/adjustments", K.PostedStockDocument),
  scoped("/inventory/transfers", K.PostedStockDocument, { movesBetweenWarehouses: true }),
  handlerScoped("/inventory", { params: { itemId: null }, query: { warehouseId: K.Warehouse } }),

  scoped("/manufacturing/work-orders", K.WorkOrder, { handlerNarrowed: COUNTS_AND_STATS }),
  scoped("/manufacturing/config-instances", K.ConfigInstance),

  scoped("/hr/employees", K.Employee),
  scoped("/hr/contracts", K.EmployeeContract),
  scoped("/hr/attendance", K.Attendance, { companyWide: ["/import"], handlerNarrowed: ["/summary"] }),
  scoped("/hr/leave-requests", K.LeaveRequest, { handlerNarrowed: ["/counts"] }),
  scoped("/hr/leave-balances", K.LeaveBalance),
  scoped("/hr/advances", K.EmployeeAdvance),
  scoped("/hr/payroll/garnishments", K.Garnishment, { bodyKinds: { runId: K.PayrollRun } }),
  scoped("/hr/payroll/runs", K.PayrollRun, { defaultsBranch: true }),
  scoped("/hr/payroll/payslips", K.Payslip, { bodyKinds: { runId: K.PayrollRun } }),
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
  entryId: K.JournalEntry,
  docId: K.AnyDocument,
};

export enum BranchRefusalCode {
  NotFound = "NOT_FOUND",
  BranchOutOfScope = "BRANCH_OUT_OF_SCOPE",
  CompanyWideOnly = "COMPANY_WIDE_REPORT",
  PolicyUndeclared = "BRANCH_POLICY_UNDECLARED",
  BranchRequired = "BRANCH_REQUIRED",
  TreasuryBranchMismatch = "TREASURY_BRANCH_MISMATCH",
  WarehouseBranchMismatch = "WAREHOUSE_BRANCH_MISMATCH",
  SharedFieldRestricted = "SHARED_FIELD_RESTRICTED",
  WarehouseOutOfScope = "WAREHOUSE_OUT_OF_SCOPE",
  HeadOfficeCreatesOnly = "HEAD_OFFICE_CREATES_ONLY",
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
  [BranchRefusalCode.SharedFieldRestricted]: {
    error: BranchRefusalCode.SharedFieldRestricted,
    message: "هذا الحقل يسري على كل الفروع، ولا يحدده أو يغيّره حساب مقيّد بفروع محددة. اطلب التعديل من الإدارة.",
    messageEn: "This field applies to every branch and cannot be set or changed by an account restricted to specific branches. Ask head office to change it.",
  },
  [BranchRefusalCode.WarehouseOutOfScope]: {
    error: BranchRefusalCode.WarehouseOutOfScope,
    message: "المستودع خارج نطاق المستودعات المصرّح لك بها.",
    messageEn: "The warehouse is outside the warehouses granted to you.",
  },
  [BranchRefusalCode.HeadOfficeCreatesOnly]: {
    error: BranchRefusalCode.HeadOfficeCreatesOnly,
    message: "إنشاء هذا السجل من اختصاص الإدارة العامة، ولا ينشئه حساب مقيّد بفروع محددة. اطلب من الإدارة إنشاءه لفرعك.",
    messageEn: "Only head office creates this record; an account restricted to specific branches cannot. Ask head office to create it for your branch.",
  },
  [BranchRefusalCode.WarehouseBranchMismatch]: {
    error: BranchRefusalCode.WarehouseBranchMismatch,
    message: "المستودع لا يتبع فرع المستند. اختر مستودعًا من الفرع نفسه أو غيّر الفرع.",
    messageEn: "The warehouse does not belong to the document's branch. Choose a warehouse of the same branch, or change the branch.",
  },
};

export function branchPolicyFor(routePath: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchPolicyEntry | undefined {
  let best: BranchPolicyEntry | undefined;
  for (const entry of table) {
    const matches = routePath === entry.prefix || routePath.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best;
}

export function branchSubPathListed(entry: BranchPolicyEntry, routePath: string, list: readonly string[] | undefined, method?: string): boolean {
  if (!list) return false;
  const rest = routePath.slice(entry.prefix.length);
  return list.some((listed) => {
    const [first, second] = listed.split(" ");
    const sub = second ?? first!;
    if (second !== undefined && first !== method) return false;
    return rest === sub || (second === undefined && rest.startsWith(`${sub}/`));
  });
}

export enum BranchRestrictedAccess {
  Full = "full",
  ReadOnly = "read_only",
  Unavailable = "unavailable",
}

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * What a session restricted to branches may do with an API path — the SAME
 * table the server enforces, read by the client so a screen, a tile or a
 * button the server would refuse is not drawn. Hiding, never enforcement.
 */
export function branchRestrictedAccess(path: string, method = "GET", table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchRestrictedAccess {
  const pathname = path.split("?")[0]!;
  const entry = branchPolicyFor(pathname, table);
  if (!entry || entry.policy === BranchPolicy.CompanyWide || branchSubPathListed(entry, pathname, entry.companyWide, method)) {
    return BranchRestrictedAccess.Unavailable;
  }
  if (entry.headOfficeCreates && method === "POST" && pathname === entry.prefix) return BranchRestrictedAccess.Unavailable;
  if (entry.policy === BranchPolicy.SharedReadOnly && !branchSubPathListed(entry, pathname, entry.readPosts)) {
    return READ_METHODS.has(method) ? BranchRestrictedAccess.ReadOnly : BranchRestrictedAccess.Unavailable;
  }
  return BranchRestrictedAccess.Full;
}
