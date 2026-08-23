import { startApproval, type GateConfig, type GateableActionType } from "../workflow/index.js";
import type { NextNumberService } from "../numbering/index.js";
import { isLeaveTypeCode, gateActionTypeForLeaveType, type LeaveTypeCode } from "../hr-leave-policies/index.js";
import { computeLeaveDays } from "./compute-days.js";
import {
  statusFromApproval,
  InvalidLeaveApplicationError,
  type LeaveApplication,
  type LeaveApplicationRepository,
} from "./leave-request.js";

/** Resolves the configured approval chain for a gate action type, or null when the tenant has none configured (grants immediately — same "no steps = no hold" rule as `documents/journal-document.ts`'s `createDocumentWorkflowGate`). */
export type LeaveGateConfigResolver = (actionType: GateableActionType) => GateConfig | null;

/**
 * Role required by the default single-step approval chain — used until a
 * tenant configures its own chain via `/settings/workflow` (out of this
 * module's scope; that generic config screen doesn't exist anywhere in the
 * codebase yet, matching `packages/backend/src/create-backend.ts`'s existing
 * `createDocumentWorkflowGate(() => null)` "no config yet" wiring for every
 * OTHER gated document type). Data, not hardcoded logic — a composition root
 * is free to inject a different resolver instead.
 */
export const DEFAULT_LEAVE_GATE_ROLE = "hr_manager";

/** Every leave request requires one `DEFAULT_LEAVE_GATE_ROLE` approval, so a leave request genuinely holds بانتظار الموافقة by default rather than always auto-granting. */
export const defaultLeaveGateConfigResolver: LeaveGateConfigResolver = (actionType) => ({
  actionType,
  steps: [{ role: DEFAULT_LEAVE_GATE_ROLE, description: "الموافقة على طلبات الإجازات" }],
});

export interface SubmitLeaveApplicationCommand {
  readonly id: string;
  readonly employeeId: string;
  readonly leaveTypeCode: LeaveTypeCode | string;
  readonly startDate: string;
  readonly endDate: string;
  readonly halfDay?: boolean;
  readonly reason?: string | null;
  readonly submittedBy: string;
  readonly submitterRoles?: readonly string[];
  readonly now?: () => string;
}

export interface SubmitLeaveApplicationDeps {
  readonly requests: LeaveApplicationRepository;
  readonly numbering: NextNumberService;
  readonly weekendDays: readonly number[];
  readonly resolveGateConfig: LeaveGateConfigResolver;
}

/**
 * Submits a leave request: validates dates/type, computes the day count,
 * allocates its `LR-######` number, and starts the approval flow through the
 * REAL workflow engine on the leave type's specific gate
 * (`HR_LEAVE_APPROVE_<TYPE>`) — بانتظار الموافقة unless the configured chain
 * grants immediately (no steps, or an admin submitter).
 */
export async function submitLeaveApplication(
  cmd: SubmitLeaveApplicationCommand,
  deps: SubmitLeaveApplicationDeps,
): Promise<LeaveApplication> {
  if (cmd.employeeId.trim() === "") {
    throw new InvalidLeaveApplicationError("employeeId is required");
  }
  if (!isLeaveTypeCode(cmd.leaveTypeCode)) {
    throw new InvalidLeaveApplicationError(`Unknown leave type code: "${cmd.leaveTypeCode}"`);
  }

  const halfDay = cmd.halfDay ?? false;
  const days = computeLeaveDays(cmd.startDate, cmd.endDate, halfDay, deps.weekendDays);
  if (days <= 0) {
    throw new InvalidLeaveApplicationError("The requested period contains no payable leave days (all weekly-off)");
  }

  const gateActionType = gateActionTypeForLeaveType(cmd.leaveTypeCode);
  const config = deps.resolveGateConfig(gateActionType) ?? { actionType: gateActionType, steps: [] };
  const now = cmd.now?.() ?? new Date().toISOString();
  const { request: approval } = startApproval(config, {
    requestId: cmd.id,
    submittedBy: cmd.submittedBy,
    submitterRoles: cmd.submitterRoles,
    at: Date.parse(now),
  });

  const { formatted } = await deps.numbering.next("LEAVE_REQUEST");

  const status = statusFromApproval(approval.status);
  const request: LeaveApplication = {
    id: cmd.id,
    requestNo: formatted,
    employeeId: cmd.employeeId,
    leaveTypeCode: cmd.leaveTypeCode,
    startDate: cmd.startDate,
    endDate: cmd.endDate,
    halfDay,
    days,
    reason: cmd.reason ?? null,
    status,
    gateActionType,
    workflowRequestId: approval.id,
    steps: approval.steps,
    currentStepIndex: approval.currentStep,
    decisions: approval.decisions,
    submittedBy: cmd.submittedBy,
    createdAt: now,
    decidedAt: status === "PENDING" ? null : now,
  };
  await deps.requests.create(request);
  return request;
}
