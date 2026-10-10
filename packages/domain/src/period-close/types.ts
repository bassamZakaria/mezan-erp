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
}

export enum PeriodCloseFindingState {
  Ok = "ok",
  Missing = "missing",
  Draft = "draft",
  Pending = "pending",
  NotFinalized = "not_finalized",
  Mismatch = "mismatch",
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
  readonly label: string;
  readonly periodEnd: string;
  readonly finalized: boolean;
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
  draftCounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseDocCount[]>;
  pendingApprovalCounts(window: PeriodCloseWindow): Promise<readonly PeriodCloseDocCount[]>;
  subledgerTies(window: PeriodCloseWindow): Promise<readonly PeriodCloseTie[]>;
  trialBalance(window: PeriodCloseWindow): Promise<PeriodCloseTrialBalance>;
  bankStatements(window: PeriodCloseWindow): Promise<readonly PeriodCloseBankStatement[]>;
  foreignCurrencies(window: PeriodCloseWindow): Promise<readonly string[]>;
  fxRevaluationPosted(window: PeriodCloseWindow): Promise<boolean>;
  recurringDue(window: PeriodCloseWindow): Promise<readonly PeriodCloseRecurringDue[]>;
  depreciation(window: PeriodCloseWindow): Promise<PeriodCloseDepreciationState>;
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
