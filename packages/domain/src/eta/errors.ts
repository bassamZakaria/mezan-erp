import type { EtaSubmissionStatus } from "./submission.js";

export class EtaSubmissionNotFoundError extends Error {
  readonly code = "ETA_SUBMISSION_NOT_FOUND";
  constructor(readonly id: string) {
    super(`ETA submission "${id}" not found.`);
    this.name = "EtaSubmissionNotFoundError";
  }
}

export class DuplicateEtaSubmissionError extends Error {
  readonly code = "ETA_SUBMISSION_DUPLICATE";
  constructor(readonly internalId: string) {
    super(`ETA submission for document "${internalId}" already exists.`);
    this.name = "DuplicateEtaSubmissionError";
  }
}

export class InvalidEtaTransitionError extends Error {
  readonly code = "ETA_INVALID_TRANSITION";
  constructor(
    readonly from: EtaSubmissionStatus,
    readonly action: string,
  ) {
    super(`Cannot ${action} an ETA submission in status "${from}".`);
    this.name = "InvalidEtaTransitionError";
  }
}

/** The ONLINE transmit path is a stub in this build — it is refused offline. */
export class EtaOfflineError extends Error {
  readonly code = "ETA_OFFLINE";
  constructor() {
    super("ETA transmission is online-only and is stubbed in this build; the document was queued.");
    this.name = "EtaOfflineError";
  }
}

export class EtaExclusionReasonRequiredError extends Error {
  readonly code = "ETA_EXCLUSION_REASON_REQUIRED";
  constructor() {
    super("Excluding a document from ETA submission requires a reason.");
    this.name = "EtaExclusionReasonRequiredError";
  }
}
