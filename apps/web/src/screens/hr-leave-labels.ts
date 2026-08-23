import type { PillTone } from "@mezan/ui";
import type { AttendanceStatusDTO, LeaveAccrualFrequencyDTO, LeaveRequestStatusDTO, LeaveTypeDTO } from "@mezan/contracts";

/** Shared Arabic labels for the HR leave/attendance screens (docs/catalog/06 §"الموارد البشرية"). */

export const LEAVE_TYPE_LABEL: Record<LeaveTypeDTO, string> = {
  annual: "إجازة سنوية",
  sick: "إجازة مرضية",
  personal: "إجازة شخصية",
  casual: "إجازة عارضة",
  maternity: "إجازة أمومة",
  paternity: "إجازة أبوة",
  unpaid: "إجازة بدون أجر",
  emergency: "إجازة طارئة",
};

export const LEAVE_TYPE_OPTIONS = (Object.keys(LEAVE_TYPE_LABEL) as LeaveTypeDTO[]).map((code) => ({ value: code, label: LEAVE_TYPE_LABEL[code] }));

export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatusDTO, string> = {
  pending: "بانتظار الموافقة",
  approved: "موافق عليه",
  rejected: "مرفوض",
  cancelled: "ملغى",
};

export const LEAVE_STATUS_TONE: Record<LeaveRequestStatusDTO, PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatusDTO, string> = {
  present: "حاضر",
  late: "تأخير",
  half_day: "نصف يوم",
  absent: "غائب",
  on_leave: "في إجازة",
  holiday: "إجازة رسمية",
  weekly_off: "إجازة أسبوعية",
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

export const ACCRUAL_FREQUENCY_LABEL: Record<LeaveAccrualFrequencyDTO, string> = {
  annual: "سنوياً",
  monthly: "شهرياً",
  none: "بدون استحقاق",
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
