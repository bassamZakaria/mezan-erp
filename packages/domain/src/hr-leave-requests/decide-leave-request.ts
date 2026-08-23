import { decide, type ApprovalRequest, type DecisionKind } from "../workflow/index.js";
import {
  LeaveApplicationNotFoundError,
  LeaveApplicationNotPendingError,
  statusFromApproval,
  type LeaveApplication,
  type LeaveApplicationRepository,
} from "./leave-request.js";

export interface DecideLeaveApplicationCommand {
  readonly id: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  /** This module only ever surfaces the two terminal decisions the catalog names (موافق/مرفوض) — never `request_modification`, which the generic workflow engine supports but no leave-request UI here exposes. */
  readonly decision: Extract<DecisionKind, "approve" | "reject">;
  readonly comment?: string;
  readonly now?: () => string;
}

export interface DecideLeaveApplicationDeps {
  readonly requests: LeaveApplicationRepository;
}

function toApprovalRequest(request: LeaveApplication): ApprovalRequest {
  return {
    id: request.workflowRequestId,
    actionType: request.gateActionType,
    submittedBy: request.submittedBy,
    steps: request.steps,
    currentStep: request.currentStepIndex,
    status: "pending",
    decisions: request.decisions,
  };
}

/** Records an approve/reject decision on a PENDING leave request's current gate step, via the real workflow engine's `decide()`. */
export async function decideLeaveApplication(
  cmd: DecideLeaveApplicationCommand,
  deps: DecideLeaveApplicationDeps,
): Promise<LeaveApplication> {
  const request = await deps.requests.findById(cmd.id);
  if (!request) throw new LeaveApplicationNotFoundError(cmd.id);
  if (request.status !== "PENDING") throw new LeaveApplicationNotPendingError(cmd.id, request.status);

  const now = cmd.now?.() ?? new Date().toISOString();
  const { request: approval } = decide(toApprovalRequest(request), {
    actorId: cmd.actorId,
    actorRoles: cmd.actorRoles,
    decision: cmd.decision,
    comment: cmd.comment,
    at: Date.parse(now),
  });

  const status = statusFromApproval(approval.status);
  const updated: LeaveApplication = {
    ...request,
    status,
    currentStepIndex: approval.currentStep,
    decisions: approval.decisions,
    decidedAt: status === "PENDING" ? request.decidedAt : now,
  };
  await deps.requests.update(updated);
  return updated;
}
