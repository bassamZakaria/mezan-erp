import type { GateableActionType } from "../workflow/action-types.js";
import { InvalidLeaveRequestError, InvalidLeaveRequestTransitionError } from "./errors.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

/**
 * LeaveRequest — docs/archive/catalog/06-crm-hr.md "طلبات الإجازات". The leave-type
 * taxonomy is the 8 types the workflow catalog's 9 granular leave gates name
 * (docs/archive/catalog/09 §سير العمل — HR_LEAVE_APPROVE_* minus the "all types"
 * catch-all), so every type maps 1:1 onto its own gateable action type.
 */

export type LeaveType = "annual" | "sick" | "personal" | "casual" | "maternity" | "paternity" | "unpaid" | "emergency";
export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveTypeDefinition {
  readonly code: LeaveType;
  readonly labelAr: string;
  /** The per-type approval gate a tenant may configure a chain on. */
  readonly gateActionType: GateableActionType;
}

export const LEAVE_TYPE_DEFINITIONS: readonly LeaveTypeDefinition[] = [
  { code: "annual", labelAr: "إجازة سنوية", gateActionType: "HR_LEAVE_APPROVE_ANNUAL" },
  { code: "sick", labelAr: "إجازة مرضية", gateActionType: "HR_LEAVE_APPROVE_SICK" },
  { code: "personal", labelAr: "إجازة شخصية", gateActionType: "HR_LEAVE_APPROVE_PERSONAL" },
  { code: "casual", labelAr: "إجازة عارضة", gateActionType: "HR_LEAVE_APPROVE_CASUAL" },
  { code: "maternity", labelAr: "إجازة أمومة", gateActionType: "HR_LEAVE_APPROVE_MATERNITY" },
  { code: "paternity", labelAr: "إجازة أبوة", gateActionType: "HR_LEAVE_APPROVE_PATERNITY" },
  { code: "unpaid", labelAr: "إجازة بدون أجر", gateActionType: "HR_LEAVE_APPROVE_UNPAID" },
  { code: "emergency", labelAr: "إجازة طارئة", gateActionType: "HR_LEAVE_APPROVE_EMERGENCY" },
] as const;

/** The gate a tenant configures for this leave type; `HR_LEAVE_APPROVE_ALL` is the cross-type fallback. */
export function leaveApprovalActionType(leaveType: LeaveType): GateableActionType {
  return LEAVE_TYPE_DEFINITIONS.find((d) => d.code === leaveType)?.gateActionType ?? "HR_LEAVE_APPROVE_ALL";
}

/** Leave taken without pay — the day count payroll prorates the month's salary by. */
export function isUnpaidLeaveType(leaveType: LeaveType): boolean {
  return leaveType === "unpaid";
}

export function getLeaveTypeLabel(type: LeaveType): string {
  return LEAVE_TYPE_DEFINITIONS.find((d) => d.code === type)?.labelAr ?? type;
}

export interface LeaveRequestStatusDefinition {
  readonly code: LeaveRequestStatus;
  readonly labelAr: string;
}

export const LEAVE_REQUEST_STATUS_DEFINITIONS: readonly LeaveRequestStatusDefinition[] = [
  { code: "pending", labelAr: "بانتظار الموافقة" },
  { code: "approved", labelAr: "موافق عليه" },
  { code: "rejected", labelAr: "مرفوض" },
  { code: "cancelled", labelAr: "ملغى" },
] as const;

export function getLeaveRequestStatusLabel(status: LeaveRequestStatus): string {
  return LEAVE_REQUEST_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface LeaveRequest {
  readonly id: string;
  /** LR-###### numbering-engine number. */
  readonly number: string;
  readonly employeeId: string;
  readonly leaveType: LeaveType;
  readonly halfDay: boolean;
  readonly startDate: string;
  readonly endDate: string;
  /** Computed at create time: 0.5 when `halfDay`, otherwise the inclusive calendar-day count. */
  readonly days: number;
  readonly reason: string | null;
  readonly status: LeaveRequestStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

/** Persistence port for leave requests. The domain depends on this interface only. */
export interface LeaveRequestRepository {
  findById(id: string): Promise<LeaveRequest | null>;
  list(): Promise<LeaveRequest[]>;
  listByEmployeeId(employeeId: string): Promise<LeaveRequest[]>;
  create(request: LeaveRequest): Promise<void>;
  update(request: LeaveRequest): Promise<void>;
}

/** Inclusive day count between two "YYYY-MM-DD" dates. */
function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

export interface CreateLeaveRequestCommand {
  readonly id: string;
  /** LR-###### — assigned by the caller via the numbering engine before invoking this command. */
  readonly number: string;
  readonly employeeId: string;
  readonly leaveType: LeaveType;
  readonly halfDay?: boolean;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason?: string | null;
}

function validate(command: Pick<CreateLeaveRequestCommand, "employeeId" | "startDate" | "endDate">): string[] {
  const reasons: string[] = [];
  if (command.employeeId.trim().length === 0) reasons.push("الموظف مطلوب");
  if (command.startDate.trim().length === 0) reasons.push("تاريخ البداية مطلوب");
  if (command.endDate.trim().length === 0) reasons.push("تاريخ النهاية مطلوب");
  if (command.startDate && command.endDate && command.endDate < command.startDate) {
    reasons.push("تاريخ النهاية لا يمكن أن يسبق تاريخ البداية");
  }
  return reasons;
}

/** Creates and persists a new leave request. New requests always start "pending" (docs/archive/catalog/06 approval workflow). */
export async function createLeaveRequest(command: CreateLeaveRequestCommand, repo: LeaveRequestRepository): Promise<LeaveRequest> {
  assertRecordIdIsNew(await repo.findById(command.id), command.id);
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidLeaveRequestError(reasons);

  const halfDay = command.halfDay ?? false;
  const request: LeaveRequest = {
    id: command.id,
    number: command.number,
    employeeId: command.employeeId,
    leaveType: command.leaveType,
    halfDay,
    startDate: command.startDate,
    endDate: command.endDate,
    days: halfDay ? 0.5 : inclusiveDayCount(command.startDate, command.endDate),
    reason: command.reason ?? null,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
  };

  await repo.create(request);
  return request;
}

/** docs/archive/catalog/06 "طلبات الإجازات" workflow: بانتظار الموافقة → موافق عليه/مرفوض/ملغى; موافق عليه → ملغى; both مرفوض/ملغى are terminal. */
export const ALLOWED_LEAVE_REQUEST_TRANSITIONS: Record<LeaveRequestStatus, readonly LeaveRequestStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: ["cancelled"],
  rejected: [],
  cancelled: [],
};

export function canTransitionLeaveRequest(from: LeaveRequestStatus, to: LeaveRequestStatus): boolean {
  return ALLOWED_LEAVE_REQUEST_TRANSITIONS[from].includes(to);
}

/** Approves or rejects a pending leave request. */
export function decideLeaveRequest(request: LeaveRequest, decision: "approved" | "rejected", decidedBy: string): LeaveRequest {
  if (!canTransitionLeaveRequest(request.status, decision)) {
    throw new InvalidLeaveRequestTransitionError(request.status, decision);
  }
  return { ...request, status: decision, decidedAt: new Date().toISOString(), decidedBy };
}

/** Cancels a pending or approved leave request (self-service "طلب إجازة" cancel). */
export function cancelLeaveRequest(request: LeaveRequest): LeaveRequest {
  if (!canTransitionLeaveRequest(request.status, "cancelled")) {
    throw new InvalidLeaveRequestTransitionError(request.status, "cancelled");
  }
  return { ...request, status: "cancelled" };
}

export interface LeaveRequestFilter {
  readonly employeeId?: string | null;
  readonly status?: LeaveRequestStatus | null;
  readonly leaveType?: LeaveType | null;
  /** Overlap window: keeps requests whose period intersects [from, to]. */
  readonly from?: string | null;
  readonly to?: string | null;
}

/** Applies the admin list's filter panel (employee / status / type / date range) to a request set. */
export function filterLeaveRequests(requests: readonly LeaveRequest[], filter: LeaveRequestFilter): LeaveRequest[] {
  return requests.filter((r) => {
    if (filter.employeeId && r.employeeId !== filter.employeeId) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (filter.leaveType && r.leaveType !== filter.leaveType) return false;
    if (filter.from && r.endDate < filter.from) return false;
    if (filter.to && r.startDate > filter.to) return false;
    return true;
  });
}

/** True when an approved leave request covers `date` ("YYYY-MM-DD") — the attendance grid's "L" day. */
export function isOnApprovedLeave(requests: readonly LeaveRequest[], employeeId: string, date: string): boolean {
  return requests.some((r) => r.status === "approved" && r.employeeId === employeeId && r.startDate <= date && date <= r.endDate);
}
