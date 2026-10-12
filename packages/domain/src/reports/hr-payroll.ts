import { z } from "zod";
import { Money } from "../money/index.js";
import type { Payslip, PayrollRun, PayslipLineSource } from "../hr/payroll-run.js";
import type { EmployeeRef } from "../hr-shared/employee-ref.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { isLedgerEffective } from "./gl-shared.js";
import type { JournalEntry } from "../journal.js";

/** The `sourceDocType` a payroll run's journal entry carries (`post-payroll-run.ts`). */
export const PAYROLL_RUN_SOURCE_DOC_TYPE = "PAYROLL_RUN";

/**
 * The payroll reports (docs/archive/catalog/08-reports.md — the HR domain).
 * Three views of ONE fact set:
 *
 *   - سجل الرواتب, the register, is every payslip line rolled up per employee.
 *   - نموذج التأمينات is the same payslips read as an insurance return.
 *   - نموذج 4 is the same payslips read as a salary-tax return.
 *
 * The two returns count only runs computed with statutory rules ON, and each
 * RECONCILES against what those same runs' postings credited to the GL control
 * account its withholding goes to — 2192 for insurance, 2191 for tax.
 */

export interface PayrollReportContext {
  readonly runs: readonly PayrollRun[];
  readonly payslips: readonly Payslip[];
  readonly employees: readonly EmployeeRef[];
  /**
   * What each payroll run's own posting did to each payroll GL account — net
   * credit, keyed by account id then run id. A return compares its payslips
   * with the postings of the SAME runs, never with the account's balance: the
   * balance also carries every earlier month and every remittance.
   * Absent = the reconciliation banner is not rendered.
   */
  readonly payrollCreditsByAccountId?: ReadonlyMap<string, ReadonlyMap<string, Money>>;
}

export interface PayrollPeriodParams {
  readonly year: number;
  readonly month: number | null;
  readonly branchId: string | null;
}

const paramsSchema = z.object({
  year: z.coerce.number().int().min(1900),
  month: z.coerce.number().int().min(1).max(12).nullable(),
  branchId: z.string().nullable(),
});

function toNumber(amount: Money): number {
  return Number(amount.toString());
}

/** The payslips inside the parameter window, with their run. */
function selectPayslips(params: PayrollPeriodParams, ctx: PayrollReportContext): { run: PayrollRun; payslip: Payslip }[] {
  const runsById = new Map(ctx.runs.map((r) => [r.id, r]));
  const selected: { run: PayrollRun; payslip: Payslip }[] = [];
  for (const payslip of ctx.payslips) {
    const run = runsById.get(payslip.runId);
    if (!run) continue;
    // A cancelled run's payslips are deleted, but a draft run's are not posted
    // yet — a statutory return must only ever count what was approved.
    if (run.status !== "approved" && run.status !== "disbursed") continue;
    if (run.year !== params.year) continue;
    if (params.month !== null && run.month !== params.month) continue;
    if (params.branchId !== null && run.branchId !== params.branchId) continue;
    selected.push({ run, payslip });
  }
  return selected;
}

/** As {@link selectPayslips}, restricted to runs computed with statutory rules ON — a return must not count a run that withheld nothing because the switch was off. */
function selectStatutoryPayslips(params: PayrollPeriodParams, ctx: PayrollReportContext): { run: PayrollRun; payslip: Payslip }[] {
  return selectPayslips(params, ctx).filter(({ run }) => run.statutoryTableCodes.length > 0);
}

function employeeLabel(employees: readonly EmployeeRef[], employeeId: string): { nameAr: string; code: string } {
  const employee = employees.find((e) => e.id === employeeId);
  return { nameAr: employee?.fullNameAr ?? employeeId, code: employee?.code ?? "" };
}

/**
 * The return's own total and what the same runs' postings credited to its
 * control account, both exact. Only the runs the return counts are summed.
 */
function exactReturnTotals(
  params: PayrollPeriodParams,
  ctx: PayrollReportContext,
  sources: readonly PayslipLineSource[],
  accountId: string,
): { report: Money; reference: Money } {
  const selected = selectStatutoryPayslips(params, ctx);
  const runIds = new Set(selected.map(({ run }) => run.id));
  const credits = ctx.payrollCreditsByAccountId?.get(accountId);
  return {
    report: Money.sum(selected.map(({ payslip }) => totalOf(payslip, sources))),
    reference: Money.sum([...runIds].map((id) => credits?.get(id) ?? Money.zero())),
  };
}

/**
 * Net credit each payroll run's own posting — and any reversal of it — put on
 * `accountId`, keyed by run id. A remittance out of the account is a different
 * document and is never counted (D189).
 */
export function payrollCreditsByRunId(entries: readonly JournalEntry[], accountId: string): Map<string, Money> {
  const byRun = new Map<string, bigint>();
  for (const entry of entries) {
    if (entry.sourceDocType !== PAYROLL_RUN_SOURCE_DOC_TYPE || !entry.sourceDocId || !isLedgerEffective(entry)) continue;
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      byRun.set(entry.sourceDocId, (byRun.get(entry.sourceDocId) ?? 0n) + line.credit.scaled - line.debit.scaled);
    }
  }
  return new Map([...byRun].map(([runId, scaled]) => [runId, Money.fromScaled(scaled)]));
}

/** Total of the payslip lines whose source is in `sources`. */
function totalOf(payslip: Payslip, sources: readonly PayslipLineSource[]): Money {
  return Money.sum(payslip.lines.filter((l) => sources.includes(l.source)).map((l) => l.amount));
}

const CURRENT_YEAR = () => new Date().getUTCFullYear();

function periodParamFields(): ReportDefinition<PayrollPeriodParams, never>["paramFields"] {
  return [
    { kind: "text", key: "year", label: "السنة" },
    { kind: "text", key: "month", label: "الشهر (1-12، أو فارغ للسنة كلها)" },
  ];
}

// --- 1. سجل الرواتب ---------------------------------------------------------

export interface PayrollRegisterRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeNameAr: string;
  readonly periodLabel: string;
  readonly paidDays: number;
  readonly basic: number;
  readonly allowances: number;
  readonly overtime: number;
  readonly gross: number;
  readonly unpaidLeave: number;
  readonly insuranceEmployee: number;
  readonly incomeTax: number;
  readonly garnishments: number;
  readonly advanceRecovery: number;
  readonly otherDeductions: number;
  readonly totalDeductions: number;
  readonly terminationAdjustment: number;
  readonly netPay: number;
  readonly employerContributions: number;
  readonly insuranceEmployer: number;
  /** Null on a payslip calculated before this field existed (D191) — the column then renders "not computed", never a fabricated 0. */
  readonly employerCost: number | null;
}

const EMPLOYER_COST_NOT_COMPUTED_AR = "غير محسوب";

/**
 * سجل الرواتب — one row per employee per period, with every component the net
 * was built from. This is the document an auditor asks for first, and the
 * source every other payroll report is derived from.
 */
export function createPayrollRegisterReport(): ReportDefinition<PayrollPeriodParams, PayrollRegisterRow, PayrollReportContext> {
  return {
    id: "hr.payroll-register",
    titleAr: "سجل الرواتب",
    descriptionAr: "كل مفردات الراتب لكل موظف في الفترة: الأساسي والبدلات والإضافي، ثم الإجازات بدون أجر والتأمينات والضريبة والحجوزات وأقساط السلف وباقي الاستقطاعات، وصولاً للصافي وتكلفة صاحب العمل. أعمدة الضريبة والتأمينات صفر لكل مسير احتُسب والاحتساب القانوني غير مفعّل.",
    paramsSchema,
    defaultParams: { year: CURRENT_YEAR(), month: null, branchId: null },
    paramFields: periodParamFields(),
    run: (params, ctx) =>
      selectPayslips(params, ctx).map(({ run, payslip }) => {
        const { nameAr, code } = employeeLabel(ctx.employees, payslip.employeeId);
        const unpaidLeave = totalOf(payslip, ["unpaid_leave"]);
        const garnishments = totalOf(payslip, ["garnishment"]);
        const advanceRecovery = totalOf(payslip, ["advance_recovery"]);
        const insuranceEmployee = totalOf(payslip, ["social_insurance_employee"]);
        const incomeTax = totalOf(payslip, ["income_tax"]);
        const other = Money.fromScaled(
          payslip.totalDeductions.scaled - unpaidLeave.scaled - garnishments.scaled - advanceRecovery.scaled - insuranceEmployee.scaled - incomeTax.scaled,
        );
        return {
          employeeId: payslip.employeeId,
          employeeCode: code,
          employeeNameAr: nameAr,
          periodLabel: `${run.year}-${String(run.month).padStart(2, "0")}`,
          paidDays: payslip.paidDays,
          basic: toNumber(totalOf(payslip, ["contract_basic"])),
          allowances: toNumber(totalOf(payslip, ["contract_allowance"])),
          overtime: toNumber(totalOf(payslip, ["overtime"])),
          gross: toNumber(payslip.grossEarnings),
          unpaidLeave: toNumber(unpaidLeave),
          insuranceEmployee: toNumber(insuranceEmployee),
          incomeTax: toNumber(incomeTax),
          garnishments: toNumber(garnishments),
          advanceRecovery: toNumber(advanceRecovery),
          otherDeductions: toNumber(other),
          totalDeductions: toNumber(payslip.totalDeductions),
          terminationAdjustment: toNumber(Money.sum(payslip.lines.filter((l) => l.kind === "termination_adjustment").map((l) => l.amount))),
          netPay: toNumber(payslip.netPay),
          employerContributions: toNumber(payslip.employerContributions),
          insuranceEmployer: toNumber(totalOf(payslip, ["social_insurance_employer"])),
          employerCost: payslip.totalEmployerCost === null ? null : toNumber(payslip.totalEmployerCost),
        };
      }),
    rowKey: (row) => `${row.employeeId}:${row.periodLabel}`,
    group: { key: (row) => row.periodLabel, label: (row) => `فترة ${row.periodLabel}` },
    columns: [
      { key: "employeeCode", header: "الكود", value: (r) => r.employeeCode },
      { key: "employeeNameAr", header: "الموظف", value: (r) => r.employeeNameAr },
      { key: "paidDays", header: "أيام مستحقة", format: "qty", align: "end", value: (r) => r.paidDays },
      { key: "basic", header: "الأساسي", format: "money", align: "end", value: (r) => r.basic, total: true },
      { key: "allowances", header: "البدلات", format: "money", align: "end", value: (r) => r.allowances, total: true },
      { key: "overtime", header: "الإضافي", format: "money", align: "end", value: (r) => r.overtime, total: true },
      { key: "gross", header: "الإجمالي", format: "money", align: "end", value: (r) => r.gross, total: true },
      { key: "unpaidLeave", header: "إجازة بدون أجر", format: "money", align: "end", value: (r) => r.unpaidLeave, total: true },
      { key: "insuranceEmployee", header: "تأمينات الموظف", format: "money", align: "end", value: (r) => r.insuranceEmployee, total: true },
      { key: "incomeTax", header: "ضريبة كسب العمل", format: "money", align: "end", value: (r) => r.incomeTax, total: true },
      { key: "garnishments", header: "الحجوزات", format: "money", align: "end", value: (r) => r.garnishments, total: true },
      { key: "advanceRecovery", header: "أقساط السلف", format: "money", align: "end", value: (r) => r.advanceRecovery, total: true },
      { key: "otherDeductions", header: "استقطاعات أخرى", format: "money", align: "end", value: (r) => r.otherDeductions, total: true },
      { key: "terminationAdjustment", header: "تسوية إنهاء الخدمة", format: "money", align: "end", value: (r) => r.terminationAdjustment, total: true },
      { key: "netPay", header: "الصافي", format: "money", align: "end", value: (r) => r.netPay, total: true },
      { key: "employerContributions", header: "مساهمات صاحب العمل", format: "money", align: "end", value: (r) => r.employerContributions, total: true },
      { key: "insuranceEmployer", header: "منها تأمينات صاحب العمل", format: "money", align: "end", value: (r) => r.insuranceEmployer, total: true },
      {
        key: "employerCost",
        header: "تكلفة صاحب العمل",
        format: "money",
        align: "end",
        // D191: a null cost (a run calculated before this field existed) prints
        // the "غير محسوب" label rather than falling through to a bare 0 — the
        // KPI below still reads the raw `employerCost` field and skips it.
        value: (r) => (r.employerCost === null ? EMPLOYER_COST_NOT_COMPUTED_AR : r.employerCost),
        total: true,
      },
    ],
    kpis: [
      { key: "headcount", labelAr: "عدد كشوف الرواتب", value: (rows) => rows.length },
      { key: "net", labelAr: "إجمالي الصافي المستحق", format: "money", value: (rows) => sumRows(rows, (r) => r.netPay) },
      {
        key: "employerCost",
        labelAr: "التكلفة الكلية على المنشأة",
        hintAr: "الإجمالي زائد مساهمات صاحب العمل — ما يخرج فعلاً من المنشأة، لا ما يقبضه الموظف.",
        format: "money",
        value: (rows) => sumRows(rows, (r) => r.employerCost),
      },
      {
        key: "deductionShare",
        labelAr: "نسبة الاستقطاع من الإجمالي",
        format: "percent",
        value: (rows) => {
          const gross = sumRows(rows, (r) => r.gross);
          return gross === 0 ? 0 : Math.round((sumRows(rows, (r) => r.totalDeductions) / gross) * 10_000) / 100;
        },
      },
    ],
    chart: { labelColumn: "employeeNameAr", valueColumn: "netPay", maxPoints: 12, aggregate: true, captionAr: "أعلى صافي رواتب" },
  };
}

// --- 2. نموذج التأمينات الاجتماعية ------------------------------------------

export interface SocialInsuranceReturnRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeNameAr: string;
  readonly periodLabel: string;
  readonly grossWage: number;
  readonly insurableWage: number;
  readonly cappedByCeiling: boolean;
  readonly employeeShare: number;
  readonly employerShare: number;
  readonly totalContribution: number;
}

/** GL leaf the insurance withholding credits; the return reconciles against it. */
export const SOCIAL_INSURANCE_CONTROL_ACCOUNT = "2192";

/**
 * نموذج التأمينات الاجتماعية — the insurable wage and both contribution shares
 * per employee, which is the basis the monthly insurance form is filed on.
 *
 * `insurableWage` is deliberately shown BESIDE gross: they differ whenever the
 * ceiling bites, and an employer who reads gross as the contribution base
 * over-declares every senior salary.
 */
export function createSocialInsuranceReturnReport(): ReportDefinition<PayrollPeriodParams, SocialInsuranceReturnRow, PayrollReportContext> {
  return {
    id: "hr.social-insurance-return",
    titleAr: "أساس نموذج التأمينات الاجتماعية",
    descriptionAr: "الأجر التأميني لكل موظف بعد تطبيق الحد الأدنى والأقصى، وحصتا الموظف وصاحب العمل — الأساس الذي يُملأ منه النموذج الشهري.",
    paramsSchema,
    defaultParams: { year: CURRENT_YEAR(), month: null, branchId: null },
    paramFields: periodParamFields(),
    run: (params, ctx) =>
      selectStatutoryPayslips(params, ctx).map(({ run, payslip }) => {
        const { nameAr, code } = employeeLabel(ctx.employees, payslip.employeeId);
        const employeeShare = totalOf(payslip, ["social_insurance_employee"]);
        const employerShare = totalOf(payslip, ["social_insurance_employer"]);
        return {
          employeeId: payslip.employeeId,
          employeeCode: code,
          employeeNameAr: nameAr,
          periodLabel: `${run.year}-${String(run.month).padStart(2, "0")}`,
          grossWage: toNumber(payslip.grossEarnings),
          insurableWage: toNumber(payslip.insurableWage),
          cappedByCeiling: payslip.insurableWageCapped,
          employeeShare: toNumber(employeeShare),
          employerShare: toNumber(employerShare),
          totalContribution: toNumber(Money.fromScaled(employeeShare.scaled + employerShare.scaled)),
        };
      }),
    rowKey: (row) => `${row.employeeId}:${row.periodLabel}`,
    group: { key: (row) => row.periodLabel, label: (row) => `فترة ${row.periodLabel}` },
    columns: [
      { key: "employeeCode", header: "الكود", value: (r) => r.employeeCode },
      { key: "employeeNameAr", header: "الموظف", value: (r) => r.employeeNameAr },
      { key: "grossWage", header: "إجمالي الأجر", format: "money", align: "end", value: (r) => r.grossWage, total: true },
      { key: "insurableWage", header: "الأجر التأميني", format: "money", align: "end", value: (r) => r.insurableWage, total: true },
      { key: "cappedByCeiling", header: "بلغ الحد الأقصى", value: (r) => (r.cappedByCeiling ? "نعم" : "لا") },
      { key: "employeeShare", header: "حصة الموظف", format: "money", align: "end", value: (r) => r.employeeShare, total: true },
      { key: "employerShare", header: "حصة صاحب العمل", format: "money", align: "end", value: (r) => r.employerShare, total: true },
      { key: "totalContribution", header: "إجمالي الاشتراك", format: "money", align: "end", value: (r) => r.totalContribution, total: true },
    ],
    kpis: [
      { key: "insured", labelAr: "عدد المؤمَّن عليهم", value: (rows) => new Set(rows.map((r) => r.employeeId)).size },
      { key: "total", labelAr: "إجمالي الاشتراك المستحق", format: "money", value: (rows) => sumRows(rows, (r) => r.totalContribution) },
      {
        key: "cappedCount",
        labelAr: "أجور بلغت الحد الأقصى",
        hintAr: "ما زاد عن الحد الأقصى لا يخضع للاشتراك — راجع هذه الأجور قبل التقديم.",
        value: (rows) => rows.filter((r) => r.cappedByCeiling).length,
      },
    ],
    reconciliation: {
      labelAr: "إجمالي الاشتراك مقابل ما قيّدته رواتب الفترة نفسها في حساب التأمينات المستحقة (2192)",
      available: (ctx) => ctx.payrollCreditsByAccountId !== undefined,
      computeReportTotal: (rows) => sumRows(rows, (r) => r.totalContribution),
      computeReferenceTotal: (_rows, ctx, params) =>
        toNumber(exactReturnTotals(params, ctx, ["social_insurance_employee", "social_insurance_employer"], SOCIAL_INSURANCE_CONTROL_ACCOUNT).reference),
      computeExactTotals: (_rows, ctx, params) =>
        exactReturnTotals(params, ctx, ["social_insurance_employee", "social_insurance_employer"], SOCIAL_INSURANCE_CONTROL_ACCOUNT),
    },
  };
}

// --- 3. نموذج 4 — ضريبة كسب العمل -------------------------------------------

export interface SalaryTaxReturnRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeNameAr: string;
  readonly periodLabel: string;
  readonly gross: number;
  readonly insuranceDeduction: number;
  readonly annualTaxableIncome: number;
  readonly taxWithheld: number;
  readonly effectiveRate: number;
}

/** GL leaf the salary-tax withholding credits; the return reconciles against it. */
export const SALARY_TAX_CONTROL_ACCOUNT = "2191";

/**
 * أساس نموذج 4 — the salary-tax withholding per employee.
 *
 * `annualTaxableIncome` is shown because the brackets are annual: a reader
 * checking one month's tax against the bracket table without it will conclude
 * the figure is wrong every time.
 */
export function createSalaryTaxReturnReport(): ReportDefinition<PayrollPeriodParams, SalaryTaxReturnRow, PayrollReportContext> {
  return {
    id: "hr.salary-tax-return",
    titleAr: "أساس نموذج 4 — ضريبة كسب العمل",
    descriptionAr: "الضريبة المستقطعة من كل موظف، ومعها الوعاء السنوي الذي حُسبت عليه الشرائح — الأساس الذي يُملأ منه إقرار كسب العمل.",
    paramsSchema,
    defaultParams: { year: CURRENT_YEAR(), month: null, branchId: null },
    paramFields: periodParamFields(),
    run: (params, ctx) =>
      selectStatutoryPayslips(params, ctx).map(({ run, payslip }) => {
        const { nameAr, code } = employeeLabel(ctx.employees, payslip.employeeId);
        const tax = totalOf(payslip, ["income_tax"]);
        const gross = toNumber(payslip.grossEarnings);
        return {
          employeeId: payslip.employeeId,
          employeeCode: code,
          employeeNameAr: nameAr,
          periodLabel: `${run.year}-${String(run.month).padStart(2, "0")}`,
          gross,
          insuranceDeduction: toNumber(totalOf(payslip, ["social_insurance_employee"])),
          annualTaxableIncome: toNumber(payslip.annualTaxableIncome),
          taxWithheld: toNumber(tax),
          effectiveRate: gross === 0 ? 0 : Math.round((toNumber(tax) / gross) * 10_000) / 100,
        };
      }),
    rowKey: (row) => `${row.employeeId}:${row.periodLabel}`,
    group: { key: (row) => row.periodLabel, label: (row) => `فترة ${row.periodLabel}` },
    columns: [
      { key: "employeeCode", header: "الكود", value: (r) => r.employeeCode },
      { key: "employeeNameAr", header: "الموظف", value: (r) => r.employeeNameAr },
      { key: "gross", header: "إجمالي الأجر", format: "money", align: "end", value: (r) => r.gross, total: true },
      { key: "insuranceDeduction", header: "التأمينات (خصم قبل الضريبة)", format: "money", align: "end", value: (r) => r.insuranceDeduction, total: true },
      { key: "annualTaxableIncome", header: "الوعاء السنوي", format: "money", align: "end", value: (r) => r.annualTaxableIncome },
      { key: "taxWithheld", header: "الضريبة المستقطعة", format: "money", align: "end", value: (r) => r.taxWithheld, total: true },
      { key: "effectiveRate", header: "السعر الفعلي", format: "percent", align: "end", value: (r) => r.effectiveRate },
    ],
    kpis: [
      { key: "taxpayers", labelAr: "عدد الخاضعين", value: (rows) => new Set(rows.filter((r) => r.taxWithheld > 0).map((r) => r.employeeId)).size },
      { key: "tax", labelAr: "إجمالي الضريبة المستقطعة", format: "money", value: (rows) => sumRows(rows, (r) => r.taxWithheld) },
      {
        key: "exempt",
        labelAr: "موظفون لم تُستقطع منهم ضريبة",
        hintAr: "الإعفاء الشخصي وشريحة الصفر يجعلان الأجور الصغيرة غير خاضعة — هذا متوقع، لا خطأ.",
        value: (rows) => rows.filter((r) => r.taxWithheld === 0).length,
      },
    ],
    reconciliation: {
      labelAr: "إجمالي الضريبة مقابل ما قيّدته رواتب الفترة نفسها في حساب ضريبة كسب العمل المستحقة (2191)",
      available: (ctx) => ctx.payrollCreditsByAccountId !== undefined,
      computeReportTotal: (rows) => sumRows(rows, (r) => r.taxWithheld),
      computeReferenceTotal: (_rows, ctx, params) => toNumber(exactReturnTotals(params, ctx, ["income_tax"], SALARY_TAX_CONTROL_ACCOUNT).reference),
      computeExactTotals: (_rows, ctx, params) => exactReturnTotals(params, ctx, ["income_tax"], SALARY_TAX_CONTROL_ACCOUNT),
    },
  };
}
