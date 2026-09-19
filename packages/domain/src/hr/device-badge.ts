import type { Employee } from "./employee.js";
import { DuplicateDeviceBadgeError } from "./errors.js";

export function normalizeDeviceBadgeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The attendance import matches punches to employees by badge, so two holders would silently split one person's day. */
export function assertDeviceBadgeAvailable(
  deviceBadgeId: string | null | undefined,
  employeeId: string | null,
  employees: readonly Pick<Employee, "id" | "code" | "deviceBadgeId">[],
): void {
  const badge = normalizeDeviceBadgeId(deviceBadgeId);
  if (badge === null) return;
  const holder = employees.find((e) => e.id !== employeeId && normalizeDeviceBadgeId(e.deviceBadgeId) === badge);
  if (holder) throw new DuplicateDeviceBadgeError(badge, holder.code);
}
