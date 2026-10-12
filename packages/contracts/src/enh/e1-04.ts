import { z } from "zod";
import { fiscalPeriodStatusSchema } from "../fiscal-period.js";
import { isoDay } from "../iso-date.js";
import { moneyString } from "../money-string.js";

export enum PeriodCloseCheckCodeDTO {
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

export enum PeriodCloseCheckStatusDTO {
  Pass = "pass",
  Fail = "fail",
  NotApplicable = "not_applicable",
  Unavailable = "unavailable",
}

export enum PeriodCloseFixTargetDTO {
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

export enum PeriodCloseDocKindDTO {
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

export const periodCloseDocKindSchema = z.nativeEnum(PeriodCloseDocKindDTO);

export enum PeriodCloseFindingKindDTO {
  Drafts = "drafts",
  PendingApproval = "pending_approval",
  Tie = "tie",
  TrialBalance = "trial_balance",
  BankStatement = "bank_statement",
  ForeignCurrency = "foreign_currency",
  ForeignResidue = "foreign_residue",
  RecurringTemplate = "recurring_template",
  DepreciationRun = "depreciation_run",
  SequenceGap = "sequence_gap",
  EtaSubmission = "eta_submission",
  PayrollDue = "payroll_due",
  PayrollPartMonthTax = "payroll_part_month_tax",
}

export enum PeriodCloseFindingStateDTO {
  Ok = "ok",
  Missing = "missing",
  Draft = "draft",
  Pending = "pending",
  NotFinalized = "not_finalized",
  Unreconciled = "unreconciled",
  Mismatch = "mismatch",
  Reversed = "reversed",
  NotCovered = "not_covered",
  ForcedFinalization = "forced_finalization",
  DoubleCharged = "double_charged",
}

export enum PeriodCloseErrorCodeDTO {
  Blocked = "PERIOD_CLOSE_BLOCKED",
  OverrideNotPermitted = "PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED",
  LockOverrideSameUser = "PERIOD_LOCK_OVERRIDE_SAME_USER",
  ChecksUnavailable = "PERIOD_CLOSE_CHECKS_UNAVAILABLE",
  Unauditable = "PERIOD_CLOSE_UNAUDITABLE",
  Contended = "PERIOD_CLOSE_CONTENDED",
}

export enum PeriodStatusDTO {
  Open = "open",
  Closed = "closed",
  Locked = "locked",
}

export enum PeriodCloseTieKeyDTO {
  Inventory = "inventory",
  Receivables = "ar",
  Payables = "ap",
  RetentionReceivable = "contracting_retention_receivable",
  RetentionPayable = "contracting_retention_payable",
  CustomerAdvances = "contracting_customer_advances",
  WorkInProgress = "contracting_wip",
  Billings = "contracting_billings",
  ContractAsset = "contracting_contract_asset",
  ContractLiability = "contracting_contract_liability",
}

export const periodCloseTieKeySchema = z.nativeEnum(PeriodCloseTieKeyDTO);

export const PERIOD_CLOSE_OVERRIDE_REASON_MIN = 10;
export const PERIOD_CLOSE_OVERRIDE_REASON_MAX = 500;

export const periodCloseCheckCodeSchema = z.nativeEnum(PeriodCloseCheckCodeDTO);
export const periodCloseCheckStatusSchema = z.nativeEnum(PeriodCloseCheckStatusDTO);
export const periodCloseFixTargetSchema = z.nativeEnum(PeriodCloseFixTargetDTO);

export const periodCloseFindingSchema = z.object({
  kind: z.nativeEnum(PeriodCloseFindingKindDTO),
  ref: z.string(),
  label: z.string().nullable(),
  state: z.nativeEnum(PeriodCloseFindingStateDTO),
  passed: z.boolean(),
  fix: periodCloseFixTargetSchema.nullable(),
  count: z.number().int().nullable(),
  amount: moneyString.nullable(),
  asOfDate: isoDay.nullable(),
  items: z.array(z.string()),
});

export const periodCloseCheckSchema = z.object({
  code: periodCloseCheckCodeSchema,
  status: periodCloseCheckStatusSchema,
  fix: periodCloseFixTargetSchema.nullable(),
  findings: z.array(periodCloseFindingSchema),
});

export const periodCloseChecklistSchema = z.object({
  periodId: z.string().min(1),
  year: z.number().int(),
  periodNumber: z.number().int(),
  startDate: isoDay,
  endDate: isoDay,
  periodStatus: fiscalPeriodStatusSchema,
  evaluatedAt: z.string().min(1),
  checks: z.array(periodCloseCheckSchema),
  blocking: z.array(periodCloseCheckCodeSchema),
  canOverride: z.boolean(),
});

/**
 * The ONLY caller-supplied input to a close or a lock. Which checks failed is
 * recomputed by the server on every call; `.strict()` so a client that tries to
 * send its own verdict is refused instead of silently ignored.
 */
export const periodCloseRequestSchema = z
  .object({
    overrideReason: z.string().trim().min(PERIOD_CLOSE_OVERRIDE_REASON_MIN).max(PERIOD_CLOSE_OVERRIDE_REASON_MAX).optional(),
  })
  .strict();

export const periodCloseErrorSchema = z.object({
  error: z.nativeEnum(PeriodCloseErrorCodeDTO),
  message: z.string(),
  messageEn: z.string(),
});

export const periodCloseRefusalSchema = periodCloseErrorSchema.extend({
  failedChecks: z.array(periodCloseCheckCodeSchema),
  checklist: periodCloseChecklistSchema,
});

export const periodCloseSummarySchema = z.object({
  id: z.string().min(1),
  periodId: z.string().min(1),
  closedBy: z.string(),
  closedAt: z.string().min(1),
  overrideReason: z.string().nullable(),
  failedChecks: z.array(periodCloseCheckCodeSchema),
  closingDebit: moneyString,
  closingCredit: moneyString,
  accountCount: z.number().int(),
  sha256: z.string().min(1),
  /** False when the stored row no longer hashes to its own seal, or the seal is not the one the audit trail recorded. */
  sealValid: z.boolean(),
});

export type PeriodCloseFindingDTO = z.infer<typeof periodCloseFindingSchema>;
export type PeriodCloseCheckDTO = z.infer<typeof periodCloseCheckSchema>;
export type PeriodCloseChecklistDTO = z.infer<typeof periodCloseChecklistSchema>;
export type PeriodCloseRequestDTO = z.infer<typeof periodCloseRequestSchema>;
export type PeriodCloseErrorDTO = z.infer<typeof periodCloseErrorSchema>;
export type PeriodCloseRefusalDTO = z.infer<typeof periodCloseRefusalSchema>;
export type PeriodCloseSummaryDTO = z.infer<typeof periodCloseSummarySchema>;
