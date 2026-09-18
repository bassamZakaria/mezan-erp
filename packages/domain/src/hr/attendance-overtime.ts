import {
  DEFAULT_WEEKLY_OFF_DAYS,
  isWeeklyOffDay,
  isHolidayDate,
  type AttendanceEntry,
  type AttendanceRepository,
} from "./attendance.js";
import type { Holiday } from "./holiday.js";
import { overtimeKindForHour } from "./statutory-payroll.js";
import type { OvertimeHoursProvider, PeriodOvertimeHours } from "./payroll-run.js";
import type { OvertimeTable } from "./egypt-statutory.js";

/**
 * The bridge from attendance to payroll.
 *
 * Attendance stores clock times; payroll needs hours priced at the right
 * statutory premium. This module is the only place that knows both shapes.
 *
 * WHAT COUNTS AS OVERTIME. Minutes worked beyond the standard day, on a day
 * that was actually worked. A manager's `approvedOvertimeMinutes` OVERRIDES the
 * derived figure entirely — including overriding it downward to zero — because
 * a clock records presence, not authorised work. Where no approval was recorded
 * the derived minutes are used, so a site that clocks in does not have to
 * double-enter; `requireApproval` flips that for tenants who want the stricter rule.
 *
 * WHICH PREMIUM. Overtime on a weekly-off day or a public holiday takes the
 * rest-day premium whatever the hour. Otherwise the premium follows the clock
 * time the overtime was worked at — the hours AFTER the standard day ended, not
 * the hours the shift started.
 */

export interface OvertimeDerivationOptions {
  readonly standardDailyHours: number;
  readonly weeklyOffDays?: readonly number[];
  readonly holidays?: readonly Holiday[];
  /** When true, only `approvedOvertimeMinutes` pays; derived minutes are ignored. */
  readonly requireApproval?: boolean;
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function parseHour(time: string | null): number | null {
  if (!time) return null;
  const hour = Number.parseInt(time.slice(0, 2), 10);
  return Number.isFinite(hour) ? hour : null;
}

/** Overtime minutes for one day, and the clock hour they began at. */
export function overtimeMinutesForEntry(
  entry: AttendanceEntry,
  options: OvertimeDerivationOptions,
): { minutes: number; startHour: number | null } {
  const standardMinutes = Math.max(Math.round(options.standardDailyHours * 60), 0);
  const derived = Math.max(entry.workedMinutes - standardMinutes, 0);
  const approved = entry.approvedOvertimeMinutes;
  const minutes = approved !== null ? approved : options.requireApproval ? 0 : derived;
  if (minutes <= 0) return { minutes: 0, startHour: null };

  const checkInHour = parseHour(entry.checkIn);
  // Overtime begins where the standard day ended, so a shift that started at
  // 14:00 and ran twelve hours is night overtime, not day overtime.
  const startHour = checkInHour === null ? null : (checkInHour + Math.floor(standardMinutes / 60)) % 24;
  return { minutes, startHour };
}

/** Totals a period's attendance into the three statutory overtime buckets. */
export function summarizeOvertime(
  entries: readonly AttendanceEntry[],
  table: OvertimeTable,
  options: OvertimeDerivationOptions,
): PeriodOvertimeHours {
  const weeklyOff = options.weeklyOffDays ?? DEFAULT_WEEKLY_OFF_DAYS;
  const holidays = options.holidays ?? [];
  let dayMinutes = 0;
  let nightMinutes = 0;
  let restDayMinutes = 0;

  for (const entry of entries) {
    const { minutes, startHour } = overtimeMinutesForEntry(entry, options);
    if (minutes <= 0) continue;
    const isRestDay =
      entry.status === "weekly_off" || entry.status === "holiday" || isWeeklyOffDay(entry.date, weeklyOff) || isHolidayDate(entry.date, holidays);
    const kind = overtimeKindForHour(startHour ?? 9, isRestDay, table);
    if (kind === "rest_day") restDayMinutes += minutes;
    else if (kind === "night") nightMinutes += minutes;
    else dayMinutes += minutes;
  }

  return { day: minutesToHours(dayMinutes), night: minutesToHours(nightMinutes), restDay: minutesToHours(restDayMinutes) };
}

/**
 * Binds a live attendance repository to payroll's overtime seam.
 *
 * `resolveOptions` is called per calculation, not captured at wiring time: the
 * standard day, the weekend and the holiday calendar all live in tenant data
 * that changes without a restart, and a rest-day premium that misses an actual
 * public holiday is a silently wrong payslip.
 */
export function createOvertimeHoursProvider(
  repo: Pick<AttendanceRepository, "list">,
  table: OvertimeTable,
  resolveOptions: () => Promise<OvertimeDerivationOptions> | OvertimeDerivationOptions,
): OvertimeHoursProvider {
  return {
    async overtimeHoursFor(employeeId, periodStart, periodEnd) {
      const [entries, options] = await Promise.all([repo.list({ employeeId, from: periodStart, to: periodEnd }), resolveOptions()]);
      return summarizeOvertime(entries, table, options);
    },
  };
}
