import {
  DEFAULT_WEEKLY_OFF_DAYS,
  isWeeklyOffDay,
  isHolidayDate,
  type AttendanceEntry,
  type AttendanceRepository,
} from "./attendance.js";
import type { Holiday } from "./holiday.js";
import type { Employee } from "./employee.js";
import type { Department } from "./department.js";
import { overtimeKindForHour } from "./statutory-payroll.js";
import type { OutstandingReplacementDay, OvertimeHoursProvider, OvertimeWorkedUnderTable, PeriodOvertimeHours } from "./payroll-run.js";
import { resolveOvertimeTable, type OvertimeTable } from "./egypt-statutory.js";

/**
 * The bridge from attendance to payroll.
 *
 * Attendance stores clock times; payroll needs hours and days priced at the
 * right statutory rate. This module is the only place that knows both shapes.
 *
 * WHAT PAYS. Only overtime a manager APPROVED (`approvedOvertimeMinutes`), by
 * default: a clock records presence, not authorised work. A tenant may opt
 * out with `requireApproval: false`, and then the derived minutes pay where no
 * approval was recorded. An approval of zero always means none.
 *
 * WHICH DAY. On a working day the overtime is the time beyond the employee's
 * standard day. On a weekly rest day or an official holiday ALL approved time
 * is outside the schedule: the day itself earns the table's extra day's wage
 * (one for a rest day, two for a holiday), and only the time beyond the
 * standard day is priced as day or night overtime on top.
 *
 * WHICH LAW. Each day is priced by the overtime table in force on THAT day, so
 * a period that straddles a change in the law is split rather than priced
 * wholesale by either side.
 *
 * WHO. An employee not eligible for overtime is paid no hourly overtime; the
 * rest-day and holiday compensation is a statutory right of every worker and
 * is paid regardless.
 */

export interface OvertimeDerivationOptions {
  readonly standardDailyHours: number;
  readonly weeklyOffDays?: readonly number[];
  readonly holidays?: readonly Holiday[];
  /** Defaults to true: only `approvedOvertimeMinutes` pays. */
  readonly requireApproval?: boolean;
  /** Defaults to true. */
  readonly overtimeEligible?: boolean;
  /** The table in force on a date; defaults to the shipped dated tables. */
  readonly tableFor?: (date: string) => OvertimeTable;
}

export type OvertimeDayType = "working" | "rest_day" | "holiday";

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function parseHour(time: string | null): number | null {
  if (!time) return null;
  const hour = Number.parseInt(time.slice(0, 2), 10);
  return Number.isFinite(hour) ? hour : null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayTypeOf(entry: Pick<AttendanceEntry, "date" | "status">, options: Pick<OvertimeDerivationOptions, "holidays" | "weeklyOffDays">): OvertimeDayType {
  const holidays = options.holidays ?? [];
  if (entry.status === "holiday" || isHolidayDate(entry.date, holidays)) return "holiday";
  if (entry.status === "weekly_off" || isWeeklyOffDay(entry.date, options.weeklyOffDays ?? DEFAULT_WEEKLY_OFF_DAYS)) return "rest_day";
  return "working";
}

/** Approved minutes worked outside the schedule on one day, and the clock hour the part beyond the standard day began at. */
export function overtimeMinutesForEntry(
  entry: AttendanceEntry,
  options: OvertimeDerivationOptions,
  dayType: OvertimeDayType = "working",
): { minutes: number; startHour: number | null } {
  const standardMinutes = Math.max(Math.round(options.standardDailyHours * 60), 0);
  const derived = dayType === "working" ? Math.max(entry.workedMinutes - standardMinutes, 0) : entry.workedMinutes;
  const approved = entry.approvedOvertimeMinutes;
  const requireApproval = options.requireApproval ?? true;
  const minutes = approved !== null ? approved : requireApproval ? 0 : derived;
  if (minutes <= 0) return { minutes: 0, startHour: null };

  const checkInHour = parseHour(entry.checkIn);
  // Overtime begins where the standard day ended, so a shift that started at
  // 14:00 and ran twelve hours is night overtime, not day overtime.
  const startHour = checkInHour === null ? null : (checkInHour + Math.floor(standardMinutes / 60)) % 24;
  return { minutes, startHour };
}

interface Bucket {
  table: OvertimeTable;
  dayMinutes: number;
  nightMinutes: number;
  restDays: number;
  holidays: number;
}

/**
 * Totals a period's attendance into the statutory overtime buckets, one set
 * per overtime table in force during the period.
 *
 * `entries` may reach beyond the period on either side: days outside
 * `[periodStart, periodEnd]` are never paid, but they are read to match a
 * راحة بديلة (`compensatory_off`) against the rest day it replaces.
 */
export function summarizeOvertime(
  entries: readonly AttendanceEntry[],
  options: OvertimeDerivationOptions,
  periodStart?: string,
  periodEnd?: string,
): PeriodOvertimeHours {
  const tableFor = options.tableFor ?? ((date: string) => resolveOvertimeTable(date));
  const eligible = options.overtimeEligible ?? true;
  const standardMinutes = Math.max(Math.round(options.standardDailyHours * 60), 0);
  const inPeriod = (date: string) => (periodStart === undefined || date >= periodStart) && (periodEnd === undefined || date <= periodEnd);

  const buckets = new Map<string, Bucket>();
  let ineligibleMinutes = 0;
  let holidaysTakenAsDayOff = 0;
  const substituteDayRefusedOn: string[] = [];
  const owed: { workedOn: string; kind: "rest_day" | "holiday"; dueBy: string | null; counted: boolean }[] = [];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const entry of sorted) {
    if (periodEnd !== undefined && entry.date > periodEnd) continue;
    const dayType = dayTypeOf(entry, options);
    const { minutes, startHour } = overtimeMinutesForEntry(entry, options, dayType);
    if (minutes <= 0) continue;
    const table = tableFor(entry.date);
    const counted = inPeriod(entry.date);

    let hourlyMinutes = minutes;
    if (dayType !== "working") {
      hourlyMinutes = Math.max(minutes - standardMinutes, 0);
      if (dayType === "rest_day") {
        owed.push({ workedOn: entry.date, kind: "rest_day", dueBy: addDays(entry.date, table.restDayReplacementWithinDays), counted });
      } else if (entry.holidayCompensation === "day_off" && table.holidaySubstituteDayAllowed) {
        owed.push({ workedOn: entry.date, kind: "holiday", dueBy: null, counted });
      }
    }
    if (!counted) continue;

    const bucket = buckets.get(table.code) ?? { table, dayMinutes: 0, nightMinutes: 0, restDays: 0, holidays: 0 };
    buckets.set(table.code, bucket);
    if (dayType === "rest_day") bucket.restDays += 1;
    if (dayType === "holiday") {
      if (entry.holidayCompensation === "day_off" && table.holidaySubstituteDayAllowed) holidaysTakenAsDayOff += 1;
      else {
        if (entry.holidayCompensation === "day_off") substituteDayRefusedOn.push(entry.date);
        bucket.holidays += 1;
      }
    }
    if (hourlyMinutes <= 0) continue;
    if (!eligible) {
      ineligibleMinutes += hourlyMinutes;
      continue;
    }
    if (overtimeKindForHour(startHour ?? 9, table) === "night") bucket.nightMinutes += hourlyMinutes;
    else bucket.dayMinutes += hourlyMinutes;
  }

  const replacements = sorted.filter((e) => e.status === "compensatory_off").map((e) => e.date);
  const used = new Set<number>();
  const outstandingReplacementDays: OutstandingReplacementDay[] = [];
  for (const due of owed) {
    const match = replacements.findIndex((date, i) => !used.has(i) && date > due.workedOn && (due.dueBy === null || date <= due.dueBy));
    if (match >= 0) used.add(match);
    else if (due.counted) outstandingReplacementDays.push({ workedOn: due.workedOn, kind: due.kind, dueBy: due.dueBy });
  }

  const byTable: OvertimeWorkedUnderTable[] = [...buckets.values()]
    .sort((a, b) => (a.table.effectiveFrom < b.table.effectiveFrom ? -1 : 1))
    .map((b) => ({ table: b.table, day: minutesToHours(b.dayMinutes), night: minutesToHours(b.nightMinutes), restDays: b.restDays, holidays: b.holidays }));

  return {
    byTable,
    standardDailyHours: options.standardDailyHours,
    overtimeEligible: eligible,
    ineligibleHours: minutesToHours(ineligibleMinutes),
    holidaysTakenAsDayOff,
    substituteDayRefusedOn,
    outstandingReplacementDays,
  };
}

/**
 * An employee's own standard day and overtime eligibility: the employee's
 * setting, else the department's, else the company's. The standard day is
 * both where overtime starts and the divisor of the hourly rate.
 */
export function employeeOvertimePolicy(
  employee: Pick<Employee, "overtimeEligibility" | "standardWorkHours"> | null,
  department: Pick<Department, "overtimeEligible" | "standardWorkHours"> | null,
  companyStandardDailyHours: number,
): { readonly standardDailyHours: number; readonly overtimeEligible: boolean } {
  const eligibility = employee?.overtimeEligibility ?? "inherit_department";
  return {
    standardDailyHours: employee?.standardWorkHours ?? department?.standardWorkHours ?? companyStandardDailyHours,
    overtimeEligible: eligibility === "inherit_department" ? (department?.overtimeEligible ?? true) : eligibility === "eligible",
  };
}

/** How far past the period a replacement rest day may fall, and so how far attendance is read beyond it. */
const REPLACEMENT_LOOKAROUND_DAYS = 7;

/**
 * Binds a live attendance repository to payroll's overtime seam.
 *
 * `resolveOptions` is called per employee per calculation, not captured at
 * wiring time: the standard day, the eligibility, the weekend and the holiday
 * calendar all live in tenant data that changes without a restart.
 */
export function createOvertimeHoursProvider(
  repo: Pick<AttendanceRepository, "list">,
  resolveOptions: (employeeId: string) => Promise<OvertimeDerivationOptions> | OvertimeDerivationOptions,
): OvertimeHoursProvider {
  return {
    async overtimeHoursFor(employeeId, periodStart, periodEnd) {
      const [entries, options] = await Promise.all([
        repo.list({ employeeId, from: addDays(periodStart, -REPLACEMENT_LOOKAROUND_DAYS), to: addDays(periodEnd, REPLACEMENT_LOOKAROUND_DAYS) }),
        resolveOptions(employeeId),
      ]);
      return summarizeOvertime(entries, options, periodStart, periodEnd);
    },
  };
}
