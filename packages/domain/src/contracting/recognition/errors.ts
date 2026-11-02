import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";
/** Raised when an operation names a recognition run that does not exist. */
export class RecognitionRunNotFoundError extends Error {
  readonly code = "RECOGNITION_RUN_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly runId: string) {
    super(`تشغيل الاعتراف بالإيراد "${runId}" غير موجود.`);
    this.messageEn = `Revenue recognition run "${runId}" was not found.`;
    this.name = "RecognitionRunNotFoundError";
  }
}

/** Raised when the run is refused. Reasons are Arabic and reach the screen verbatim. */
export class InvalidRecognitionRunError extends Error {
  readonly code = "INVALID_RECOGNITION_RUN";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The revenue recognition run was refused.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidRecognitionRunError";
  }
}

/** Raised when a second run is asked for a contract and period that already has one. */
export class RecognitionRunAlreadyPostedError extends Error {
  readonly code = "RECOGNITION_RUN_ALREADY_POSTED";
  readonly messageEn: string;
  constructor(
    readonly contractId: string,
    readonly periodEnd: string,
    readonly docNo: string,
  ) {
    super(`سبق تشغيل الاعتراف بالإيراد لهذا العقد عن الفترة المنتهية في ${periodEnd} بالمستند ${docNo}.`);
    this.messageEn = `Revenue recognition has already been run for this contract for the period ending ${periodEnd}, as document ${docNo}.`;
    this.name = "RecognitionRunAlreadyPostedError";
  }
}

/** Raised when a month is asked for before the month before it has been run. */
export class RecognitionPreviousPeriodMissingError extends Error {
  readonly code = "RECOGNITION_PREVIOUS_PERIOD_MISSING";
  readonly messageEn: string;
  constructor(
    readonly contractId: string,
    readonly previousPeriodEnd: string,
  ) {
    super(`يجب تشغيل الشهر السابق أولًا — الفترة المنتهية في ${previousPeriodEnd}.`);
    this.messageEn = `The previous month must be run first — the period ending ${previousPeriodEnd}.`;
    this.name = "RecognitionPreviousPeriodMissingError";
  }
}

/** Raised when a reversal names a run that is not the contract's latest. */
export class RecognitionRunNotLatestError extends Error {
  readonly code = "RECOGNITION_RUN_NOT_LATEST";
  readonly messageEn: string;
  constructor(
    readonly runId: string,
    readonly latestPeriodEnd: string,
  ) {
    super(`لا يمكن عكس هذا التشغيل — يجب عكس تشغيل الفترة المنتهية في ${latestPeriodEnd} أولًا.`);
    this.messageEn = `This run cannot be reversed — the run for the period ending ${latestPeriodEnd} must be reversed first.`;
    this.name = "RecognitionRunNotLatestError";
  }
}

/** Raised when a run that is already reversed is reversed again. */
export class RecognitionRunAlreadyReversedError extends Error {
  readonly code = "RECOGNITION_RUN_ALREADY_REVERSED";
  readonly messageEn: string;
  constructor(readonly runId: string) {
    super(`تم عكس تشغيل الاعتراف بالإيراد "${runId}" من قبل.`);
    this.messageEn = `Revenue recognition run "${runId}" has already been reversed.`;
    this.name = "RecognitionRunAlreadyReversedError";
  }
}
