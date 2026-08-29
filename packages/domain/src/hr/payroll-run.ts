import type { Money } from "../money/index.js";

/**
 * Payroll runs and payslips — docs/archive/catalog/06-crm-hr.md "الرواتب".
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
 * computes none — `PAYROLL_UNIMPLEMENTED_RULES` below is the exhaustive,
 * machine-readable list of what is missing, and the screens render it beside
 * every net figure so a net is never read as if it were final.
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

/** docs/archive/catalog/06 "الرواتب" filter chips: مسودة → محتسب → معتمد → مصروف, or ملغى. */
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

/**
 * The statutory/contractual rules this build does NOT compute, as data.
 *
 * A payslip with no tax line is indistinguishable from a payslip whose tax is
 * zero, so the scope of the engine has to be readable next to the net figure
 * it produces. Every entry here corresponds to a rule the catalog never
 * specified a formula for; adding a producer for one means deleting its entry.
 */
export interface PayrollUnimplementedRule {
  readonly code: string;
  readonly labelAr: string;
  readonly detailAr: string;
  /** True when the gap applies to every payslip this engine produces, regardless of that employee's contract — the always-on gap behind every net figure. */
  readonly appliesToEveryPayslip: boolean;
}

export const PAYROLL_UNIMPLEMENTED_RULES: readonly PayrollUnimplementedRule[] = [
  {
    code: "annual_tax_settlement",
    labelAr: "التسوية الضريبية السنوية",
    detailAr:
      "تُحتسب الضريبة شهرياً على أساس سنوي من راتب الشهر نفسه. إذا تغيّر الأجر خلال السنة فقد يختلف الإجمالي المستقطع عن الربط السنوي النهائي، ولا يُجري النظام تسوية في ديسمبر.",
    appliesToEveryPayslip: true,
  },
  {
    code: "in_kind_benefits",
    labelAr: "المزايا العينية",
    detailAr: "السيارة والسكن والتأمين الطبي الخاص لا تُقيَّم ولا تُضاف إلى وعاء الضريبة؛ تُدرَج فقط إن سُجّلت كبدل نقدي على العقد.",
    appliesToEveryPayslip: false,
  },
  {
    code: "foreign_currency_contract",
    labelAr: "عقود بعملة أجنبية",
    detailAr: "يُحوَّل العقد إلى عملة الدورة بسعر الصرف المسجّل في تاريخ نهاية الفترة؛ فرق سعر الصرف بين الاحتساب والصرف لا يُرحَّل كبند مستقل.",
    appliesToEveryPayslip: false,
  },
] as const;

/** What a payslip line does to the net: adds to it, takes from it, or is an employer-side cost that never touches it. */
export type PayslipLineKind = "earning" | "deduction" | "employer_contribution";

/** Where a line came from — the audit trail for "why is my net this number?". */
export type PayslipLineSource =
  | "contract_basic"
  | "contract_allowance"
  | "overtime"
  | "contract_deduction"
  | "unpaid_leave"
  | "advance_recovery"
  | "garnishment"
  | "income_tax"
  | "social_insurance_employee"
  | "social_insurance_employer"
  | "statutory_levy";

export interface PayslipLineSourceDefinition {
  readonly code: PayslipLineSource;
  readonly labelAr: string;
}

/** Group headings a payslip prints under, so a line never appears without saying what kind of thing it is. */
export const PAYSLIP_LINE_SOURCE_DEFINITIONS: readonly PayslipLineSourceDefinition[] = [
  { code: "contract_basic", labelAr: "الراتب الأساسي" },
  { code: "contract_allowance", labelAr: "بدلات العقد" },
  { code: "overtime", labelAr: "الأجر الإضافي" },
  { code: "contract_deduction", labelAr: "استقطاعات العقد" },
  { code: "unpaid_leave", labelAr: "إجازة بدون أجر" },
  { code: "advance_recovery", labelAr: "سداد السلف" },
  { code: "garnishment", labelAr: "الحجز على الأجر" },
  { code: "income_tax", labelAr: "ضريبة كسب العمل" },
  { code: "social_insurance_employee", labelAr: "التأمينات — حصة الموظف" },
  { code: "social_insurance_employer", labelAr: "التأمينات — حصة صاحب العمل" },
  { code: "statutory_levy", labelAr: "رسوم قانونية" },
] as const;

export function getPayslipLineSourceLabel(source: PayslipLineSource): string {
  return PAYSLIP_LINE_SOURCE_DEFINITIONS.find((d) => d.code === source)?.labelAr ?? source;
}

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
  /** الأجر التأميني — the wage social insurance was actually computed on, after the year's floor and ceiling. */
  readonly insurableWage: Money;
  /** True when the year's ceiling bound the insurable wage, so the payslip can say so instead of showing a silently smaller contribution. */
  readonly insurableWageCapped: boolean;
  /** Annualised taxable income the salary-tax brackets were walked on. */
  readonly annualTaxableIncome: Money;
  /** What the whole cost of employing this person for the period was: net + every deduction + every employer contribution. */
  readonly totalEmployerCost: Money;
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
  /** Whether overtime hours were supplied for the period, recorded so a zero is never read as "no overtime worked". */
  readonly overtimeSource: "none" | "provider";
  /**
   * The dated statutory tables this run computed against — income tax, social
   * insurance, levies, overtime, end of service. Stored on the run so a payslip
   * reprinted in 2029 can still say which year's ceiling produced its figures.
   */
  readonly statutoryTableCodes: readonly string[];
  readonly totalEmployerCost: Money;
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

/** Overtime hours worked in a period, split by the statutory premium each hour attracts. */
export interface PeriodOvertimeHours {
  readonly day: number;
  readonly night: number;
  readonly restDay: number;
}

/**
 * The SEAM to attendance. Payroll needs hours, attendance stores clock times;
 * the implementation that derives one from the other lives in
 * `attendance-overtime.ts` so this module stays free of attendance's shape.
 */
export interface OvertimeHoursProvider {
  overtimeHoursFor(employeeId: string, periodStart: string, periodEnd: string): Promise<PeriodOvertimeHours>;
}

/** Days actually worked in the period — the pay basis for an hourly or daily contract. */
export interface WorkedTimeProvider {
  workedTimeFor(employeeId: string, periodStart: string, periodEnd: string): Promise<{ readonly days: number; readonly hours: number }>;
}

/** A court-ordered or agreed deduction that is not an employee advance (حجز على الأجر). */
export interface Garnishment {
  readonly id: string;
  readonly employeeId: string;
  readonly reference: string;
  readonly labelAr: string;
  readonly monthlyAmount: Money;
  readonly currency: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly outstanding: Money;
  readonly active: boolean;
}

export interface GarnishmentProvider {
  listActiveFor(employeeId: string, onDate: string): Promise<readonly Garnishment[]>;
}

/**
 * أساس قسمة اليوم — the divisor a monthly salary is broken into days by.
 * FIXED_30 is the Egyptian convention (every month is 30 days, so a day is
 * always salary/30); CALENDAR_DAYS uses the period's real length, so a day in
 * February is worth more than a day in March. Both are defensible and they
 * disagree, so the tenant chooses and the run records which it used.
 */
export type PayrollDayDivisorBasis = "FIXED_30" | "CALENDAR_DAYS";

export interface PayrollDayDivisorBasisDefinition {
  readonly code: PayrollDayDivisorBasis;
  readonly labelAr: string;
  readonly detailAr: string;
}

export const PAYROLL_DAY_DIVISOR_BASIS_DEFINITIONS: readonly PayrollDayDivisorBasisDefinition[] = [
  { code: "FIXED_30", labelAr: "ثابت — 30 يوماً", detailAr: "قيمة اليوم = الراتب الشهري ÷ 30 في كل الشهور." },
  { code: "CALENDAR_DAYS", labelAr: "أيام الشهر الفعلية", detailAr: "قيمة اليوم = الراتب الشهري ÷ عدد أيام الشهر (28 أو 29 أو 30 أو 31)." },
] as const;

export function getPayrollDayDivisorBasisLabel(basis: PayrollDayDivisorBasis): string {
  return PAYROLL_DAY_DIVISOR_BASIS_DEFINITIONS.find((d) => d.code === basis)?.labelAr ?? basis;
}

/** The divisor a period actually uses, given the tenant's basis. */
export function payrollDayDivisor(basis: PayrollDayDivisorBasis, periodDays: number): number {
  return basis === "FIXED_30" ? 30 : periodDays;
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
  /** Credited with salary tax withheld — owed to the Tax Authority, not to the employee. */
  readonly salaryTaxPayableAccountId: string;
  /** Credited with BOTH insurance shares — owed to the social-insurance authority. */
  readonly socialInsurancePayableAccountId: string;
  /** Credited with wage garnishments — owed to the court or the third party named on the order. */
  readonly garnishmentPayableAccountId: string;
  readonly endOfServiceExpenseAccountId: string;
  readonly endOfServiceProvisionAccountId: string;
}

/** System defaults, mapping onto the standard COA leaves 5120 / 2170 / 1160 / 2190 / 5130. */
export const PAYROLL_GL_ACCOUNTS: PayrollGlAccounts = {
  salaryExpenseAccountId: "5120",
  salariesPayableAccountId: "2170",
  employeeAdvanceAccountId: "1160",
  deductionLiabilityAccountId: "2190",
  employerContributionExpenseAccountId: "5130",
  employerContributionLiabilityAccountId: "2190",
  salaryTaxPayableAccountId: "2191",
  socialInsurancePayableAccountId: "2192",
  garnishmentPayableAccountId: "2193",
  endOfServiceExpenseAccountId: "5140",
  endOfServiceProvisionAccountId: "2181",
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
