import { InvalidAttendanceEntryError } from "./errors.js";
import type { Holiday } from "./holiday.js";
import { listHolidaysForYear } from "./holiday.js";

/**
 * Attendance — docs/archive/catalog/06-crm-hr.md "الحضور والانصراف". One row per
 * employee per calendar day, carrying the clock-in/clock-out pair, the worked
 * duration and the day's status code. The catalog's grid legend is the
 * authoritative status set: P/A/H/L/HO/— (present / absent / half day /
 * on leave / public holiday / weekly off); "late" (تأخير) is a highlight the
 * legend lists alongside the codes, modelled here as its own status because a
 * late day is still a worked day that reporting must separate from a clean
 * present.
 */

export type AttendanceStatus = "present" | "late" | "half_day" | "absent" | "on_leave" | "holiday" | "weekly_off";

export interface AttendanceStatusDefinition {
  readonly code: AttendanceStatus;
  readonly labelAr: string;
  /** Single/double-letter grid code from the catalog legend. */
  readonly gridCode: string;
}

export const ATTENDANCE_STATUS_DEFINITIONS: readonly AttendanceStatusDefinition[] = [
  { code: "present", labelAr: "حاضر", gridCode: "P" },
  { code: "late", labelAr: "تأخير", gridCode: "P" },
  { code: "half_day", labelAr: "نصف يوم", gridCode: "H" },
  { code: "absent", labelAr: "غائب", gridCode: "A" },
  { code: "on_leave", labelAr: "في إجازة", gridCode: "L" },
  { code: "holiday", labelAr: "إجازة رسمية", gridCode: "HO" },
  { code: "weekly_off", labelAr: "إجازة أسبوعية", gridCode: "—" },
] as const;

export function getAttendanceStatusLabel(status: AttendanceStatus): string {
  return ATTENDANCE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** Statuses that consume a working day without the employee being at work. */
export const NON_WORKING_ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["absent", "on_leave", "holiday", "weekly_off"];

export interface AttendanceEntry {
  readonly id: string;
  readonly employeeId: string;
  /** "YYYY-MM-DD". Unique together with `employeeId` — one entry per employee per day. */
  readonly date: string;
  /** "HH:MM" wall-clock, or null when the employee never clocked in. */
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  /** Exact worked duration in whole minutes — an integer, never a float hour count. */
  readonly workedMinutes: number;
  readonly status: AttendanceStatus;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AttendanceFilter {
  readonly employeeId?: string | null;
  /** Inclusive "YYYY-MM-DD" lower bound. */
  readonly from?: string | null;
  /** Inclusive "YYYY-MM-DD" upper bound. */
  readonly to?: string | null;
  readonly status?: AttendanceStatus | null;
}

/** Persistence port for attendance. The domain depends on this interface only. */
export interface AttendanceRepository {
  findById(id: string): Promise<AttendanceEntry | null>;
  findByEmployeeAndDate(employeeId: string, date: string): Promise<AttendanceEntry | null>;
  list(filter?: AttendanceFilter): Promise<AttendanceEntry[]>;
  create(entry: AttendanceEntry): Promise<void>;
  update(entry: AttendanceEntry): Promise<void>;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Egypt's default weekend (Friday, Saturday) as JS `getUTCDay()` indices. */
export const DEFAULT_WEEKLY_OFF_DAYS: readonly number[] = [5, 6];

function minutesOfDay(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new InvalidAttendanceEntryError([`الوقت "${time}" غير صالح، الصيغة المطلوبة HH:MM`]);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Worked duration in whole minutes. A checkout at or before the check-in is
 * read as an overnight shift and rolls over a full day, so a 22:00 → 06:00
 * shift counts 480 minutes rather than a negative duration.
 */
export function workedMinutesBetween(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const start = minutesOfDay(checkIn);
  const end = minutesOfDay(checkOut);
  return end > start ? end - start : end + 24 * 60 - start;
}

export function isWeeklyOffDay(date: string, weeklyOffDays: readonly number[] = DEFAULT_WEEKLY_OFF_DAYS): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weeklyOffDays.includes(day);
}

/** True when `date` falls on an official holiday, projecting recurring holidays onto that date's year. */
export function isHolidayDate(date: string, holidays: readonly Holiday[]): boolean {
  const year = Number(date.slice(0, 4));
  return listHolidaysForYear(holidays, year).some((h) => h.date === date);
}

export interface ResolveAttendanceStatusInput {
  readonly date: string;
  readonly checkIn: string | null;
  readonly halfDay?: boolean;
  /** Official holiday calendar — a holiday is never scored as an absence. */
  readonly holidays?: readonly Holiday[];
  readonly weeklyOffDays?: readonly number[];
  /** True when an approved leave request covers `date`. */
  readonly onApprovedLeave?: boolean;
  /** Shift start ("HH:MM"); without it lateness cannot be inferred and a clock-in scores plain present. */
  readonly expectedCheckIn?: string | null;
  readonly graceMinutes?: number;
}

/**
 * Derives the day's status code. Order matters: an actual clock-in always wins
 * (an employee who worked a public holiday is present, not "HO"), then the
 * holiday calendar, then approved leave, then the weekly off-day pattern —
 * only a plain working day with no clock-in is an absence.
 */
export function resolveAttendanceStatus(input: ResolveAttendanceStatusInput): AttendanceStatus {
  if (input.checkIn) {
    if (input.halfDay) return "half_day";
    if (input.expectedCheckIn) {
      const late = minutesOfDay(input.checkIn) > minutesOfDay(input.expectedCheckIn) + (input.graceMinutes ?? 0);
      if (late) return "late";
    }
    return "present";
  }
  if (input.holidays && isHolidayDate(input.date, input.holidays)) return "holiday";
  if (input.onApprovedLeave) return "on_leave";
  if (isWeeklyOffDay(input.date, input.weeklyOffDays)) return "weekly_off";
  return "absent";
}

export interface RecordAttendanceCommand {
  readonly id: string;
  readonly employeeId: string;
  readonly date: string;
  readonly checkIn?: string | null;
  readonly checkOut?: string | null;
  readonly halfDay?: boolean;
  readonly notes?: string | null;
  /** Explicit correction (e.g. marking a day "on_leave"); when absent the status is derived. */
  readonly status?: AttendanceStatus | null;
  readonly holidays?: readonly Holiday[];
  readonly weeklyOffDays?: readonly number[];
  readonly onApprovedLeave?: boolean;
  readonly expectedCheckIn?: string | null;
  readonly graceMinutes?: number;
}

function validate(command: Pick<RecordAttendanceCommand, "employeeId" | "date" | "checkIn" | "checkOut">): string[] {
  const reasons: string[] = [];
  if (command.employeeId.trim().length === 0) reasons.push("الموظف مطلوب");
  if (!DATE_PATTERN.test(command.date)) reasons.push("التاريخ مطلوب بصيغة YYYY-MM-DD");
  if (command.checkIn && !TIME_PATTERN.test(command.checkIn)) reasons.push("وقت الحضور غير صالح، الصيغة المطلوبة HH:MM");
  if (command.checkOut && !TIME_PATTERN.test(command.checkOut)) reasons.push("وقت الانصراف غير صالح، الصيغة المطلوبة HH:MM");
  if (command.checkOut && !command.checkIn) reasons.push("لا يمكن تسجيل الانصراف بدون حضور");
  return reasons;
}

/** Builds a new attendance entry, computing the worked duration and resolving the day's status. */
export function recordAttendance(command: RecordAttendanceCommand, now: () => string = () => new Date().toISOString()): AttendanceEntry {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidAttendanceEntryError(reasons);

  const checkIn = command.checkIn ?? null;
  const checkOut = command.checkOut ?? null;
  const timestamp = now();
  return {
    id: command.id,
    employeeId: command.employeeId,
    date: command.date,
    checkIn,
    checkOut,
    workedMinutes: workedMinutesBetween(checkIn, checkOut),
    status: command.status ?? resolveAttendanceStatus({ ...command, checkIn }),
    notes: command.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface CorrectAttendanceCommand {
  readonly checkIn?: string | null;
  readonly checkOut?: string | null;
  readonly halfDay?: boolean;
  readonly notes?: string | null;
  readonly status?: AttendanceStatus | null;
  readonly holidays?: readonly Holiday[];
  readonly weeklyOffDays?: readonly number[];
  readonly onApprovedLeave?: boolean;
  readonly expectedCheckIn?: string | null;
  readonly graceMinutes?: number;
}

/** Applies a correction to an existing entry, re-deriving the duration and (unless overridden) the status. */
export function correctAttendance(
  current: AttendanceEntry,
  patch: CorrectAttendanceCommand,
  now: () => string = () => new Date().toISOString(),
): AttendanceEntry {
  const checkIn = patch.checkIn === undefined ? current.checkIn : patch.checkIn;
  const checkOut = patch.checkOut === undefined ? current.checkOut : patch.checkOut;
  const reasons = validate({ employeeId: current.employeeId, date: current.date, checkIn, checkOut });
  if (reasons.length > 0) throw new InvalidAttendanceEntryError(reasons);

  return {
    ...current,
    checkIn,
    checkOut,
    workedMinutes: workedMinutesBetween(checkIn, checkOut),
    status: patch.status ?? resolveAttendanceStatus({ ...patch, date: current.date, checkIn }),
    notes: patch.notes === undefined ? current.notes : patch.notes,
    updatedAt: now(),
  };
}

export interface AttendanceSummary {
  readonly employeeId: string;
  readonly from: string;
  readonly to: string;
  readonly workingDays: number;
  readonly daysPresent: number;
  readonly daysLate: number;
  readonly daysAbsent: number;
  readonly halfDays: number;
  readonly daysOnLeave: number;
  readonly holidays: number;
  readonly weeklyOffDays: number;
  readonly workedMinutes: number;
  /** Present + late + half days over working days, in whole percent. */
  readonly attendanceRatePercent: number;
}

export interface WorkforceAttendanceSummary {
  readonly from: string;
  readonly to: string;
  /** Days that count as scheduled work: present + late + half + absent + on leave. */
  readonly workingDays: number;
  readonly daysPresent: number;
  readonly daysLate: number;
  readonly halfDays: number;
  readonly daysAbsent: number;
  readonly daysOnLeave: number;
  /** Absent days over working days, in whole percent — the dashboard's معدل الغياب. */
  readonly absenceRatePercent: number;
  /** Late arrivals over the days actually attended, in whole percent. */
  readonly lateArrivalRatePercent: number;
}

/**
 * The whole workforce's attendance over a window — the HR dashboard's
 * absence-rate and late-arrival KPIs (R10.1).
 *
 * Deliberately NOT the sum of `summarizeAttendance` per employee: the rates are
 * computed over the pooled day counts, so an employee with two recorded days
 * cannot swing the company rate as far as one with twenty.
 */
export function summarizeWorkforceAttendance(from: string, to: string, entries: readonly AttendanceEntry[]): WorkforceAttendanceSummary {
  const scoped = entries.filter((e) => e.date >= from && e.date <= to);
  const count = (status: AttendanceStatus) => scoped.filter((e) => e.status === status).length;
  const daysPresent = count("present");
  const daysLate = count("late");
  const halfDays = count("half_day");
  const daysAbsent = count("absent");
  const daysOnLeave = count("on_leave");
  const workingDays = daysPresent + daysLate + halfDays + daysAbsent + daysOnLeave;
  const attended = daysPresent + daysLate + halfDays;
  return {
    from,
    to,
    workingDays,
    daysPresent,
    daysLate,
    halfDays,
    daysAbsent,
    daysOnLeave,
    absenceRatePercent: workingDays === 0 ? 0 : Math.round((daysAbsent / workingDays) * 100),
    lateArrivalRatePercent: attended === 0 ? 0 : Math.round((daysLate / attended) * 100),
  };
}

/** Aggregates one employee's entries into the catalog's "الملخص الشهري للحضور" KPI tiles. */
export function summarizeAttendance(employeeId: string, from: string, to: string, entries: readonly AttendanceEntry[]): AttendanceSummary {
  const scoped = entries.filter((e) => e.employeeId === employeeId && e.date >= from && e.date <= to);
  const count = (status: AttendanceStatus) => scoped.filter((e) => e.status === status).length;
  const daysPresent = count("present");
  const daysLate = count("late");
  const halfDays = count("half_day");
  const daysAbsent = count("absent");
  const daysOnLeave = count("on_leave");
  const holidays = count("holiday");
  const weeklyOffDays = count("weekly_off");
  const workingDays = daysPresent + daysLate + halfDays + daysAbsent + daysOnLeave;
  const attended = daysPresent + daysLate + halfDays;
  return {
    employeeId,
    from,
    to,
    workingDays,
    daysPresent,
    daysLate,
    daysAbsent,
    halfDays,
    daysOnLeave,
    holidays,
    weeklyOffDays,
    workedMinutes: scoped.reduce((sum, e) => sum + e.workedMinutes, 0),
    attendanceRatePercent: workingDays === 0 ? 0 : Math.round((attended / workingDays) * 100),
  };
}
