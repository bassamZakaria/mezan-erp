import {
  LeaveRequestNotFoundError,
  LeaveRequestNotPendingError,
  type LeaveRequest,
  type LeaveRequestRepository,
} from "./leave-request.js";

export interface CancelLeaveRequestCommand {
  readonly id: string;
  readonly now?: () => string;
}

export interface CancelLeaveRequestDeps {
  readonly requests: LeaveRequestRepository;
}

/** Cancels a PENDING leave request (بانتظار الموافقة → ملغى). Only the submitter's own still-pending request may be cancelled — an already-decided request is final. */
export async function cancelLeaveRequest(
  cmd: CancelLeaveRequestCommand,
  deps: CancelLeaveRequestDeps,
): Promise<LeaveRequest> {
  const request = await deps.requests.findById(cmd.id);
  if (!request) throw new LeaveRequestNotFoundError(cmd.id);
  if (request.status !== "PENDING") throw new LeaveRequestNotPendingError(cmd.id, request.status);

  const updated: LeaveRequest = {
    ...request,
    status: "CANCELLED",
    decidedAt: cmd.now?.() ?? new Date().toISOString(),
  };
  await deps.requests.update(updated);
  return updated;
}
