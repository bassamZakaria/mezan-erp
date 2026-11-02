import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import { getLeadStatusLabel, getLeadStatusLabelEn, type LeadStatus } from "./lead.js";
/** Raised when an operation references a lead id that does not exist. */
export class LeadNotFoundError extends Error {
  readonly code = "LEAD_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly leadId: string) {
    super(`العميل المحتمل "${leadId}" غير موجود.`);
    this.messageEn = `Lead "${leadId}" was not found.`;
    this.name = "LeadNotFoundError";
  }
}

/** Raised when a new-lead command fails validation (e.g. an empty name). */
export class InvalidLeadError extends Error {
  readonly code = "INVALID_LEAD";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "Validation failed");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidLeadError";
  }
}

/** Raised when a lead status transition is not allowed by the lead state machine. */
export class InvalidLeadTransitionError extends Error {
  readonly code = "INVALID_LEAD_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: LeadStatus,
    readonly to: LeadStatus,
  ) {
    super(`لا يمكن نقل العميل المحتمل من "${getLeadStatusLabel(from)}" إلى "${getLeadStatusLabel(to)}".`);
    this.messageEn = `A lead cannot move from "${getLeadStatusLabelEn(from)}" to "${getLeadStatusLabelEn(to)}".`;
    this.name = "InvalidLeadTransitionError";
  }
}

/** Raised when a new-opportunity command fails validation (e.g. an empty title or an out-of-range probability). */
export class InvalidOpportunityError extends Error {
  readonly code = "INVALID_OPPORTUNITY";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "Validation failed");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidOpportunityError";
  }
}

/** Raised when converting a lead that is not currently "qualified". */
export class LeadNotConvertibleError extends Error {
  readonly code = "LEAD_NOT_CONVERTIBLE";
  readonly messageEn: string;
  constructor(readonly leadId: string) {
    super(`لا يمكن تحويل العميل المحتمل "${leadId}" إلا إذا كانت حالته «مؤهل».`);
    this.messageEn = `Lead "${leadId}" is not convertible (must be "qualified").`;
    this.name = "LeadNotConvertibleError";
  }
}

/** Raised when more than one active pipeline stage is flagged as the win stage. */
export class DuplicatePipelineStageWinError extends Error {
  readonly code = "DUPLICATE_PIPELINE_STAGE_WIN";
  readonly messageEn: string;
  constructor() {
    super("لا يمكن تحديد أكثر من مرحلة فوز نشطة واحدة في مسار المبيعات؛ مرحلة الفوز واحدة فقط.");
    this.messageEn = "Only one active pipeline stage may be flagged as the win stage.";
    this.name = "DuplicatePipelineStageWinError";
  }
}

/** Raised when an operation references a pipeline-stage id that does not exist. */
export class PipelineStageNotFoundError extends Error {
  readonly code = "PIPELINE_STAGE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly stageId: string) {
    super(`مرحلة مسار المبيعات "${stageId}" غير موجودة.`);
    this.messageEn = `Pipeline stage "${stageId}" was not found.`;
    this.name = "PipelineStageNotFoundError";
  }
}

/** Raised when an operation references an opportunity id that does not exist. */
export class OpportunityNotFoundError extends Error {
  readonly code = "OPPORTUNITY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly opportunityId: string) {
    super(`الفرصة البيعية "${opportunityId}" غير موجودة.`);
    this.messageEn = `Opportunity "${opportunityId}" was not found.`;
    this.name = "OpportunityNotFoundError";
  }
}

/** Raised when an operation references an activity id that does not exist. */
export class ActivityNotFoundError extends Error {
  readonly code = "ACTIVITY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly activityId: string) {
    super(`النشاط "${activityId}" غير موجود.`);
    this.messageEn = `Activity "${activityId}" was not found.`;
    this.name = "ActivityNotFoundError";
  }
}

/** Raised when a new-activity command fails validation (e.g. an empty subject). */
export class InvalidActivityError extends Error {
  readonly code = "INVALID_ACTIVITY";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "Validation failed");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidActivityError";
  }
}

/** Raised when completing/cancelling an activity that is not currently "pending". */
export class ActivityNotPendingError extends Error {
  readonly code = "ACTIVITY_NOT_PENDING";
  readonly messageEn: string;
  constructor(readonly activityId: string) {
    super(`النشاط "${activityId}" ليس بانتظار التنفيذ.`);
    this.messageEn = `Activity "${activityId}" is not pending.`;
    this.name = "ActivityNotPendingError";
  }
}
