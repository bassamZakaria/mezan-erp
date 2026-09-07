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

/** التوقيع الإلكتروني غير مُهيّأ — no external signing program is configured. */
export class EtaSignerNotConfiguredError extends Error {
  readonly code = "ETA_SIGNER_NOT_CONFIGURED";
  constructor() {
    super(
      "التوقيع الإلكتروني يتم بجهاز التوقيع (التوكن) الخاص بالممول ولا يمكن تنفيذه داخل البرنامج. اضبط أمر التوقيع الخارجي في إعدادات الفاتورة الإلكترونية قبل الإرسال.",
    );
    this.name = "EtaSignerNotConfiguredError";
  }
}

/** برنامج التوقيع رفض أو أخفق — the configured signing program did not return a signature. */
export class EtaSigningFailedError extends Error {
  readonly code = "ETA_SIGNING_FAILED";
  constructor(readonly detail: string) {
    super(`تعذّر توقيع المستند: ${detail}`);
    this.name = "EtaSigningFailedError";
  }
}
