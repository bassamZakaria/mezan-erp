import type { PillTone } from "@mezan/ui";
import type { AppTranslationKey } from "../i18n";
import type { AttendanceStatusDTO, LeaveAccrualFrequencyDTO, LeaveRequestStatusDTO, LeaveTypeDTO } from "@mezan/contracts";

/**
 * Shared catalogue KEYS for the HR leave/attendance screens (docs/catalog/06
 * §"الموارد البشرية"). Six screens read from here, so the vocabulary is stated
 * once and each screen translates at render.
 */

export const LEAVE_TYPE_KEY: Record<LeaveTypeDTO, AppTranslationKey> = {
  annual: "leaveType.annual",
  sick: "leaveType.sick",
  personal: "leaveType.personal",
  casual: "leaveType.casual",
  maternity: "leaveType.maternity",
  paternity: "leaveType.paternity",
  unpaid: "leaveType.unpaid",
  emergency: "leaveType.emergency",
};

export const LEAVE_TYPE_CODES = Object.keys(LEAVE_TYPE_KEY) as LeaveTypeDTO[];

export function leaveTypeOptions(t: (key: AppTranslationKey) => string) {
  return LEAVE_TYPE_CODES.map((code) => ({ value: code, label: t(LEAVE_TYPE_KEY[code]) }));
}

export const LEAVE_STATUS_KEY: Record<LeaveRequestStatusDTO, AppTranslationKey> = {
  pending: "leaveStatus.pending",
  approved: "leaveStatus.approved",
  rejected: "leaveStatus.rejected",
  cancelled: "leaveStatus.cancelled",
};

export const LEAVE_STATUS_TONE: Record<LeaveRequestStatusDTO, PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const ATTENDANCE_STATUS_KEY: Record<AttendanceStatusDTO, AppTranslationKey> = {
  present: "attendanceStatus.present",
  late: "attendanceStatus.late",
  half_day: "attendanceStatus.half_day",
  absent: "attendanceStatus.absent",
  on_leave: "attendanceStatus.on_leave",
  holiday: "attendanceStatus.holiday",
  weekly_off: "attendanceStatus.weekly_off",
};

export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatusDTO, PillTone> = {
  present: "success",
  late: "warning",
  half_day: "warning",
  absent: "danger",
  on_leave: "info",
  holiday: "info",
  weekly_off: "neutral",
};

export const ACCRUAL_FREQUENCY_KEY: Record<LeaveAccrualFrequencyDTO, AppTranslationKey> = {
  annual: "accrualFrequency.annual",
  monthly: "accrualFrequency.monthly",
  none: "accrualFrequency.none",
};

/** Trims `Qty`'s fixed six-decimal wire form down to what a matrix cell should read. */
export function formatDays(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

export function formatWorkedDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}
