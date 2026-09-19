import { DEFAULT_WEEKLY_OFF_DAYS, isHolidayDate, isWeeklyOffDay, type AttendanceEntry, type AttendanceRepository, type AttendanceStatus } from "./attendance.js";
import { dayTypeOf, type OvertimeDerivationOptions } from "./attendance-overtime.js";
import { isUnpaidLeaveType, type LeaveRequest, type LeaveRequestRepository } from "./leave-request.js";
import type { PeriodWorkedTime, WorkedTimeProvider } from "./payroll-run.js";

// Invariant (D187): on a rest day or holiday only APPROVED time pays, and time
// beyond the standard day is never ordinary time — overtime prices it.
const WORKED_STATUSES: readonly AttendanceStatus[] = ["present", "late", "half_day"];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function* datesBetween(from: string, to: string): Generator<string> {
  for (let date = from; date <= to; date = addDays(date, 1)) yield date;
}

export function summarizeWorkedTime(
  entries: readonly AttendanceEntry[],
  leaveRequests: readonly LeaveRequest[],
  options: OvertimeDerivationOptions,
  from: string,
  to: string,
): PeriodWorkedTime {
  const standardMinutes = Math.max(Math.round(options.standardDailyHours * 60), 0);
  const requireApproval = options.requireApproval ?? true;
  const weeklyOffDays = options.weeklyOffDays ?? DEFAULT_WEEKLY_OFF_DAYS;
  const holidays = options.holidays ?? [];
  const isScheduled = (date: string) => !isWeeklyOffDay(date, weeklyOffDays) && !isHolidayDate(date, holidays);

  let workedMinutes = 0;
  let workedHalfDays = 0;
  const worked = new Set<string>();
  const unclockedDays: string[] = [];
  const unapprovedOffDays: string[] = [];

  const inRange = [...entries]
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const entry of inRange) {
    if (worked.has(entry.date)) continue;
    const markedWorked = WORKED_STATUSES.includes(entry.status);
    const halfDays = entry.status === "half_day" ? 1 : 2;
    if (dayTypeOf(entry, options) === "working") {
      if (!markedWorked) continue;
      worked.add(entry.date);
      workedHalfDays += halfDays;
      if (entry.workedMinutes > 0) workedMinutes += Math.min(entry.workedMinutes, standardMinutes);
      else unclockedDays.push(entry.date);
      continue;
    }
    const approved = entry.approvedOvertimeMinutes;
    const minutes = approved !== null ? approved : requireApproval ? 0 : entry.workedMinutes;
    if (minutes > 0) {
      worked.add(entry.date);
      workedHalfDays += halfDays;
      workedMinutes += Math.min(minutes, standardMinutes);
    } else if (markedWorked || entry.workedMinutes > 0) {
      unapprovedOffDays.push(entry.date);
    }
  }

  let paidHolidays = 0;
  for (const date of datesBetween(from, to)) {
    if (isHolidayDate(date, holidays) && !isWeeklyOffDay(date, weeklyOffDays) && !worked.has(date)) paidHolidays += 1;
  }

  let paidLeaveHalfDays = 0;
  const onPaidLeave = new Set<string>();
  for (const request of leaveRequests) {
    if (request.status !== "approved" || isUnpaidLeaveType(request.leaveType)) continue;
    if (request.endDate < from || request.startDate > to) continue;
    if (request.halfDay) {
      const date = request.startDate;
      if (isScheduled(date) && !worked.has(date) && !onPaidLeave.has(date)) {
        onPaidLeave.add(date);
        paidLeaveHalfDays += 1;
      }
      continue;
    }
    const start = request.startDate > from ? request.startDate : from;
    const end = request.endDate < to ? request.endDate : to;
    for (const date of datesBetween(start, end)) {
      if (!isScheduled(date) || worked.has(date) || onPaidLeave.has(date)) continue;
      onPaidLeave.add(date);
      paidLeaveHalfDays += 2;
    }
  }

  return {
    workedMinutes,
    workedHalfDays,
    paidLeaveHalfDays,
    paidHolidays,
    standardDailyHours: options.standardDailyHours,
    unclockedDays,
    unapprovedOffDays,
  };
}

export function createWorkedTimeProvider(
  attendance: Pick<AttendanceRepository, "list">,
  leaveRequests: Pick<LeaveRequestRepository, "listByEmployeeId">,
  resolveOptions: (employeeId: string) => Promise<OvertimeDerivationOptions> | OvertimeDerivationOptions,
): WorkedTimeProvider {
  return {
    async workedTimeFor(employeeId, from, to) {
      const [entries, requests, options] = await Promise.all([
        attendance.list({ employeeId, from, to }),
        leaveRequests.listByEmployeeId(employeeId),
        resolveOptions(employeeId),
      ]);
      return summarizeWorkedTime(entries, requests, options, from, to);
    },
  };
}
