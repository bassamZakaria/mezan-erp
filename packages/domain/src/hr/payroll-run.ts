import type { Money } from "../money/index.js";

/**
 * Payroll runs and payslips — docs/catalog/06-crm-hr.md "الرواتب".
 *
 * A run covers one calendar month (the catalog's create dialog offers exactly
 * السنة + الشهر), computes one payslip per employee from that employee's
 * ACTIVE contract, and posts ONE balanced journal entry for the whole run when
 * it is approved.
 *
 * The payslip is deliberately a LINE MODEL rather than a handful of totals:
 * earnings, deductions and employer contributions are separate typed lines
 * each carrying its own GL account, so statutory rules (income tax brackets,
 * social-insurance shares) can be added later as configured line producers
 * WITHOUT changing the payslip, the posting, or the screens. The catalog
 * specifies no Egyptian tax or social-insurance formula, so this build
 * computes none — see docs/catalog/06 §"الرواتب" and the report accompanying
 * this phase for the exhaustive list of unimplemented rules.
 */

export type PayrollRunStatus = "draft" | "calculated" | "approved" | "disbursed" | "cancelled";

export interface PayrollRunStatusDefinition {
  readonly code: PayrollRunStatus;
  readonly labelAr: string;
}

export const PAYROLL_RUN_STATUS_DEFINITIONS: readonly PayrollRunStatusDefinition[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "calculated", labelAr: "محتسب" },
  { code: "approved", labelAr: "معتمد" },
  { code: "disbursed", labelAr: "مصروف" },
  { code: "cancelled", labelAr: "ملغى" },
] as const;

export function getPayrollRunStatusLabel(status: PayrollRunStatus): string {
  return PAYROLL_RUN_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** docs/catalog/06 "الرواتب" filter chips: مسودة → محتسب → معتمد → مصروف, or ملغى. */
export const ALLOWED_PAYROLL_RUN_TRANSITIONS: Record<PayrollRunStatus, readonly PayrollRunStatus[]> = {
  draft: ["calculated", "cancelled"],
  calculated: ["calculated", "approved", "cancelled"],
  approved: ["disbursed"],
  disbursed: [],
  cancelled: [],
};

export function canTransitionPayrollRun(from: PayrollRunStatus, to: PayrollRunStatus): boolean {
  return ALLOWED_PAYROLL_RUN_TRANSITIONS[from].includes(to);
}

/** What a payslip line does to the net: adds to it, takes from it, or is an employer-side cost that never touches it. */
export type PayslipLineKind = "earning" | "deduction" | "employer_contribution";

/** Where a line came from — the audit trail for "why is my net this number?". */
export type PayslipLineSource =
  | "contract_basic"
  | "contract_allowance"
  | "contract_deduction"
  | "unpaid_leave"
  | "advance_recovery";

export interface PayslipLine {
  readonly id: string;
  readonly kind: PayslipLineKind;
  readonly source: PayslipLineSource;
  readonly nameAr: string;
  readonly amount: Money;
  /**
   * The line's own GL account: the DEBIT account for an earning/employer
   * contribution, the CREDIT account for a deduction. Null means "use the
   * run's account mapping default" — resolved at posting time, never guessed
   * silently at calculation time.
   */
  readonly glAccountId: string | null;
  /** The advance this line recovers, for `advance_recovery` lines. */
  readonly referenceId: string | null;
}

export interface Payslip {
  readonly id: string;
  /** PS-###### numbering-engine number. */
  readonly number: string;
  readonly runId: string;
  readonly employeeId: string;
  readonly contractId: string;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Calendar days in the period, and the days the contract was actually live within it (the proration basis). */
  readonly periodDays: number;
  readonly paidDays: number;
  readonly lines: readonly PayslipLine[];
  readonly grossEarnings: Money;
  readonly totalDeductions: Money;
  readonly employerContributions: Money;
  readonly netPay: Money;
  readonly createdAt: string;
}

export interface PayrollRun {
  readonly id: string;
  /** PR-###### numbering-engine number. */
  readonly number: string;
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Optional branch scope; null = every branch. */
  readonly branchId: string | null;
  readonly currency: string;
  readonly status: PayrollRunStatus;
  readonly employeeCount: number;
  readonly totalGross: Money;
  readonly totalDeductions: Money;
  readonly totalEmployerContributions: Money;
  readonly totalNet: Money;
  /**
   * Whether an unpaid-leave day source was bound when the run was calculated.
   * "none" means NO unpaid-leave day was deducted because nothing supplies
   * them yet — recorded on the run so a wrong net is never silently plausible.
   */
  readonly unpaidLeaveSource: "none" | "provider";
  /** Employees skipped, inputs missing, assumptions applied — surfaced verbatim in the UI. */
  readonly warnings: readonly string[];
  readonly journalEntryId: string | null;
  readonly disbursementVoucherId: string | null;
  readonly calculatedAt: string | null;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly disbursedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
}

/** Persistence port for payroll runs. The domain depends on this interface only. */
export interface PayrollRunRepository {
  findById(id: string): Promise<PayrollRun | null>;
  findByPeriod(year: number, month: number, branchId: string | null): Promise<PayrollRun | null>;
  list(): Promise<PayrollRun[]>;
  create(run: PayrollRun): Promise<void>;
  update(run: PayrollRun): Promise<void>;
}

/** Persistence port for payslips. */
export interface PayslipRepository {
  findById(id: string): Promise<Payslip | null>;
  listByRunId(runId: string): Promise<Payslip[]>;
  listByEmployeeId(employeeId: string): Promise<Payslip[]>;
  create(payslip: Payslip): Promise<void>;
  /** Drops a run's payslips so a مسودة/محتسب run can be recalculated from scratch. */
  deleteByRunId(runId: string): Promise<void>;
}

/**
 * Unpaid-leave days per employee within a payroll period.
 *
 * This is the SEAM to the attendance/leave-balance side of HR (leave policies,
 * balances, accrual batches), which is built separately: payroll only needs a
 * day count. Until an implementation is bound, `PayrollCalculationDeps.unpaidLeave`
 * is undefined and every run records `unpaidLeaveSource: "none"`.
 */
export interface UnpaidLeaveDaysProvider {
  unpaidDaysFor(employeeId: string, periodStart: string, periodEnd: string): Promise<number>;
}

/**
 * GL accounts a payroll run posts against. Every one is a postable leaf of the
 * standard chart of accounts (packages/domain/src/accounts/coa-template.ts).
 */
export interface PayrollGlAccounts {
  /** Debited with gross earnings. */
  readonly salaryExpenseAccountId: string;
  /** Credited with net pay — cleared when the run is disbursed from treasury. */
  readonly salariesPayableAccountId: string;
  /** Credited with advance recovery, reducing the employee-advance asset. */
  readonly employeeAdvanceAccountId: string;
  /** Credited with any deduction line that carries no account of its own. */
  readonly deductionLiabilityAccountId: string;
  readonly employerContributionExpenseAccountId: string;
  readonly employerContributionLiabilityAccountId: string;
}

/** System defaults, mapping onto the standard COA leaves 5120 / 2170 / 1160 / 2190 / 5130. */
export const PAYROLL_GL_ACCOUNTS: PayrollGlAccounts = {
  salaryExpenseAccountId: "5120",
  salariesPayableAccountId: "2170",
  employeeAdvanceAccountId: "1160",
  deductionLiabilityAccountId: "2190",
  employerContributionExpenseAccountId: "5130",
  employerContributionLiabilityAccountId: "2190",
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInPayrollMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 30);
}

export interface PayrollPeriodBounds {
  readonly start: string;
  readonly end: string;
  readonly days: number;
}

/** Inclusive first/last calendar day of a payroll month. */
export function payrollPeriodBounds(year: number, month: number): PayrollPeriodBounds {
  const days = daysInPayrollMonth(year, month);
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(days).padStart(2, "0")}`, days };
}

/** Inclusive day count between two "YYYY-MM-DD" dates; 0 when the range is empty. */
export function inclusiveDays(start: string, end: string): number {
  if (end < start) return 0;
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}
