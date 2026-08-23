import type { GateStep, DecisionRecord, ApprovalStatus, GateableActionType } from "../workflow/index.js";
import type { LeaveTypeCode } from "../hr-leave-policies/index.js";

/**
 * طلبات الإجازات — Leave Requests (docs/catalog "طلبات الإجازات"): request →
 * approval via one of the workflow engine's 9 granular per-leave-type gates
 * (`HR_LEAVE_APPROVE_<TYPE>`) → بانتظار → موافق/مرفوض/ملغى.
 *
 * The approval chain itself (`steps`/`currentStepIndex`/`decisions`) is the
 * SAME shape `workflow/gate.ts`'s `ApprovalRequest` produces — this record just
 * persists that state alongside the leave-specific fields, mirroring how
 * `documents/journal-document.ts` binds the workflow engine behind a hook
 * without this module depending on the (financial-document-shaped) document
 * framework it lives in.
 */
export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequest {
  readonly id: string;
  readonly requestNo: string;
  readonly employeeId: string;
  readonly leaveTypeCode: LeaveTypeCode;
  /** ISO date (YYYY-MM-DD). */
  readonly startDate: string;
  readonly endDate: string;
  readonly halfDay: boolean;
  /** Computed day count — 0.5 for a half-day request, else business days in [startDate, endDate] excluding weekly-off. */
  readonly days: number;
  readonly reason: string | null;
  readonly status: LeaveRequestStatus;
  readonly gateActionType: GateableActionType;
  readonly workflowRequestId: string;
  readonly steps: readonly GateStep[];
  readonly currentStepIndex: number;
  readonly decisions: readonly DecisionRecord[];
  readonly submittedBy: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** Persistence port for leave requests. The domain depends on this interface only — no SQL, no driver. */
export interface LeaveRequestRepository {
  findById(id: string): Promise<LeaveRequest | null>;
  list(filter?: {
    readonly employeeId?: string;
    readonly status?: LeaveRequestStatus;
    readonly leaveTypeCode?: LeaveTypeCode;
  }): Promise<LeaveRequest[]>;
  create(request: LeaveRequest): Promise<void>;
  update(request: LeaveRequest): Promise<void>;
}

export class LeaveRequestNotFoundError extends Error {
  readonly code = "LEAVE_REQUEST_NOT_FOUND";
  constructor(id: string) {
    super(`Leave request "${id}" not found`);
    this.name = "LeaveRequestNotFoundError";
  }
}

export class InvalidLeaveRequestError extends Error {
  readonly code = "INVALID_LEAVE_REQUEST";
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeaveRequestError";
  }
}

export class LeaveRequestNotPendingError extends Error {
  readonly code = "LEAVE_REQUEST_NOT_PENDING";
  constructor(id: string, status: LeaveRequestStatus) {
    super(`Leave request "${id}" is ${status}, not PENDING`);
    this.name = "LeaveRequestNotPendingError";
  }
}

/** Maps a workflow `ApprovalStatus` onto the leave request's own status vocabulary. */
export function statusFromApproval(approval: ApprovalStatus): LeaveRequestStatus {
  switch (approval) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    default:
      return "PENDING";
  }
}
