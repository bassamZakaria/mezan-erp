/** Workflow gate core — gateable action types, typed events, approval engine. */

export {
  GATEABLE_ACTION_TYPES,
  actionTypeLabels,
  isGateableActionType,
  type GateableActionType,
  type GateableActionTypeDef,
} from "./action-types.js";

export type { WorkflowEvent, WorkflowEventType } from "./events.js";

export {
  startApproval,
  decide,
  resubmit,
  reopenForModification,
  WorkflowError,
  wrongApproverMessages,
  APPROVAL_STATUS_LABELS,
  type RoleLabel,
  type WorkflowErrorDetail,
  type GateStep,
  type GateConfig,
  type ApprovalRequest,
  ApprovalStatusCode,
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
  reopenApprovalForModification,
  ApprovalRequestNotFoundError,
  ApprovalRequestRejectedError,
  ApprovalRequestUntrustedError,
  ApprovalRequestReapprovalRequiredError,
  REAPPROVAL_REQUIRED_REASON_AR,
  REAPPROVAL_REQUIRED_REASON_EN,
  type ApprovalSubject,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
  type SubmitApprovalCommand,
} from "./requests.js";

export { documentFingerprint, sha256Hex } from "./fingerprint.js";
