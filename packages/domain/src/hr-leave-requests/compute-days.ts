import { isWeeklyOff } from "../hr-attendance/index.js";
import { InvalidLeaveApplicationError } from "./leave-request.js";

/**
 * Day count for a leave request: 0.5 for a half-day request (start === end,
 * per the catalog's helper text "حدد يوماً واحداً وسيتم احتساب نصف يوم"),
 * otherwise the count of non-weekly-off calendar days in [startDate, endDate]
 * — consistent with Attendance's own weekly-off derivation, so a leave
 * request never consumes balance for the employee's regular day off.
 */
export function computeLeaveDays(
  startDate: string,
  endDate: string,
  halfDay: boolean,
  weekendDays: readonly number[],
): number {
  if (startDate > endDate) {
    throw new InvalidLeaveApplicationError(`startDate "${startDate}" is after endDate "${endDate}"`);
  }
  if (halfDay) {
    if (startDate !== endDate) {
      throw new InvalidLeaveApplicationError("A half-day request must have startDate === endDate");
    }
    return 0.5;
  }

  let days = 0;
  let cursor = startDate;
  while (cursor <= endDate) {
    if (!isWeeklyOff(cursor, weekendDays)) days += 1;
    cursor = nextDate(cursor);
  }
  return days;
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
