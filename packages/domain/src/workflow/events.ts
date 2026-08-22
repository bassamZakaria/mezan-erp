/**
 * Typed workflow events (docs/catalog/09 §notification rules — Workflow group).
 * The gate state machine emits these; the notification bus (§2.6) consumes them.
 */

import type { GateableActionType } from "./action-types.js";

export type WorkflowEventType =
  | "WORKFLOW_APPROVAL_REQUESTED"
  | "WORKFLOW_APPROVAL_GRANTED"
  | "WORKFLOW_APPROVAL_REJECTED"
  | "WORKFLOW_MODIFICATION_REQUESTED";

export interface WorkflowEvent {
  readonly type: WorkflowEventType;
  readonly requestId: string;
  readonly actionType: GateableActionType;
  /** Zero-based index of the step this event concerns. */
  readonly stepIndex: number;
  /** Role the step targets (the approver expected to act next), when relevant. */
  readonly role?: string;
  /** Actor who produced the decision, when relevant. */
  readonly actorId?: string;
  readonly comment?: string;
  /** Epoch ms, when the caller supplies a timestamp. */
  readonly at?: number;
}
