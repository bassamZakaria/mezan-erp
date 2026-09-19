import type { Money } from "../money/index.js";

export enum PeriodCloseCheckCode {
  Drafts = "drafts",
  SubledgerTies = "subledger_ties",
  BankStatements = "bank_statements",
  FxRevaluation = "fx_revaluation",
  RecurringJournals = "recurring_journals",
  Depreciation = "depreciation",
  SequenceGaps = "sequence_gaps",
  EtaErrors = "eta_errors",
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
  Reconciliation = "reconciliation",
  TrialBalance = "trial-balance-report",
  AgingCustomers = "report-aging-customers",
  AgingSuppliers = "report-aging-suppliers",
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
}

export enum PeriodCloseTieKey {
  Receivables = "receivables",
  Payables = "payables",
  Inventory = "inventory",
  TrialBalance = "trial_balance",
}

export enum PeriodCloseFindingKind {
  Drafts = "drafts",
  Tie = "tie",
  BankAccount = "bank_account",
  ForeignCurrency = "foreign_currency",
  RecurringTemplate = "recurring_template",
  DepreciationRun = "depreciation_run",
  SequenceGap = "sequence_gap",
  EtaSubmission = "eta_submission",
}

export enum PeriodCloseFindingState {
  Ok = "ok",
  Missing = "missing",
  Draft = "draft",
  NotFinalized = "not_finalized",
  Mismatch = "mismatch",
  Unavailable = "unavailable",
}

export enum PeriodCloseEntryState {
  Missing = "missing",
  Draft = "draft",
  Posted = "posted",
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
  readonly message: string | null;
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

export interface PeriodCloseDraftCount {
  readonly kind: PeriodCloseDocKind;
  readonly count: number;
}

export interface PeriodCloseTie {
  readonly key: PeriodCloseTieKey;
  readonly difference: Money | null;
  readonly asOfDate: string;
  readonly unavailableReason: string | null;
}

export interface PeriodCloseBankAccount {
  readonly treasuryAccountId: string;
  readonly label: string;
  readonly finalizedThrough: string | null;
  readonly hasActivity: boolean;
}

export interface PeriodCloseRecurringDue {
  readonly templateId: string;
  readonly label: string;
  readonly periodKey: string;
  readonly entry: PeriodCloseEntryState;
}

export interface PeriodCloseDepreciationState {
  readonly depreciableAssets: number;
  readonly run: PeriodCloseEntryState;
}

export interface PeriodCloseSequenceGap {
  readonly source: PeriodCloseDocKind;
  readonly series: string;
  readonly missing: readonly string[];
}

export interface PeriodCloseEtaError {
  readonly internalId: string;
}

export interface PeriodCloseSources {
  draftCounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseDraftCount[]>;
  subledgerTies(window: PeriodCloseWindow): Promise<readonly PeriodCloseTie[]>;
  bankAccounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseBankAccount[]>;
  foreignCurrencies(window: PeriodCloseWindow): Promise<readonly string[]>;
  fxRevaluationPosted(window: PeriodCloseWindow): Promise<boolean>;
  recurringDue(window: PeriodCloseWindow): Promise<readonly PeriodCloseRecurringDue[]>;
  depreciation(window: PeriodCloseWindow): Promise<PeriodCloseDepreciationState>;
  sequenceGaps(window: PeriodCloseWindow): Promise<readonly PeriodCloseSequenceGap[]>;
  etaErrors(window: PeriodCloseWindow): Promise<readonly PeriodCloseEtaError[]>;
}

export interface PeriodCloseCheckDefinition {
  readonly code: PeriodCloseCheckCode;
  readonly fix: PeriodCloseFixTarget | null;
  evaluate(window: PeriodCloseWindow, sources: PeriodCloseSources): Promise<Omit<PeriodCloseCheckResult, "code" | "fix" | "message">>;
}
