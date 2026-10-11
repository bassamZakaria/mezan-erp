import type { Money } from "../money/index.js";
import type { OvertimeTable } from "./egypt-statutory.js";
import type { PayBasis } from "./contract.js";

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

/** A run in one of these can no longer be recalculated: what it paid stands. */
export const PAYROLL_RUN_FINAL_STATUSES: ReadonlySet<PayrollRunStatus> = new Set<PayrollRunStatus>(["approved", "disbursed"]);

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
    code: "income_tax",
    labelAr: "ضريبة كسب العمل",
    detailAr: "لا تُحتسب الشرائح ولا الإعفاءات ولا التسوية السنوية، ولا يظهر أي بند ضريبي في كشف الراتب.",
    appliesToEveryPayslip: true,
  },
  {
    code: "social_insurance",
    labelAr: "التأمينات الاجتماعية",
    detailAr: "لا تُحتسب حصة الموظف ولا حصة صاحب العمل؛ بند «مساهمة صاحب العمل» يبقى فارغاً دائماً.",
    appliesToEveryPayslip: true,
  },
  {
    code: "seniority_bonus",
    labelAr: "علاوة الأقدمية (المادة 47)",
    detailAr: "سنوات الخدمة السابقة مسجّلة على الموظف، لكن لم تُحدَّد نسبة العلاوة فلا يصدر لها بند.",
    appliesToEveryPayslip: true,
  },
  {
    code: "overtime",
    labelAr: "أجر العمل الإضافي",
    detailAr: "ساعات الحضور لا تنتقل إلى الرواتب، ولم يُحدَّد معامل احتساب الساعة الإضافية.",
    appliesToEveryPayslip: true,
  },
  {
    code: "end_of_service",
    labelAr: "مكافأة نهاية الخدمة",
    detailAr: "لا تُحتسب مستحقات نهاية الخدمة عند انتهاء العقد.",
    appliesToEveryPayslip: true,
  },
  {
    code: "pay_frequency",
    labelAr: "الدفع الأسبوعي أو نصف الشهري",
    detailAr: "يُحتسب راتب شهر كامل للفترة أياً كان تكرار الدفع المسجّل على العقد.",
    appliesToEveryPayslip: false,
  },
] as const;

/**
 * The gaps left when the tenant has switched statutory computation ON
 * (`hr.payroll.statutory`). A run computed with it off keeps the list above:
 * which list a payslip shows is decided by the run, not by today's switch.
 */
export const PAYROLL_UNIMPLEMENTED_RULES_STATUTORY: readonly PayrollUnimplementedRule[] = [
  {
    code: "annual_tax_settlement",
    labelAr: "التسوية الضريبية السنوية",
    detailAr:
      "تُحتسب الضريبة شهرياً على أساس سنوي من راتب الشهر نفسه. إذا تغيّر الأجر خلال السنة فقد يختلف الإجمالي المستقطع عن الربط السنوي النهائي، ولا يُجري النظام تسوية في ديسمبر.",
    appliesToEveryPayslip: true,
  },
  {
    code: "seniority_bonus",
    labelAr: "العلاوة الدورية",
    detailAr: "لا يصدر بند للعلاوة الدورية أو علاوة الأقدمية؛ تُعدَّل على العقد نفسه.",
    appliesToEveryPayslip: true,
  },
  {
    code: "in_kind_benefits",
    labelAr: "المزايا العينية",
    detailAr: "السيارة والسكن والتأمين الطبي الخاص لا تُقيَّم ولا تُضاف إلى وعاء الضريبة؛ تُدرَج فقط إن سُجّلت كبدل نقدي على العقد.",
    appliesToEveryPayslip: false,
  },
  {
    code: "pay_frequency",
    labelAr: "الدفع الأسبوعي أو نصف الشهري",
    detailAr: "يُحتسب راتب شهر كامل للفترة أياً كان تكرار الدفع المسجّل على العقد.",
    appliesToEveryPayslip: false,
  },
] as const;

/** The gaps behind a run's nets: the statutory list only when the run was computed with statutory rules. */
export function payrollUnimplementedRulesFor(run: Pick<PayrollRun, "statutoryTableCodes">): readonly PayrollUnimplementedRule[] {
  return run.statutoryTableCodes.length > 0 ? PAYROLL_UNIMPLEMENTED_RULES_STATUTORY : PAYROLL_UNIMPLEMENTED_RULES;
}

/** What a payslip line does to the net: adds to it, takes from it, or is an employer-side cost that never touches it. */
export type PayslipLineKind = "earning" | "deduction" | "employer_contribution";

/** Where a line came from — the audit trail for "why is my net this number?". */
export type PayslipLineSource =
  | "contract_basic"
  | "contract_allowance"
  | "contract_deduction"
  | "unpaid_leave"
  | "advance_recovery"
  | "garnishment"
  | "overtime"
  | "income_tax"
  | "social_insurance_employee"
  | "social_insurance_employer"
  | "statutory_levy";

export interface PayslipLineSourceDefinition {
  readonly code: PayslipLineSource;
  readonly labelAr: string;
}

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

/** Sources whose amount came from a dated statutory table; their `referenceId` names the table row. */
export const STATUTORY_PAYSLIP_LINE_SOURCES: readonly PayslipLineSource[] = [
  "overtime",
  "income_tax",
  "social_insurance_employee",
  "social_insurance_employer",
  "statutory_levy",
];

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
  /**
   * True when a `garnishment` line was reduced by the statutory
   * wage-attachment cap (Art. 44), or an `advance_recovery` line by the 10%
   * employer-loan recovery cap (Art. 43, D183), rather than paid at the
   * order's/advance's full instalment.
   */
  readonly capped: boolean;
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
  /** الأجر التأميني — the wage social insurance was computed on, after the year's floor and ceiling; zero when statutory computation was off. */
  readonly insurableWage: Money;
  /** True when the year's ceiling bound the insurable wage. */
  readonly insurableWageCapped: boolean;
  /** Annualised taxable income the salary-tax brackets were walked on; zero when statutory computation was off. */
  readonly annualTaxableIncome: Money;
  /**
   * Net + every deduction + every employer contribution: what employing this
   * person cost for the period. NULL on a payslip calculated before this
   * field existed (D191) — never 0, which would be a fabricated cost the
   * reports could not tell apart from a genuinely zero-cost period.
   */
  readonly totalEmployerCost: Money | null;
  /** How the basic pay was reached and in which currency the contract is; null on a payslip calculated before this field existed. */
  readonly basis?: PayslipBasis | null;
  readonly createdAt: string;
}

/**
 * The contract's pay basis and currency as the payslip applied them. Every
 * money figure on the payslip itself is in the RUN's currency (what posts);
 * the figures here in `contractCurrency` are for the reader only.
 */
export interface PayslipBasis {
  readonly payBasis: PayBasis;
  /** Hours (hourly) or days (daily) the basic line paid for, paid leave and holidays included; null on a monthly contract. */
  readonly quantity: number | null;
  /** The contract's own rate, in `contractCurrency`: the month's salary, the hour's or the day's. */
  readonly rate: Money;
  readonly contractCurrency: string;
  /** Run-currency units per one contract-currency unit; null when the two currencies are the same. */
  readonly fxRate: string | null;
  /** Effective date of the approved rate used, on or before the period end. */
  readonly fxRateDate: string | null;
  readonly grossInContractCurrency: Money | null;
  readonly netInContractCurrency: Money | null;
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
  /** Whether overtime hours were supplied for the period, so a zero is never read as "no overtime worked". */
  readonly overtimeSource: "none" | "provider";
  /**
   * The dated statutory tables this run computed against. EMPTY when the
   * tenant's statutory switch was off for the calculation, which is how every
   * screen knows to keep saying that tax and insurance were not computed.
   */
  readonly statutoryTableCodes: readonly string[];
  /** As {@link Payslip.totalEmployerCost}: NULL on a run calculated before this field existed (D191), never a fabricated 0. */
  readonly totalEmployerCost: Money | null;
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
 * The garnishment's own kind. نفقة (alimony/family-maintenance) orders rank
 * ahead of every other kind and are allowed a higher statutory ceiling — see
 * `calculatePayrollRun`. Optional and defaults to "other" so a caller that
 * predates this distinction (or a repository that has not populated it) still
 * type-checks; the canonical, exhaustive definition lives on
 * `GarnishmentRecord` in garnishment.ts.
 */
export type GarnishmentKind = "court_order" | "alimony" | "debt_settlement" | "union_dues" | "other";

/** A court-ordered or agreed deduction that is not an employee advance (حجز على الأجر). */
export interface Garnishment {
  readonly id: string;
  readonly employeeId: string;
  /** Absent/undefined is treated as "other" — only "alimony" (نفقة) changes ranking and cap. */
  readonly kind?: GarnishmentKind;
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
 * disagree, so the tenant chooses.
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
 * Unpaid-leave days per employee within a payroll period.
 *
 * This is the SEAM to the attendance/leave-balance side of HR (leave policies,
 * balances, accrual batches), which is built separately: payroll only needs a
 * day count. Until an implementation is bound, `PayrollCalculationDeps.unpaidLeave`
 * is undefined and every run records `unpaidLeaveSource: "none"`.
 */
/** Overtime worked under ONE dated overtime table: hours at the day/night premiums, and whole rest days and holidays worked. */
export interface OvertimeWorkedUnderTable {
  readonly table: OvertimeTable;
  readonly day: number;
  readonly night: number;
  readonly restDays: number;
  readonly holidays: number;
}

/** A worked rest day, or a holiday taken as a day off, with no راحة بديلة recorded against it. */
export interface OutstandingReplacementDay {
  readonly workedOn: string;
  readonly kind: "rest_day" | "holiday";
  /** The last day the law allows for the replacement; null where it sets no deadline. */
  readonly dueBy: string | null;
}

/**
 * A period's overtime, grouped by the table in force on each day it was
 * worked, so a period that straddles a change in the law prices each day by
 * the law of its own date.
 */
export interface PeriodOvertimeHours {
  readonly byTable: readonly OvertimeWorkedUnderTable[];
  /** The employee's own standard day (employee → department → company), the divisor of the hourly rate. */
  readonly standardDailyHours: number;
  readonly overtimeEligible: boolean;
  /** Approved hours beyond the standard day that were NOT paid because the employee is not eligible for overtime. */
  readonly ineligibleHours: number;
  readonly holidaysTakenAsDayOff: number;
  /** Holidays whose worker asked for a day off where the day's law does not allow it; paid the premium instead. */
  readonly substituteDayRefusedOn: readonly string[];
  readonly outstandingReplacementDays: readonly OutstandingReplacementDay[];
}

/** The seam to attendance: payroll needs hours, attendance stores clock times. */
export interface OvertimeHoursProvider {
  overtimeHoursFor(employeeId: string, periodStart: string, periodEnd: string): Promise<PeriodOvertimeHours>;
}

/**
 * What an hourly or daily contract is paid for in a period, read from
 * attendance and approved leave. Times are whole minutes and days are counted
 * in HALF days, so nothing here is a float that money is multiplied by.
 */
export interface PeriodWorkedTime {
  /** Ordinary time: on a working day the clocked time up to the standard day; on a rest day or holiday the APPROVED time up to it. */
  readonly workedMinutes: number;
  /** Days worked, in half days: a full day counts 2, a half day 1. */
  readonly workedHalfDays: number;
  /** Approved leave of a paid type falling on scheduled working days not worked, in half days. */
  readonly paidLeaveHalfDays: number;
  /** Official holidays on scheduled working days that were not worked. */
  readonly paidHolidays: number;
  readonly standardDailyHours: number;
  /** Working days marked worked with no clock times: a daily wage pays them, an hourly one has no hours to pay. */
  readonly unclockedDays: readonly string[];
  /** Rest days or holidays with time on the clock and no approval — not paid. */
  readonly unapprovedOffDays: readonly string[];
}

export interface WorkedTimeProvider {
  workedTimeFor(employeeId: string, from: string, to: string): Promise<PeriodWorkedTime>;
}

/** The approved rate for `currency` effective on or before `asOfDate`. */
export interface PayrollExchangeRates {
  findRate(currency: string, asOfDate: string): Promise<{ readonly rate: string; readonly effectiveDate: string } | null>;
}

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
  /** Credited with wage garnishments — owed to the court or the third party named on the order. */
  readonly garnishmentPayableAccountId: string;
  /** Credited with salary tax withheld — owed to the Tax Authority, not to the employee. */
  readonly salaryTaxPayableAccountId: string;
  /** Credited with BOTH insurance shares — owed to the social-insurance authority. */
  readonly socialInsurancePayableAccountId: string;
}

/** System defaults, mapping onto the standard COA leaves 5120 / 2170 / 1160 / 2190 / 5130. */
export const PAYROLL_GL_ACCOUNTS: PayrollGlAccounts = {
  salaryExpenseAccountId: "5120",
  salariesPayableAccountId: "2170",
  employeeAdvanceAccountId: "1160",
  deductionLiabilityAccountId: "2190",
  employerContributionExpenseAccountId: "5130",
  employerContributionLiabilityAccountId: "2190",
  garnishmentPayableAccountId: "2193",
  salaryTaxPayableAccountId: "2191",
  socialInsurancePayableAccountId: "2192",
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
