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
  getLeadStatusLabelEn,
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
export {
  OpportunityLostReason,
  OPPORTUNITY_LOST_REASON_DEFINITIONS,
  isOpportunityLostReason,
  getOpportunityLostReasonLabel,
  type OpportunityLostReasonDefinition,
} from "./lost-reason.js";
export type { OpportunityLoss } from "./move-opportunity-stage.js";
export { winOpportunity } from "./win-opportunity.js";
export {
  buildWeightedForecast,
  weightedAmount,
  forecastMonthOf,
  type ForecastFigures,
  type ForecastMonthRow,
  type ForecastOwnerRow,
  type WeightedForecast,
} from "./forecast.js";
export { dueActivityReminders, type ActivityReminder, type ActivityReminderLog } from "./activity-reminders.js";
export {
  dwellSegments,
  isTerminalStage,
  wholeDaysBetween,
  type OpportunityStageEntry,
  type OpportunityStageHistorySource,
  type StageDwellSegment,
} from "./stage-history.js";
