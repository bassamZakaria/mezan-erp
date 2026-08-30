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

export {
  saveWorkflowConfig,
  deleteWorkflowConfig,
  UnknownActionTypeError,
  EmptyStepsError,
  InvalidStepRoleError,
  UnknownStepRoleError,
  DuplicateWorkflowConfigError,
  WorkflowConfigNotFoundError,
  type ApproverRoleResolver,
  type WorkflowConfigRecord,
  type WorkflowConfigRepository,
  type SaveWorkflowConfigCommand,
} from "./config.js";

export {
  submitApproval,
  decideApproval,
  resubmitApproval,
  ApprovalRequestNotFoundError,
  ApprovalRequestRejectedError,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
  type SubmitApprovalCommand,
} from "./requests.js";
