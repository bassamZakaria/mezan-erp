import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { AttendanceEntry } from "../hr/attendance.js";
import type { Contract } from "../hr/contract.js";
import type { Employee } from "../hr/employee.js";
import type { LeaveBalance } from "../hr/leave-balance.js";
import type { LeavePolicy } from "../hr/leave-policy.js";
import { availableLeaveDays } from "../hr/leave-balance.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { BRANCH_PARAM_FIELD } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * The workforce reports — attendance, what unused leave is worth, and who
 * joined or departed.
 *
 * The money report here (leave liability) answers a question the payroll
 * register cannot: what the company OWES its staff for leave already accrued
 * but not yet paid. It is an unrecorded obligation until someone posts it —
 * the report is what makes it visible, and it names the GL account it should
 * be provisioned against so the comparison is available rather than implied.
 */

function toNumber(amount: Money): number {
  return Number(amount.toString());
}

function qtyToNumber(qty: Qty): number {
  return Number(qty.toString());
}

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
});

const asOfSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
});

function activeContract(contracts: readonly Contract[], employeeId: string, onDate: string): Contract | null {
  const candidates = contracts.filter(
    (c) => c.employeeId === employeeId && c.startDate <= onDate && (c.endDate === null || c.endDate >= onDate),
  );
  if (candidates.length === 0) {
    // A leaver has no contract in force on the as-of date; their LAST one is
    // still what their settlement is priced from.
    const past = contracts.filter((c) => c.employeeId === employeeId);
    return [...past].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
  }
  return [...candidates].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
}

/** Basic plus every allowance — the wage a settlement and a leave day are priced at. */
function comprehensiveWage(contract: Contract): Money {
  return contract.monthlySalary.add(Money.sum(contract.allowances.map((a) => a.amount)));
}

// --- 1. ملخص الحضور ---------------------------------------------------------

export interface AttendanceSummaryContext {
  readonly employees: readonly Employee[];
  readonly attendance: readonly AttendanceEntry[];
}

export interface AttendanceSummaryParams {
  readonly from: string;
  readonly to: string;
}

export interface AttendanceSummaryRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeNameAr: string;
  readonly presentDays: number;
  readonly lateDays: number;
  readonly halfDays: number;
  readonly absentDays: number;
  readonly leaveDays: number;
  readonly workedHours: number;
  readonly approvedOvertimeHours: number;
  readonly attendanceRate: number;
}

/**
 * ملخص الحضور — the days and hours behind every attendance-driven payroll
 * figure. Overtime is shown as APPROVED hours only, because approved hours are
 * what payroll pays; showing clocked hours here would explain a number the
 * payslip does not contain.
 */
export function createAttendanceSummaryReport(): ReportDefinition<AttendanceSummaryParams, AttendanceSummaryRow, AttendanceSummaryContext> {
  return {
    id: "hr.attendance-summary",
    titleAr: "ملخص الحضور والانصراف",
    descriptionAr: "أيام الحضور والتأخير والغياب والإجازات لكل موظف خلال الفترة، ومعها ساعات العمل والساعات الإضافية المعتمدة.",
    paramsSchema: dateRangeSchema,
    defaultParams: { from: "", to: "" },
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "from", toKey: "to", label: "الفترة" }, BRANCH_PARAM_FIELD],
    run: (params, ctx) => {
      const inRange = ctx.attendance.filter((e) => e.date >= params.from && e.date <= params.to);
      const byEmployee = new Map<string, AttendanceEntry[]>();
      for (const entry of inRange) {
        const bucket = byEmployee.get(entry.employeeId);
        if (bucket) bucket.push(entry);
        else byEmployee.set(entry.employeeId, [entry]);
      }
      const rows: AttendanceSummaryRow[] = [];
      for (const employee of ctx.employees) {
        const entries = byEmployee.get(employee.id) ?? [];
        if (entries.length === 0) continue;
        const presentDays = entries.filter((e) => e.status === "present").length;
        const lateDays = entries.filter((e) => e.status === "late").length;
        const halfDays = entries.filter((e) => e.status === "half_day").length;
        const absentDays = entries.filter((e) => e.status === "absent").length;
        const leaveDays = entries.filter((e) => e.status === EmployeeRefStatus.OnLeave).length;
        const workedMinutes = entries.reduce((sum, e) => sum + e.workedMinutes, 0);
        const overtimeMinutes = entries.reduce((sum, e) => sum + (e.approvedOvertimeMinutes ?? 0), 0);
        // Rest days are not attendance the employee can fail — a rate measured
        // against them would punish a weekend.
        const workingDays = presentDays + lateDays + halfDays + absentDays;
        rows.push({
          employeeId: employee.id,
          employeeCode: employee.code,
          employeeNameAr: `${employee.firstNameAr ?? employee.firstName} ${employee.lastNameAr ?? employee.lastName}`.trim(),
          presentDays,
          lateDays,
          halfDays,
          absentDays,
          leaveDays,
          workedHours: Math.round((workedMinutes / 60) * 100) / 100,
          approvedOvertimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
          attendanceRate: workingDays === 0 ? 0 : Math.round(((presentDays + lateDays + halfDays * 0.5) / workingDays) * 10_000) / 100,
        });
      }
      return rows;
    },
    rowKey: (row) => row.employeeId,
    columns: [
      { key: "employeeCode", header: "الكود", value: (r) => r.employeeCode },
      { key: "employeeNameAr", header: "الموظف", value: (r) => r.employeeNameAr },
      { key: "presentDays", header: "حضور", format: "qty", align: "end", value: (r) => r.presentDays, total: true },
      { key: "lateDays", header: "تأخير", format: "qty", align: "end", value: (r) => r.lateDays, total: true },
      { key: "halfDays", header: "نصف يوم", format: "qty", align: "end", value: (r) => r.halfDays, total: true },
      { key: "absentDays", header: "غياب", format: "qty", align: "end", value: (r) => r.absentDays, total: true },
      { key: "leaveDays", header: "إجازة", format: "qty", align: "end", value: (r) => r.leaveDays, total: true },
      { key: "workedHours", header: "ساعات العمل", format: "qty", align: "end", value: (r) => r.workedHours, total: true },
      { key: "approvedOvertimeHours", header: "إضافي معتمد", format: "qty", align: "end", value: (r) => r.approvedOvertimeHours, total: true },
      { key: "attendanceRate", header: "نسبة الالتزام", format: "percent", align: "end", value: (r) => r.attendanceRate },
    ],
    kpis: [
      { key: "employees", labelAr: "موظفون لهم سجل حضور", value: (rows) => rows.length },
      { key: "absent", labelAr: "إجمالي أيام الغياب", value: (rows) => sumRows(rows, (r) => r.absentDays), tone: (v) => (v > 0 ? "danger" : "default") },
      { key: "overtime", labelAr: "إجمالي الساعات الإضافية المعتمدة", value: (rows) => sumRows(rows, (r) => r.approvedOvertimeHours) },
    ],
    chart: { labelColumn: "employeeNameAr", valueColumn: "absentDays", maxPoints: 10, captionAr: "أعلى أيام غياب" },
  };
}

// --- 2. التزام الإجازات -----------------------------------------------------

export interface LeaveLiabilityContext {
  readonly employees: readonly Employee[];
  readonly contracts: readonly Contract[];
  readonly balances: readonly LeaveBalance[];
  readonly policies: readonly LeavePolicy[];
  readonly glBalancesByAccountId?: ReadonlyMap<string, Money>;
}

export interface LeaveLiabilityParams {
  readonly asOfDate: string;
}

export interface LeaveLiabilityRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeNameAr: string;
  readonly leaveType: string;
  readonly availableDays: number;
  readonly dailyRate: number;
  readonly liability: number;
}

/** GL leaf the accrued-leave obligation belongs in. */
export const LEAVE_LIABILITY_CONTROL_ACCOUNT = "2180";

/**
 * التزام رصيد الإجازات — unused leave that is CASHED OUT on termination, priced
 * at the employee's daily rate.
 *
 * Only leave types whose policy says `payoutOnTermination` are counted: leave
 * that expires costs nothing when an employee leaves, and counting it would
 * overstate the obligation. The day is priced on the conventional 30-day
 * divisor, which is what a settlement is actually paid on.
 */
export function createLeaveLiabilityReport(): ReportDefinition<LeaveLiabilityParams, LeaveLiabilityRow, LeaveLiabilityContext> {
  return {
    id: "hr.leave-liability",
    titleAr: "التزام رصيد الإجازات",
    descriptionAr: "قيمة أرصدة الإجازات غير المستخدمة التي تُصرف عند إنهاء الخدمة — التزام قائم على المنشأة حتى لو لم يُقيَّد بعد.",
    paramsSchema: asOfSchema,
    defaultParams: { asOfDate: "" },
    paramFields: [{ kind: ReportParamKind.Date, key: "asOfDate", label: "حتى تاريخ" }, BRANCH_PARAM_FIELD],
    run: (params, ctx) => {
      const payoutTypes = new Set(ctx.policies.filter((p) => p.payoutOnTermination && p.active).map((p) => p.leaveType));
      // Each year's balance already carries the previous year's unused days in
      // `carriedOver`, so only the latest year up to the as-of date is the
      // position; adding the earlier years counts the carried days twice.
      const asOfYear = Number(params.asOfDate.slice(0, 4)) || Number.POSITIVE_INFINITY;
      const current = new Map<string, LeaveBalance>();
      for (const balance of ctx.balances) {
        if (balance.year > asOfYear) continue;
        const key = `${balance.employeeId}:${balance.leaveType}`;
        const held = current.get(key);
        if (!held || balance.year > held.year) current.set(key, balance);
      }
      const rows: LeaveLiabilityRow[] = [];
      for (const balance of current.values()) {
        if (!payoutTypes.has(balance.leaveType)) continue;
        const available = availableLeaveDays(balance);
        if (available.isZero() || available.isNegative()) continue;
        const employee = ctx.employees.find((e) => e.id === balance.employeeId);
        if (!employee || employee.status === EmployeeRefStatus.Terminated) continue;
        const contract = activeContract(ctx.contracts, balance.employeeId, params.asOfDate);
        if (!contract) continue;
        const dailyRate = Money.fromScaled(comprehensiveWage(contract).scaled / 30n);
        rows.push({
          employeeId: balance.employeeId,
          employeeCode: employee.code,
          employeeNameAr: `${employee.firstNameAr ?? employee.firstName} ${employee.lastNameAr ?? employee.lastName}`.trim(),
          leaveType: balance.leaveType,
          availableDays: qtyToNumber(available),
          dailyRate: toNumber(dailyRate),
          liability: toNumber(Money.fromScaled((dailyRate.scaled * available.scaled) / 1_000_000n)),
        });
      }
      return rows;
    },
    rowKey: (row) => `${row.employeeId}:${row.leaveType}`,
    group: { key: (row) => row.leaveType, label: (row) => `نوع الإجازة: ${row.leaveType}` },
    columns: [
      { key: "employeeCode", header: "الكود", value: (r) => r.employeeCode },
      { key: "employeeNameAr", header: "الموظف", value: (r) => r.employeeNameAr },
      { key: "availableDays", header: "الرصيد المتاح (يوم)", format: "qty", align: "end", value: (r) => r.availableDays, total: true },
      { key: "dailyRate", header: "قيمة اليوم", format: "money", align: "end", value: (r) => r.dailyRate },
      { key: "liability", header: "قيمة الالتزام", format: "money", align: "end", value: (r) => r.liability, total: true },
    ],
    kpis: [
      { key: "employees", labelAr: "موظفون لهم رصيد قابل للصرف", value: (rows) => new Set(rows.map((r) => r.employeeId)).size },
      { key: "days", labelAr: "إجمالي الأيام غير المستخدمة", value: (rows) => sumRows(rows, (r) => r.availableDays) },
      { key: "liability", labelAr: "إجمالي الالتزام", format: "money", value: (rows) => sumRows(rows, (r) => r.liability) },
    ],
    reconciliation: {
      labelAr: "الالتزام المحتسب مقابل رصيد حساب التزام الإجازات المستحقة (2180)",
      computeReportTotal: (rows) => sumRows(rows, (r) => r.liability),
      computeReferenceTotal: (_rows, ctx) => {
        const balance = ctx.glBalancesByAccountId?.get(LEAVE_LIABILITY_CONTROL_ACCOUNT);
        return balance ? Number(balance.toString()) : 0;
      },
    },
  };
}

// --- 3. حركة العمالة --------------------------------------------------------

export interface HeadcountMovementContext {
  readonly employees: readonly Employee[];
}

export interface HeadcountMovementRow {
  readonly monthLabel: string;
  readonly joined: number;
  /** Named `leavers` rather than `left` so it cannot read as a CSS direction. */
  readonly leavers: number;
  readonly netChange: number;
  readonly closingHeadcount: number;
}

/**
 * حركة العمالة — joiners, leavers and the closing headcount, month by month.
 *
 * `closingHeadcount` counts everyone hired on or before the month end who had
 * not left by it, which is the only definition that stays true when a month has
 * both a joiner and a leaver.
 */
export function createHeadcountMovementReport(): ReportDefinition<AttendanceSummaryParams, HeadcountMovementRow, HeadcountMovementContext> {
  return {
    id: "hr.headcount-movement",
    titleAr: "حركة العمالة",
    descriptionAr: "الملتحقون والمنتهية خدمتهم وصافي التغير وعدد العاملين في نهاية كل شهر خلال الفترة.",
    paramsSchema: dateRangeSchema,
    defaultParams: { from: "", to: "" },
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "from", toKey: "to", label: "الفترة" }, BRANCH_PARAM_FIELD],
    run: (params, ctx) => {
      const months: string[] = [];
      const start = params.from.slice(0, 7);
      const end = params.to.slice(0, 7);
      let [year, month] = start.split("-").map((n) => Number.parseInt(n, 10)) as [number, number];
      for (let guard = 0; guard < 240; guard++) {
        const label = `${year}-${String(month).padStart(2, "0")}`;
        months.push(label);
        if (label >= end) break;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }

      return months.map((label) => {
        const monthEnd = `${label}-31`;
        const joined = ctx.employees.filter((e) => e.hireDate.slice(0, 7) === label).length;
        const leavers = ctx.employees.filter((e) => e.terminatedAt !== null && e.terminatedAt.slice(0, 7) === label).length;
        const closingHeadcount = ctx.employees.filter(
          (e) => e.hireDate <= monthEnd && (e.terminatedAt === null || e.terminatedAt.slice(0, 10) > monthEnd),
        ).length;
        return { monthLabel: label, joined, leavers, netChange: joined - leavers, closingHeadcount };
      });
    },
    rowKey: (row) => row.monthLabel,
    showGrandTotal: false,
    columns: [
      { key: "monthLabel", header: "الشهر", value: (r) => r.monthLabel },
      { key: "joined", header: "التحقوا", format: "qty", align: "end", value: (r) => r.joined, total: true },
      { key: "leavers", header: "انتهت خدمتهم", format: "qty", align: "end", value: (r) => r.leavers, total: true },
      { key: "netChange", header: "صافي التغير", format: "variance", align: "end", value: (r) => r.netChange, total: true },
      { key: "closingHeadcount", header: "العدد في نهاية الشهر", format: "qty", align: "end", value: (r) => r.closingHeadcount },
    ],
    kpis: [
      { key: "joined", labelAr: "إجمالي الملتحقين", value: (rows) => sumRows(rows, (r) => r.joined) },
      { key: "leavers", labelAr: "إجمالي المنتهية خدمتهم", value: (rows) => sumRows(rows, (r) => r.leavers) },
      {
        key: "turnover",
        labelAr: "معدل دوران العمالة",
        hintAr: "المنتهية خدمتهم ÷ متوسط العدد خلال الفترة.",
        format: "percent",
        value: (rows) => {
          const average = rows.length === 0 ? 0 : sumRows(rows, (r) => r.closingHeadcount) / rows.length;
          return average === 0 ? 0 : Math.round((sumRows(rows, (r) => r.leavers) / average) * 10_000) / 100;
        },
        tone: (v) => (v > 20 ? "danger" : "default"),
      },
    ],
    chart: { labelColumn: "monthLabel", valueColumn: "closingHeadcount", captionAr: "عدد العاملين شهرياً" },
  };
}
