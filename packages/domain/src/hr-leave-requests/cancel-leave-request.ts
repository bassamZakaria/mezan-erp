import {
  LeaveApplicationNotFoundError,
  LeaveApplicationNotPendingError,
  type LeaveApplication,
  type LeaveApplicationRepository,
} from "./leave-request.js";

export interface CancelLeaveApplicationCommand {
  readonly id: string;
  readonly now?: () => string;
}

export interface CancelLeaveApplicationDeps {
  readonly requests: LeaveApplicationRepository;
}

/** Cancels a PENDING leave request (بانتظار الموافقة → ملغى). Only the submitter's own still-pending request may be cancelled — an already-decided request is final. */
export async function cancelLeaveApplication(
  cmd: CancelLeaveApplicationCommand,
  deps: CancelLeaveApplicationDeps,
): Promise<LeaveApplication> {
  const request = await deps.requests.findById(cmd.id);
  if (!request) throw new LeaveApplicationNotFoundError(cmd.id);
  if (request.status !== "PENDING") throw new LeaveApplicationNotPendingError(cmd.id, request.status);

  const updated: LeaveApplication = {
    ...request,
    status: "CANCELLED",
    decidedAt: cmd.now?.() ?? new Date().toISOString(),
  };
  await deps.requests.update(updated);
  return updated;
}
