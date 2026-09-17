/** Raised when an operation names a recognition run that does not exist. */
export class RecognitionRunNotFoundError extends Error {
  readonly code = "RECOGNITION_RUN_NOT_FOUND";
  constructor(readonly runId: string) {
    super(`تشغيل الاعتراف بالإيراد "${runId}" غير موجود.`);
    this.name = "RecognitionRunNotFoundError";
  }
}

/** Raised when the run is refused. Reasons are Arabic and reach the screen verbatim. */
export class InvalidRecognitionRunError extends Error {
  readonly code = "INVALID_RECOGNITION_RUN";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidRecognitionRunError";
  }
}

/** Raised when a second run is asked for a contract and period that already has one. */
export class RecognitionRunAlreadyPostedError extends Error {
  readonly code = "RECOGNITION_RUN_ALREADY_POSTED";
  constructor(
    readonly contractId: string,
    readonly periodEnd: string,
    readonly docNo: string,
  ) {
    super(`سبق تشغيل الاعتراف بالإيراد لهذا العقد عن الفترة المنتهية في ${periodEnd} بالمستند ${docNo}.`);
    this.name = "RecognitionRunAlreadyPostedError";
  }
}

/** Raised when a month is asked for before the month before it has been run. */
export class RecognitionPreviousPeriodMissingError extends Error {
  readonly code = "RECOGNITION_PREVIOUS_PERIOD_MISSING";
  constructor(
    readonly contractId: string,
    readonly previousPeriodEnd: string,
  ) {
    super(`يجب تشغيل الشهر السابق أولًا — الفترة المنتهية في ${previousPeriodEnd}.`);
    this.name = "RecognitionPreviousPeriodMissingError";
  }
}

/** Raised when a reversal names a run that is not the contract's latest. */
export class RecognitionRunNotLatestError extends Error {
  readonly code = "RECOGNITION_RUN_NOT_LATEST";
  constructor(
    readonly runId: string,
    readonly latestPeriodEnd: string,
  ) {
    super(`لا يمكن عكس هذا التشغيل — يجب عكس تشغيل الفترة المنتهية في ${latestPeriodEnd} أولًا.`);
    this.name = "RecognitionRunNotLatestError";
  }
}

/** Raised when a run that is already reversed is reversed again. */
export class RecognitionRunAlreadyReversedError extends Error {
  readonly code = "RECOGNITION_RUN_ALREADY_REVERSED";
  constructor(readonly runId: string) {
    super(`تم عكس تشغيل الاعتراف بالإيراد "${runId}" من قبل.`);
    this.name = "RecognitionRunAlreadyReversedError";
  }
}
