import { z } from "zod";
import { Money } from "../money/index.js";
import type { Payslip, PayrollRun, PayslipLineSource } from "../hr/payroll-run.js";
import type { EmployeeRef } from "../hr-shared/employee-ref.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * سجل الرواتب (docs/archive/catalog/08-reports.md — the HR domain, which
 * shipped with none of the 33): every payslip line rolled up per employee.
 */

export interface PayrollReportContext {
  readonly runs: readonly PayrollRun[];
  readonly payslips: readonly Payslip[];
  readonly employees: readonly EmployeeRef[];
  /**
   * Closing balance of each payroll GL control account over the same period,
   * keyed by account id. Absent = the reconciliation banner is not rendered
   * rather than rendered against a zero it would always fail.
   */
  readonly glBalancesByAccountId?: ReadonlyMap<string, Money>;
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

function employeeLabel(employees: readonly EmployeeRef[], employeeId: string): { nameAr: string; code: string } {
  const employee = employees.find((e) => e.id === employeeId);
  return { nameAr: employee?.fullNameAr ?? employeeId, code: employee?.code ?? "" };
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
  readonly gross: number;
  readonly unpaidLeave: number;
  readonly garnishments: number;
  readonly advanceRecovery: number;
  readonly otherDeductions: number;
  readonly totalDeductions: number;
  readonly netPay: number;
  readonly employerContributions: number;
  readonly employerCost: number;
}

/**
 * سجل الرواتب — one row per employee per period, with every component the net
 * was built from. This is the document an auditor asks for first, and the
 * source every other payroll report is derived from.
 */
export function createPayrollRegisterReport(): ReportDefinition<PayrollPeriodParams, PayrollRegisterRow, PayrollReportContext> {
  return {
    id: "hr.payroll-register",
    titleAr: "سجل الرواتب",
    descriptionAr: "كل مفردات الراتب لكل موظف في الفترة: الأساسي والبدلات، ثم الإجازات بدون أجر والحجوزات وأقساط السلف وباقي الاستقطاعات، وصولاً للصافي وتكلفة صاحب العمل. لا يشمل ضريبة كسب العمل ولا التأمينات الاجتماعية لأنها لا تُحتسب.",
    paramsSchema,
    defaultParams: { year: CURRENT_YEAR(), month: null, branchId: null },
    paramFields: periodParamFields(),
    run: (params, ctx) =>
      selectPayslips(params, ctx).map(({ run, payslip }) => {
        const { nameAr, code } = employeeLabel(ctx.employees, payslip.employeeId);
        const unpaidLeave = totalOf(payslip, ["unpaid_leave"]);
        const garnishments = totalOf(payslip, ["garnishment"]);
        const advanceRecovery = totalOf(payslip, ["advance_recovery"]);
        const other = Money.fromScaled(payslip.totalDeductions.scaled - unpaidLeave.scaled - garnishments.scaled - advanceRecovery.scaled);
        return {
          employeeId: payslip.employeeId,
          employeeCode: code,
          employeeNameAr: nameAr,
          periodLabel: `${run.year}-${String(run.month).padStart(2, "0")}`,
          paidDays: payslip.paidDays,
          basic: toNumber(totalOf(payslip, ["contract_basic"])),
          allowances: toNumber(totalOf(payslip, ["contract_allowance"])),
          gross: toNumber(payslip.grossEarnings),
          unpaidLeave: toNumber(unpaidLeave),
          garnishments: toNumber(garnishments),
          advanceRecovery: toNumber(advanceRecovery),
          otherDeductions: toNumber(other),
          totalDeductions: toNumber(payslip.totalDeductions),
          netPay: toNumber(payslip.netPay),
          employerContributions: toNumber(payslip.employerContributions),
          employerCost: toNumber(payslip.grossEarnings.add(payslip.employerContributions)),
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
      { key: "gross", header: "الإجمالي", format: "money", align: "end", value: (r) => r.gross, total: true },
      { key: "unpaidLeave", header: "إجازة بدون أجر", format: "money", align: "end", value: (r) => r.unpaidLeave, total: true },
      { key: "garnishments", header: "الحجوزات", format: "money", align: "end", value: (r) => r.garnishments, total: true },
      { key: "advanceRecovery", header: "أقساط السلف", format: "money", align: "end", value: (r) => r.advanceRecovery, total: true },
      { key: "otherDeductions", header: "استقطاعات أخرى", format: "money", align: "end", value: (r) => r.otherDeductions, total: true },
      { key: "netPay", header: "الصافي", format: "money", align: "end", value: (r) => r.netPay, total: true },
      { key: "employerContributions", header: "مساهمات صاحب العمل", format: "money", align: "end", value: (r) => r.employerContributions, total: true },
      { key: "employerCost", header: "تكلفة صاحب العمل", format: "money", align: "end", value: (r) => r.employerCost, total: true },
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
