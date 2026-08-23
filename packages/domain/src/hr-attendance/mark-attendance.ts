import type { AttendanceRecord, AttendanceRecordRepository, AttendanceStatus } from "./attendance.js";
import { assertIsoDate, ATTENDANCE_STATUSES, InvalidAttendanceRecordError } from "./attendance.js";

export interface MarkAttendanceCommand {
  readonly id: string;
  readonly employeeId: string;
  readonly date: string;
  readonly status: AttendanceStatus;
  readonly overtimeHours?: number;
  readonly notes?: string | null;
  readonly now?: () => string;
}

export interface MarkAttendanceDeps {
  readonly records: AttendanceRecordRepository;
}

/**
 * Marks (creates or replaces) one employee's attendance status for one day.
 * Idempotent per (employeeId, date) — re-marking a day updates the existing
 * record rather than accumulating duplicates.
 */
export async function markAttendance(
  cmd: MarkAttendanceCommand,
  deps: MarkAttendanceDeps,
): Promise<AttendanceRecord> {
  if (cmd.employeeId.trim() === "") {
    throw new InvalidAttendanceRecordError("employeeId is required");
  }
  assertIsoDate(cmd.date);
  if (!ATTENDANCE_STATUSES.includes(cmd.status)) {
    throw new InvalidAttendanceRecordError(`Unknown attendance status: "${cmd.status}"`);
  }
  const overtimeHours = cmd.overtimeHours ?? 0;
  if (overtimeHours < 0) {
    throw new InvalidAttendanceRecordError("overtimeHours may not be negative");
  }

  const existing = await deps.records.findByEmployeeAndDate(cmd.employeeId, cmd.date);
  const now = cmd.now?.() ?? new Date().toISOString();
  const record: AttendanceRecord = {
    id: existing?.id ?? cmd.id,
    employeeId: cmd.employeeId,
    date: cmd.date,
    status: cmd.status,
    overtimeHours,
    notes: cmd.notes ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await deps.records.save(record);
  return record;
}
