/**
 * الحضور والانصراف — Attendance (docs/catalog/06-crm-hr.md §"الحضور
 * والانصراف"). A monthly grid, one row per employee, one column per
 * day-of-month; each cell is a status code. Only days an admin/device
 * EXPLICITLY marks are persisted as `AttendanceRecord`s — weekly-off days are
 * never stored, they're derived on read from `TenantSettings.weekendDays`
 * (`weekly-off.ts`), so a change to the weekend-day setting retroactively
 * re-derives every past grid without a backfill.
 */

/** The 5 explicit, persisted status codes (docs/catalog legend: P/A/H/L/HO). Weekly-off ("—") is derived, never stored — see weekly-off.ts. */
export type AttendanceStatus =
  | "PRESENT" // P — حاضر
  | "ABSENT" // A — غائب
  | "HALF_DAY" // H — نصف يوم
  | "ON_LEAVE" // L — في إجازة
  | "PUBLIC_HOLIDAY"; // HO — إجازة رسمية

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "ON_LEAVE",
  "PUBLIC_HOLIDAY",
];

/** A day's status as actually shown in the grid — the 5 stored codes plus the derived weekly-off. */
export type AttendanceDayStatus = AttendanceStatus | "WEEKLY_OFF";

export interface AttendanceRecord {
  readonly id: string;
  readonly employeeId: string;
  /** ISO date (YYYY-MM-DD). */
  readonly date: string;
  readonly status: AttendanceStatus;
  /** Hours worked beyond the standard shift on this day, if any. */
  readonly overtimeHours: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for attendance records. The domain depends on this interface only — no SQL, no driver. */
export interface AttendanceRecordRepository {
  findByEmployeeAndDate(employeeId: string, date: string): Promise<AttendanceRecord | null>;
  /** All explicit records for a set of employees within [fromDate, toDate] (inclusive, ISO dates). */
  listForRange(
    employeeIds: readonly string[] | null,
    fromDate: string,
    toDate: string,
  ): Promise<AttendanceRecord[]>;
  /** Upsert keyed on (employeeId, date) — marking the same day twice replaces the prior mark. */
  save(record: AttendanceRecord): Promise<void>;
}

export class InvalidAttendanceRecordError extends Error {
  readonly code = "INVALID_ATTENDANCE_RECORD";
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttendanceRecordError";
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(date: string, field = "date"): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new InvalidAttendanceRecordError(`${field} must be a valid ISO date (YYYY-MM-DD): "${date}"`);
  }
}
