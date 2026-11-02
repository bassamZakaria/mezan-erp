import { statusWord } from "../../status-words.js";
import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";
/**
 * Refusals of الإفراج عن المحتجزات, each with an Arabic message a route turns
 * into a 4xx — never a 500 and never an English string on a screen.
 */

export class RetentionReleaseNotFoundError extends Error {
  readonly code = "RETENTION_RELEASE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly idOrDocNo: string) {
    super(`مستند الإفراج عن المحتجزات "${idOrDocNo}" غير موجود.`);
    this.messageEn = `Retention release document "${idOrDocNo}" was not found.`;
    this.name = "RetentionReleaseNotFoundError";
  }
}

export class InvalidRetentionReleaseError extends Error {
  readonly code = "INVALID_RETENTION_RELEASE";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The retention release data is invalid.");
    super(split.ar.join(" · "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidRetentionReleaseError";
  }
}

export class RetentionReleaseExceedsBalanceError extends Error {
  readonly code = "RETENTION_RELEASE_EXCEEDS_BALANCE";
  readonly messageEn: string;
  constructor(
    readonly requested: string,
    readonly cap: string,
    message: string,
    messageEn: string,
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "RetentionReleaseExceedsBalanceError";
  }
}

export class InvalidRetentionReleaseTransitionError extends Error {
  readonly code = "INVALID_RETENTION_RELEASE_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`لا يمكن نقل مستند الإفراج من "${statusWord(from).ar}" إلى "${statusWord(to).ar}".`);
    this.messageEn = `A release document cannot move from "${statusWord(from).en}" to "${statusWord(to).en}".`;
    this.name = "InvalidRetentionReleaseTransitionError";
  }
}
