/**
 * Workflow gate — a pure, sequential, role-based approval state machine
 * (docs/archive/catalog/09 §workflow config).
 *
 * A gate config for an action type is an ordered list of steps, each naming an
 * approver ROLE (not a user — recon constraint). A submitted request walks the
 * steps in order: each `approve` advances to the next step; the last approval
 * grants; a `reject` terminates; a `request_modification` bounces the request
 * back to the submitter, who may `resubmit` (restarting the chain). A tenant
 * admin (holding the `"*"` role) bypasses gating entirely.
 *
 * Everything here is a pure function returning new immutable state plus the
 * events to emit. No persistence, no I/O — those are the adapter's job (ports).
 */

import { WILDCARD_PERMISSION } from "../permissions/catalog.js";
import type { GateableActionType } from "./action-types.js";
import type { WorkflowEvent } from "./events.js";

export interface GateStep {
  /** Approver role required to act on this step. */
  readonly role: string;
  readonly description?: string;
}

export interface GateConfig {
  readonly actionType: GateableActionType;
  readonly steps: readonly GateStep[];
}

export enum ApprovalStatusCode {
  Pending = "pending",
  Approved = "approved",
  Rejected = "rejected",
  ModificationRequested = "modification_requested",
}

export type ApprovalStatus = `${ApprovalStatusCode}`;

export type DecisionKind = "approve" | "reject" | "request_modification";

export interface ApprovalRequest {
  readonly id: string;
  readonly actionType: GateableActionType;
  readonly submittedBy: string;
  readonly steps: readonly GateStep[];
  /** Index of the step awaiting a decision (valid while `status === "pending"`). */
  readonly currentStep: number;
  readonly status: ApprovalStatus;
  readonly decisions: readonly DecisionRecord[];
}

export interface DecisionRecord {
  readonly stepIndex: number;
  readonly kind: DecisionKind | "bypass";
  readonly actorId: string;
  readonly comment?: string;
  readonly at?: number;
}

export interface StartInput {
  readonly requestId: string;
  readonly submittedBy: string;
  /** Roles held by the submitter — used only for the admin (`"*"`) bypass. */
  readonly submitterRoles?: readonly string[];
  readonly at?: number;
}

export interface DecisionInput {
  readonly actorId: string;
  /** Roles held by the acting user. `"*"` grants an admin bypass. */
  readonly actorRoles: readonly string[];
  readonly decision: DecisionKind;
  readonly comment?: string;
  readonly at?: number;
}

export interface Transition {
  readonly request: ApprovalRequest;
  readonly events: readonly WorkflowEvent[];
}

export class WorkflowError extends Error {
  constructor(
    readonly code:
      | "NOT_PENDING"
      | "WRONG_APPROVER"
      | "SELF_APPROVAL"
      | "NOT_MODIFIABLE"
      | "EMPTY_ACTION_TYPE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

function hasAdminRole(roles: readonly string[] | undefined): boolean {
  return roles?.includes(WILDCARD_PERMISSION) ?? false;
}

/**
 * Begins an approval flow for a submitted action.
 *
 * - Admin submitter (`"*"`): bypasses the gate, request is immediately approved.
 * - No configured steps: nothing to approve, immediately granted.
 * - Otherwise: request enters `pending` at step 0 and a REQUESTED event is
 *   emitted naming the first step's approver role.
 */
export function startApproval(
  config: GateConfig,
  input: StartInput,
): Transition {
  const base: Omit<ApprovalRequest, "currentStep" | "status" | "decisions"> = {
    id: input.requestId,
    actionType: config.actionType,
    submittedBy: input.submittedBy,
    steps: config.steps,
  };

  if (hasAdminRole(input.submitterRoles) || config.steps.length === 0) {
    const request: ApprovalRequest = {
      ...base,
      currentStep: config.steps.length,
      status: "approved",
      decisions: hasAdminRole(input.submitterRoles)
        ? [
            {
              stepIndex: 0,
              kind: "bypass",
              actorId: input.submittedBy,
              at: input.at,
            },
          ]
        : [],
    };
    return {
      request,
      events: [
        event("WORKFLOW_APPROVAL_GRANTED", request, {
          stepIndex: request.currentStep,
          actorId: input.submittedBy,
          at: input.at,
        }),
      ],
    };
  }

  const request: ApprovalRequest = {
    ...base,
    currentStep: 0,
    status: "pending",
    decisions: [],
  };
  return {
    request,
    events: [
      event("WORKFLOW_APPROVAL_REQUESTED", request, {
        stepIndex: 0,
        role: config.steps[0]?.role,
        at: input.at,
      }),
    ],
  };
}

/**
 * Records a decision on the current step.
 *
 * - Admin actor (`"*"`): may act on any step; an approve grants the whole
 *   request, a reject rejects it, a modification request bounces it.
 * - Non-admin: must hold the current step's role, else `WRONG_APPROVER`.
 * - approve (non-final): advance, emit REQUESTED for the next approver.
 * - approve (final): grant, emit GRANTED.
 * - reject: terminate, emit REJECTED.
 * - request_modification: return to submitter, emit MODIFICATION_REQUESTED.
 */
export function decide(
  request: ApprovalRequest,
  input: DecisionInput,
): Transition {
  if (request.status !== "pending") {
    throw new WorkflowError(
      "NOT_PENDING",
      `Request ${request.id} is ${request.status}, not pending`,
    );
  }

  /**
   * فصل المهام — segregation of duties. The person who raised the request may
   * never be the person who decides it, and the ADMIN BYPASS DOES NOT LIFT
   * THIS: a bypass is a shortcut past the role a step names, not past the
   * separation the step exists for. One user holding both the permission and
   * the step role was otherwise able to create and approve the same payment,
   * which no amount of configuration could prevent.
   *
   * `startApproval` already grants an admin submitter's own request outright,
   * so a pending request was raised by someone who needed approval. A
   * self-decision here is therefore always the thing this check is for.
   *
   * Rejecting and requesting modification are covered too. A submitter who can
   * withdraw their own request by "rejecting" it is a smaller hole than
   * self-approval, but it is the same hole: the decision log would name them as
   * the approver of their own document.
   */
  if (input.actorId === request.submittedBy) {
    // Arabic, because this message reaches the approvals inbox verbatim.
    throw new WorkflowError(
      "SELF_APPROVAL",
      "لا يمكن لمن قدّم الطلب أن يبتّ فيه — يلزم شخص آخر للموافقة أو الرفض.",
    );
  }

  const step = request.steps[request.currentStep];
  const admin = hasAdminRole(input.actorRoles);

  // An admin bypasses the ROLE check on every step, but never the decision
  // itself: an admin rejecting someone else's request must reject it. Only an
  // admin *approval* short-circuits the remaining steps.
  if (admin && input.decision === "approve") {
    const decisions = appendDecision(request, {
      stepIndex: request.currentStep,
      kind: "bypass",
      actorId: input.actorId,
      comment: input.comment,
      at: input.at,
    });
    const next: ApprovalRequest = {
      ...request,
      status: "approved",
      currentStep: request.steps.length,
      decisions,
    };
    return {
      request: next,
      events: [
        event("WORKFLOW_APPROVAL_GRANTED", next, {
          stepIndex: request.currentStep,
          actorId: input.actorId,
          comment: input.comment,
          at: input.at,
        }),
      ],
    };
  }

  if (!admin && (!step || !input.actorRoles.includes(step.role))) {
    throw new WorkflowError(
      "WRONG_APPROVER",
      `Actor ${input.actorId} may not act on step ${request.currentStep} ` +
        `(requires role ${step?.role ?? "<none>"})`,
    );
  }

  const decisions = appendDecision(request, {
    stepIndex: request.currentStep,
    kind: input.decision,
    actorId: input.actorId,
    comment: input.comment,
    at: input.at,
  });

  if (input.decision === "reject") {
    const next: ApprovalRequest = { ...request, status: "rejected", decisions };
    return {
      request: next,
      events: [
        event("WORKFLOW_APPROVAL_REJECTED", next, {
          stepIndex: request.currentStep,
          role: step?.role,
          actorId: input.actorId,
          comment: input.comment,
          at: input.at,
        }),
      ],
    };
  }

  if (input.decision === "request_modification") {
    const next: ApprovalRequest = {
      ...request,
      status: "modification_requested",
      decisions,
    };
    return {
      request: next,
      events: [
        event("WORKFLOW_MODIFICATION_REQUESTED", next, {
          stepIndex: request.currentStep,
          role: step?.role,
          actorId: input.actorId,
          comment: input.comment,
          at: input.at,
        }),
      ],
    };
  }

  // approve
  const isFinal = request.currentStep >= request.steps.length - 1;
  if (isFinal) {
    const next: ApprovalRequest = {
      ...request,
      status: "approved",
      currentStep: request.steps.length,
      decisions,
    };
    return {
      request: next,
      events: [
        event("WORKFLOW_APPROVAL_GRANTED", next, {
          stepIndex: request.currentStep,
          role: step?.role,
          actorId: input.actorId,
          comment: input.comment,
          at: input.at,
        }),
      ],
    };
  }

  const nextStep = request.currentStep + 1;
  const next: ApprovalRequest = { ...request, currentStep: nextStep, decisions };
  return {
    request: next,
    events: [
      event("WORKFLOW_APPROVAL_REQUESTED", next, {
        stepIndex: nextStep,
        role: request.steps[nextStep]?.role,
        actorId: input.actorId,
        comment: input.comment,
        at: input.at,
      }),
    ],
  };
}

/**
 * Re-submits a request that came back as `modification_requested`, restarting
 * the chain from step 0. Any other status is a programming error.
 */
export function resubmit(
  request: ApprovalRequest,
  input: { submittedBy?: string; at?: number } = {},
): Transition {
  if (request.status !== "modification_requested") {
    throw new WorkflowError(
      "NOT_MODIFIABLE",
      `Request ${request.id} is ${request.status}; only ` +
        `modification_requested requests can be resubmitted`,
    );
  }
  const next: ApprovalRequest = {
    ...request,
    submittedBy: input.submittedBy ?? request.submittedBy,
    status: "pending",
    currentStep: 0,
  };
  return {
    request: next,
    events: [
      event("WORKFLOW_APPROVAL_REQUESTED", next, {
        stepIndex: 0,
        role: request.steps[0]?.role,
        at: input.at,
      }),
    ],
  };
}

export function reopenForModification(request: ApprovalRequest): ApprovalRequest | null {
  if (request.status !== "rejected" && request.status !== "approved") return null;
  return { ...request, status: "modification_requested" };
}

function appendDecision(
  request: ApprovalRequest,
  record: DecisionRecord,
): readonly DecisionRecord[] {
  return [...request.decisions, record];
}

function event(
  type: WorkflowEvent["type"],
  request: ApprovalRequest,
  extra: Omit<WorkflowEvent, "type" | "requestId" | "actionType">,
): WorkflowEvent {
  return {
    type,
    requestId: request.id,
    actionType: request.actionType,
    ...extra,
  };
}
