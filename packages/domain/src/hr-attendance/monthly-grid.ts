import type { AttendanceDayStatus, AttendanceRecordRepository } from "./attendance.js";
import { daysInMonth, isWeeklyOff } from "./weekly-off.js";

export interface EmployeeDayStatus {
  readonly date: string;
  /** Null = unmarked (no record yet, and not a weekly-off day — the "+" placeholder cell). */
  readonly status: AttendanceDayStatus | null;
  readonly overtimeHours: number;
}

export interface EmployeeMonthGrid {
  readonly employeeId: string;
  readonly days: readonly EmployeeDayStatus[];
}

export interface MonthlyGridDeps {
  readonly records: AttendanceRecordRepository;
}

/**
 * Builds the monthly attendance grid (docs/catalog "الحضور والانصراف"):
 * for each requested employee, one cell per day-of-month — an explicit
 * record wins, otherwise a weekend day (per `weekendDays`) derives to
 * `WEEKLY_OFF`, otherwise the cell is unmarked (`null`).
 */
export async function getMonthlyGrid(
  employeeIds: readonly string[],
  year: number,
  month: number,
  weekendDays: readonly number[],
  deps: MonthlyGridDeps,
): Promise<EmployeeMonthGrid[]> {
  const days = daysInMonth(year, month);
  const fromDate = days[0]!;
  const toDate = days[days.length - 1]!;
  const records = await deps.records.listForRange(employeeIds, fromDate, toDate);
  const byEmployeeDate = new Map(records.map((r) => [`${r.employeeId}::${r.date}`, r]));

  return employeeIds.map((employeeId) => ({
    employeeId,
    days: days.map((date) => {
      const record = byEmployeeDate.get(`${employeeId}::${date}`);
      if (record) {
        return { date, status: record.status, overtimeHours: record.overtimeHours };
      }
      if (isWeeklyOff(date, weekendDays)) {
        return { date, status: "WEEKLY_OFF" as const, overtimeHours: 0 };
      }
      return { date, status: null, overtimeHours: 0 };
    }),
  }));
}

export interface MonthlyAttendanceSummary {
  readonly employeeId: string;
  readonly year: number;
  readonly month: number;
  /** Business days in the month (excludes weekly-off, includes public holidays — a "working day" the roster expects attendance on unless it's a gazetted holiday). */
  readonly workingDays: number;
  readonly presentDays: number;
  readonly absentDays: number;
  readonly halfDays: number;
  readonly onLeaveDays: number;
  readonly publicHolidayDays: number;
  readonly overtimeHours: number;
  /** presentDays / workingDays, 0..100, 0 when there are no working days. */
  readonly attendanceRate: number;
}

/** Builds one employee's monthly KPI summary + day-detail list, straight from `getMonthlyGrid`'s output. */
export async function getMonthlySummary(
  employeeId: string,
  year: number,
  month: number,
  weekendDays: readonly number[],
  deps: MonthlyGridDeps,
): Promise<MonthlyAttendanceSummary> {
  const [grid] = await getMonthlyGrid([employeeId], year, month, weekendDays, deps);
  const days = grid?.days ?? [];

  let workingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let onLeaveDays = 0;
  let publicHolidayDays = 0;
  let overtimeHours = 0;

  for (const day of days) {
    if (day.status !== "WEEKLY_OFF") workingDays += 1;
    overtimeHours += day.overtimeHours;
    switch (day.status) {
      case "PRESENT":
        presentDays += 1;
        break;
      case "ABSENT":
        absentDays += 1;
        break;
      case "HALF_DAY":
        halfDays += 1;
        break;
      case "ON_LEAVE":
        onLeaveDays += 1;
        break;
      case "PUBLIC_HOLIDAY":
        publicHolidayDays += 1;
        break;
      default:
        break;
    }
  }

  return {
    employeeId,
    year,
    month,
    workingDays,
    presentDays,
    absentDays,
    halfDays,
    onLeaveDays,
    publicHolidayDays,
    overtimeHours,
    attendanceRate: workingDays === 0 ? 0 : Math.round((presentDays / workingDays) * 1000) / 10,
  };
}

/**
 * Payable days for one employee/month — feeds the payroll day-count (HR-5,
 * not built here): present (1), half-day (0.5), public holiday (1), weekly-off
 * (1, paid rest day) and on-leave (1, approved leave is paid unless the leave
 * type says otherwise — that policy nuance belongs to Leave Policies/payroll,
 * not attendance). Absent and unmarked days are unpaid (0).
 */
export async function countPayableDays(
  employeeId: string,
  year: number,
  month: number,
  weekendDays: readonly number[],
  deps: MonthlyGridDeps,
): Promise<number> {
  const [grid] = await getMonthlyGrid([employeeId], year, month, weekendDays, deps);
  const days = grid?.days ?? [];
  let total = 0;
  for (const day of days) {
    switch (day.status) {
      case "PRESENT":
      case "PUBLIC_HOLIDAY":
      case "WEEKLY_OFF":
      case "ON_LEAVE":
        total += 1;
        break;
      case "HALF_DAY":
        total += 0.5;
        break;
      default:
        break;
    }
  }
  return total;
}
