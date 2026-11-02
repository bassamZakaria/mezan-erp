import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";
import { getProgressCertificateStatusLabel, type ProgressCertificateStatus } from "./certificate.js";

export const PROGRESS_CERTIFICATE_STATUS_EN: Readonly<Record<ProgressCertificateStatus, string>> = {
  draft: "Draft",
  measured: "Measured",
  certified: "Certified",
  approved_for_payment: "Approved for payment",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
  voided: "Voided",
};

/** Raised when a certificate id or docNo does not exist. */
export class ProgressCertificateNotFoundError extends Error {
  readonly code = "CERTIFICATE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly certificateId: string) {
    super(`المستخلص "${certificateId}" غير موجود.`);
    this.messageEn = `Progress certificate "${certificateId}" was not found.`;
    this.name = "ProgressCertificateNotFoundError";
  }
}

/** Raised when a certificate or one of its lines fails validation. Reasons are Arabic. */
export class InvalidProgressCertificateError extends Error {
  readonly code = "INVALID_CERTIFICATE";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The progress certificate failed validation.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidProgressCertificateError";
  }
}

/** Raised when a status move is not one the lifecycle allows. */
export class InvalidProgressCertificateTransitionError extends Error {
  readonly code = "INVALID_CERTIFICATE_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: ProgressCertificateStatus,
    readonly to: ProgressCertificateStatus,
  ) {
    super(
      `لا يمكن نقل المستخلص من "${getProgressCertificateStatusLabel(from)}" إلى "${getProgressCertificateStatusLabel(to)}".`,
    );
    this.messageEn = `A progress certificate cannot move from "${PROGRESS_CERTIFICATE_STATUS_EN[from]}" to "${PROGRESS_CERTIFICATE_STATUS_EN[to]}".`;
    this.name = "InvalidProgressCertificateTransitionError";
  }
}

/**
 * Raised when anything is attempted on a certificate that a LATER one already
 * builds on. Every later certificate's «سابق» column was read off this one, so
 * editing it silently restates work that has already been billed.
 */
export class LaterCertificateExistsError extends Error {
  readonly code = "LATER_CERTIFICATE_EXISTS";
  readonly messageEn: string;
  constructor(
    readonly certificateId: string,
    readonly laterDocNo: string,
    readonly laterSerial: number,
  ) {
    super(
      `لا يمكن تعديل هذا المستخلص أو نقل حالته لوجود مستخلص لاحق رقم ${laterSerial} (${laterDocNo}) مبني عليه.`,
    );
    this.messageEn = `This progress certificate cannot be edited or moved to another status because a later certificate no. ${laterSerial} (${laterDocNo}) is built on it.`;
    this.name = "LaterCertificateExistsError";
  }
}

/** Raised when the same person would hold two of the three signatures (design §06). */
export class CertificateSegregationError extends Error {
  readonly code = "CERTIFICATE_SEGREGATION_REFUSED";
  readonly messageEn: string;
  constructor(
    readonly userId: string,
    message: string,
    messageEn = "The same person cannot hold more than one of the three signatures on a progress certificate.",
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "CertificateSegregationError";
  }
}

/** Raised when a quantity would exceed what the contract carries as of the execution date. */
export class CertificateQuantityError extends Error {
  readonly code = "CERTIFICATE_QUANTITY_REFUSED";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "A certified quantity exceeds what the contract carries as of the execution date.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "CertificateQuantityError";
  }
}

/**
 * Raised when the three signature dates do not run forward from the period
 * they certify. Names BOTH dates, because "invalid date" tells the person
 * nothing about which of the two they have to change.
 */
export class CertificateDateOrderError extends Error {
  readonly code = "CERTIFICATE_DATE_ORDER_REFUSED";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The certificate dates are not in a valid order.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "CertificateDateOrderError";
  }
}
