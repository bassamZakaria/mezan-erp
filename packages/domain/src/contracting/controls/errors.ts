/**
 * Refusals of الإفراج عن المحتجزات, each with an Arabic message a route turns
 * into a 4xx — never a 500 and never an English string on a screen.
 */

export class RetentionReleaseNotFoundError extends Error {
  readonly code = "RETENTION_RELEASE_NOT_FOUND";
  constructor(readonly idOrDocNo: string) {
    super(`مستند الإفراج عن المحتجزات "${idOrDocNo}" غير موجود.`);
    this.name = "RetentionReleaseNotFoundError";
  }
}

export class InvalidRetentionReleaseError extends Error {
  readonly code = "INVALID_RETENTION_RELEASE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" · "));
    this.name = "InvalidRetentionReleaseError";
  }
}

export class RetentionReleaseExceedsBalanceError extends Error {
  readonly code = "RETENTION_RELEASE_EXCEEDS_BALANCE";
  constructor(
    readonly requested: string,
    readonly cap: string,
    message: string,
  ) {
    super(message);
    this.name = "RetentionReleaseExceedsBalanceError";
  }
}

export class InvalidRetentionReleaseTransitionError extends Error {
  readonly code = "INVALID_RETENTION_RELEASE_TRANSITION";
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`لا يمكن نقل مستند الإفراج من "${from}" إلى "${to}".`);
    this.name = "InvalidRetentionReleaseTransitionError";
  }
}
