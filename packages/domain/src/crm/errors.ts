/** Raised when an operation references a lead id that does not exist. */
export class LeadNotFoundError extends Error {
  readonly code = "LEAD_NOT_FOUND";
  constructor(readonly leadId: string) {
    super(`Lead "${leadId}" was not found.`);
    this.name = "LeadNotFoundError";
  }
}

/** Raised when a new-lead command fails validation (e.g. an empty name). */
export class InvalidLeadError extends Error {
  readonly code = "INVALID_LEAD";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidLeadError";
  }
}

/** Raised when a lead status transition is not allowed by the lead state machine. */
export class InvalidLeadTransitionError extends Error {
  readonly code = "INVALID_LEAD_TRANSITION";
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot transition lead from "${from}" to "${to}".`);
    this.name = "InvalidLeadTransitionError";
  }
}

/** Raised when a new-opportunity command fails validation (e.g. an empty title or an out-of-range probability). */
export class InvalidOpportunityError extends Error {
  readonly code = "INVALID_OPPORTUNITY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidOpportunityError";
  }
}

/** Raised when converting a lead that is not currently "qualified". */
export class LeadNotConvertibleError extends Error {
  readonly code = "LEAD_NOT_CONVERTIBLE";
  constructor(readonly leadId: string) {
    super(`Lead "${leadId}" is not convertible (must be "qualified").`);
    this.name = "LeadNotConvertibleError";
  }
}

/** Raised when more than one active pipeline stage is flagged as the win stage. */
export class DuplicatePipelineStageWinError extends Error {
  readonly code = "DUPLICATE_PIPELINE_STAGE_WIN";
  constructor() {
    super("Only one active pipeline stage may be flagged as the win stage.");
    this.name = "DuplicatePipelineStageWinError";
  }
}

/** Raised when an operation references a pipeline-stage id that does not exist. */
export class PipelineStageNotFoundError extends Error {
  readonly code = "PIPELINE_STAGE_NOT_FOUND";
  constructor(readonly stageId: string) {
    super(`Pipeline stage "${stageId}" was not found.`);
    this.name = "PipelineStageNotFoundError";
  }
}

/** Raised when an operation references an opportunity id that does not exist. */
export class OpportunityNotFoundError extends Error {
  readonly code = "OPPORTUNITY_NOT_FOUND";
  constructor(readonly opportunityId: string) {
    super(`Opportunity "${opportunityId}" was not found.`);
    this.name = "OpportunityNotFoundError";
  }
}

/** Raised when an operation references an activity id that does not exist. */
export class ActivityNotFoundError extends Error {
  readonly code = "ACTIVITY_NOT_FOUND";
  constructor(readonly activityId: string) {
    super(`Activity "${activityId}" was not found.`);
    this.name = "ActivityNotFoundError";
  }
}

/** Raised when a new-activity command fails validation (e.g. an empty subject). */
export class InvalidActivityError extends Error {
  readonly code = "INVALID_ACTIVITY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidActivityError";
  }
}

/** Raised when completing/cancelling an activity that is not currently "pending". */
export class ActivityNotPendingError extends Error {
  readonly code = "ACTIVITY_NOT_PENDING";
  constructor(readonly activityId: string) {
    super(`Activity "${activityId}" is not pending.`);
    this.name = "ActivityNotPendingError";
  }
}
