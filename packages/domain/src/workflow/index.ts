/** Workflow gate core — gateable action types, typed events, approval engine. */

export {
  GATEABLE_ACTION_TYPES,
  isGateableActionType,
  type GateableActionType,
  type GateableActionTypeDef,
} from "./action-types.js";

export type { WorkflowEvent, WorkflowEventType } from "./events.js";

export {
  startApproval,
  decide,
  resubmit,
  WorkflowError,
  type GateStep,
  type GateConfig,
  type ApprovalRequest,
  type ApprovalStatus,
  type DecisionKind,
  type DecisionRecord,
  type StartInput,
  type DecisionInput,
  type Transition,
} from "./gate.js";
