import type { Money } from "../money/index.js";

export enum PeriodCloseCheckCode {
  Drafts = "drafts",
  PendingApprovals = "pending_approvals",
  SubledgerTies = "subledger_ties",
  TrialBalance = "trial_balance",
  BankStatements = "bank_statements",
  FxRevaluation = "fx_revaluation",
  RecurringJournals = "recurring_journals",
  Depreciation = "depreciation",
  SequenceGaps = "sequence_gaps",
  EtaErrors = "eta_errors",
}

export enum PeriodCloseAction {
  Close = "close",
  Lock = "lock",
}

export enum PeriodStatus {
  Open = "open",
  Closed = "closed",
  Locked = "locked",
}

export enum PeriodCloseCommitOutcome {
  Committed = "committed",
  Stale = "stale",
}

export enum PeriodCloseCheckStatus {
  Pass = "pass",
  Fail = "fail",
  NotApplicable = "not_applicable",
  Unavailable = "unavailable",
}

export enum PeriodCloseFixTarget {
  Journals = "journals",
  SalesInvoices = "sales-invoices",
  PurchaseInvoices = "purchase-invoices",
  GoodsReceipts = "goods-receipts",
  TreasuryVouchers = "treasury-vouchers",
  SalesReturns = "sales-returns",
  PurchaseReturns = "purchase-returns",
  LandedCosts = "landed-costs",
  StockTransfers = "stock-transfers",
  StockAdjustments = "stock-adjustments",
  DepreciationRuns = "depreciation-runs",
  WritedownRuns = "writedown-runs",
  Payroll = "payroll",
  Certificates = "certificates",
  SubcontractCertificates = "subcontract-certificates",
  PhysicalCounts = "physical-counts",
  SiteIssues = "site-issues",
  MaterialConsumption = "material-consumption",
  EquipmentLogs = "equipment-logs",
  Approvals = "approvals",
  Reconciliation = "reconciliation",
  TrialBalance = "trial-balance-report",
  BankReconciliation = "bank-reconciliation",
  Revaluation = "revaluation",
  RecurringJournals = "recurring-journals",
  Eta = "eta",
}

export enum PeriodCloseDocKind {
  JournalEntry = "journal_entry",
  SalesInvoice = "sales_invoice",
  PurchaseInvoice = "purchase_invoice",
  GoodsReceipt = "goods_receipt",
  Voucher = "voucher",
  SalesReturn = "sales_return",
  PurchaseReturn = "purchase_return",
  LandedCost = "landed_cost",
  StockTransfer = "stock_transfer",
  StockAdjustment = "stock_adjustment",
  DepreciationRun = "depreciation_run",
  WritedownRun = "writedown_run",
  PayrollRun = "payroll_run",
  ProgressCertificate = "progress_certificate",
  SubcontractCertificate = "subcontract_certificate",
  PhysicalCount = "physical_count",
  SiteIssue = "site_issue",
  SiteReceipt = "site_receipt",
  MaterialConsumption = "material_consumption",
  EquipmentLog = "equipment_log",
}

export enum PeriodCloseFindingKind {
  Drafts = "drafts",
  PendingApproval = "pending_approval",
  Tie = "tie",
  TrialBalance = "trial_balance",
  BankStatement = "bank_statement",
  ForeignCurrency = "foreign_currency",
  RecurringTemplate = "recurring_template",
  DepreciationRun = "depreciation_run",
  SequenceGap = "sequence_gap",
  EtaSubmission = "eta_submission",
  PayrollDue = "payroll_due",
  PayrollPartMonthTax = "payroll_part_month_tax",
}

export enum PeriodCloseFindingState {
  Ok = "ok",
  Missing = "missing",
  Draft = "draft",
  Pending = "pending",
  NotFinalized = "not_finalized",
  Mismatch = "mismatch",
  Reversed = "reversed",
  NotCovered = "not_covered",
  ForcedFinalization = "forced_finalization",
  DoubleCharged = "double_charged",
}

export enum PeriodCloseEntryState {
  Missing = "missing",
  Draft = "draft",
  Posted = "posted",
  Reversed = "reversed",
}

export interface PeriodCloseFinding {
  readonly kind: PeriodCloseFindingKind;
  readonly ref: string;
  readonly label: string | null;
  readonly state: PeriodCloseFindingState;
  readonly passed: boolean;
  readonly fix: PeriodCloseFixTarget | null;
  readonly count: number | null;
  readonly amount: Money | null;
  readonly asOfDate: string | null;
  readonly items: readonly string[];
}

export interface PeriodCloseCheckResult {
  readonly code: PeriodCloseCheckCode;
  readonly status: PeriodCloseCheckStatus;
  readonly fix: PeriodCloseFixTarget | null;
  readonly findings: readonly PeriodCloseFinding[];
}

export interface PeriodCloseWindow {
  readonly periodId: string;
  readonly year: number;
  readonly periodNumber: number;
  readonly startDate: string;
  readonly endDate: string;
}

export interface PeriodCloseEvaluation extends PeriodCloseWindow {
  readonly evaluatedAt: string;
  readonly checks: readonly PeriodCloseCheckResult[];
  readonly blocking: readonly PeriodCloseCheckCode[];
}

export interface PeriodCloseDocCount {
  readonly kind: PeriodCloseDocKind;
  readonly count: number;
}

export interface PeriodCloseTie {
  readonly key: string;
  readonly label: string;
  readonly controlAccountId: string;
  readonly difference: Money;
  readonly asOfDate: string;
}

export interface PeriodCloseTrialBalance {
  readonly debit: Money;
  readonly credit: Money;
  readonly asOfDate: string;
}

export interface PeriodCloseBankStatement {
  readonly statementId: string;
  readonly treasuryAccountId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly finalized: boolean;
  /** Finalized over unmatched lines or a difference that was not zero. */
  readonly forced: boolean;
}

export interface PeriodCloseBankAccount {
  readonly treasuryAccountId: string;
  readonly label: string;
  /** The first day in the window the account's GL moved; statements have to run unbroken from here to the window's end. */
  readonly firstMovementDate: string;
}

export interface PeriodClosePayrollDue {
  readonly dueEmployees: number;
  readonly uncoveredEmployees: number;
  readonly hasUnpostedRun: boolean;
  /** Part-month payslips whose income tax awaits an annual settlement the engine does not run; reported, never blocking. */
  readonly partMonthTaxedPayslips?: number;
}

export interface PeriodCloseRecurringDue {
  readonly templateId: string;
  readonly label: string;
  readonly periodKey: string;
  readonly entry: PeriodCloseEntryState;
}

export interface PeriodCloseDepreciationGroup {
  readonly branchId: string | null;
  readonly dueAssets: number;
  readonly uncoveredAssets: number;
  readonly uncoveredAssetCodes: readonly string[];
  readonly doubleChargedAssetCodes: readonly string[];
  readonly hasDraftRun: boolean;
}

export interface PeriodCloseSequenceGap {
  readonly source: PeriodCloseDocKind;
  readonly series: string;
  readonly missing: readonly string[];
}

export interface PeriodCloseEtaError {
  readonly internalId: string;
}

export const FX_REVALUATION_ALL_CURRENCIES = "*";

export interface PeriodCloseSources {
  draftCounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseDocCount[]>;
  pendingApprovalCounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseDocCount[]>;
  subledgerTies(window: PeriodCloseWindow): Promise<readonly PeriodCloseTie[]>;
  trialBalance(window: PeriodCloseWindow): Promise<PeriodCloseTrialBalance>;
  bankStatements(window: PeriodCloseWindow): Promise<readonly PeriodCloseBankStatement[]>;
  bankAccountsWithMovement(window: PeriodCloseWindow): Promise<readonly PeriodCloseBankAccount[]>;
  payrollDue(window: PeriodCloseWindow): Promise<PeriodClosePayrollDue>;
  foreignCurrencies(window: PeriodCloseWindow): Promise<readonly string[]>;
  fxRevaluedCurrencies(window: PeriodCloseWindow): Promise<readonly string[]>;
  recurringDue(window: PeriodCloseWindow): Promise<readonly PeriodCloseRecurringDue[]>;
  depreciation(window: PeriodCloseWindow): Promise<readonly PeriodCloseDepreciationGroup[]>;
  sequenceGaps(window: PeriodCloseWindow): Promise<readonly PeriodCloseSequenceGap[]>;
  etaErrors(window: PeriodCloseWindow): Promise<readonly PeriodCloseEtaError[]>;
}

export type PeriodCloseCheckOutcome = Pick<PeriodCloseCheckResult, "status" | "findings">;

export interface PeriodCloseCheckDefinition {
  readonly code: PeriodCloseCheckCode;
  readonly fix: PeriodCloseFixTarget | null;
  evaluate(window: PeriodCloseWindow, sources: PeriodCloseSources): Promise<PeriodCloseCheckOutcome>;
}

export interface PeriodCloseCheckFailure {
  readonly code: PeriodCloseCheckCode;
  readonly error: unknown;
}

export type PeriodCloseFailureReporter = (failure: PeriodCloseCheckFailure) => void;
