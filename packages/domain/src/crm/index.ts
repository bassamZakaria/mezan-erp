export type {
  Lead,
  LeadRepository,
  LeadStatus,
  LeadSource,
  LeadStatusDefinition,
  LeadSourceDefinition,
} from "./lead.js";
export {
  LEAD_STATUS_DEFINITIONS,
  getLeadStatusLabel,
  LEAD_SOURCE_DEFINITIONS,
  getLeadSourceLabel,
  ALLOWED_LEAD_TRANSITIONS,
  canTransitionLead,
} from "./lead.js";
export {
  LeadNotFoundError,
  InvalidLeadError,
  InvalidLeadTransitionError,
  LeadNotConvertibleError,
  InvalidOpportunityError,
  DuplicatePipelineStageWinError,
  PipelineStageNotFoundError,
  OpportunityNotFoundError,
  ActivityNotFoundError,
  InvalidActivityError,
  ActivityNotPendingError,
} from "./errors.js";
export { createLead, type CreateLeadCommand } from "./create-lead.js";
export { transitionLead } from "./transition-lead.js";
export {
  convertLead,
  type ConvertLeadCommand,
  type ConvertLeadDeps,
  type ConvertLeadResult,
} from "./convert-lead.js";
export type { Opportunity, OpportunityRepository, OpportunityStatus } from "./opportunity.js";
export { createOpportunity, type CreateOpportunityCommand } from "./opportunity.js";
export { moveOpportunityStage } from "./move-opportunity-stage.js";
export type { PipelineStage, PipelineStageRepository } from "./pipeline-stage.js";
export {
  createPipelineStage,
  movePipelineStage,
  type CreatePipelineStageCommand,
} from "./pipeline-stage.js";
export type { Activity, ActivityRepository, ActivityType, ActivityStatus } from "./activity.js";
export {
  createActivity,
  completeActivity,
  cancelActivity,
  type CreateActivityCommand,
} from "./activity.js";
