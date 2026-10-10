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
  Approvals = "approvals",
  Reconciliation = "reconciliation",
  TrialBalance = "trial-balance-report",
  BankReconciliation = "bank-reconciliation",
  Revaluation = "revaluation",
  RecurringJournals = "recurring-journals",
  Eta = "eta",
}

export enum PeriodCloseFindingKindDTO {
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

export enum PeriodCloseFindingStateDTO {
  Ok = "ok",
  Missing = "missing",
  Draft = "draft",
  Pending = "pending",
  NotFinalized = "not_finalized",
  Mismatch = "mismatch",
}

export enum PeriodCloseErrorCodeDTO {
  Blocked = "PERIOD_CLOSE_BLOCKED",
  OverrideNotPermitted = "PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED",
}

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

export const periodCloseRefusalSchema = z.object({
  error: z.nativeEnum(PeriodCloseErrorCodeDTO),
  message: z.string(),
  messageEn: z.string(),
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
});

export type PeriodCloseFindingDTO = z.infer<typeof periodCloseFindingSchema>;
export type PeriodCloseCheckDTO = z.infer<typeof periodCloseCheckSchema>;
export type PeriodCloseChecklistDTO = z.infer<typeof periodCloseChecklistSchema>;
export type PeriodCloseRequestDTO = z.infer<typeof periodCloseRequestSchema>;
export type PeriodCloseRefusalDTO = z.infer<typeof periodCloseRefusalSchema>;
export type PeriodCloseSummaryDTO = z.infer<typeof periodCloseSummarySchema>;
