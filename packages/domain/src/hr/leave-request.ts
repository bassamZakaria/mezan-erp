import { InvalidLeaveRequestError, InvalidLeaveRequestTransitionError } from "./errors.js";

/**
 * LeaveRequest — the minimal slice of docs/catalog/06-crm-hr.md "طلبات
 * الإجازات" needed to back إجازاتي (My Leave, employee self-service — this
 * build's actual scope). A simplified 3-type leave taxonomy (annual/sick/
 * personal, matching `Contract.leaveEntitlement`'s override fields) stands
 * in for the full leave-policy-driven type catalog (`hr.leave_policy.*`,
 * deferred — docs/deferred-plan.md HR-3 #14/15).
 */

export type LeaveType = "annual" | "sick" | "personal";
export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveTypeDefinition {
  readonly code: LeaveType;
  readonly labelAr: string;
}

export const LEAVE_TYPE_DEFINITIONS: readonly LeaveTypeDefinition[] = [
  { code: "annual", labelAr: "إجازة سنوية" },
  { code: "sick", labelAr: "إجازة مرضية" },
  { code: "personal", labelAr: "إجازة شخصية" },
] as const;

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

/** Creates and persists a new leave request. New requests always start "pending" (docs/catalog/06 approval workflow). */
export async function createLeaveRequest(command: CreateLeaveRequestCommand, repo: LeaveRequestRepository): Promise<LeaveRequest> {
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

/** docs/catalog/06 "طلبات الإجازات" workflow: بانتظار الموافقة → موافق عليه/مرفوض/ملغى; موافق عليه → ملغى; both مرفوض/ملغى are terminal. */
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
