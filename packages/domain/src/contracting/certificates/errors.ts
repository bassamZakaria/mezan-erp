import { getProgressCertificateStatusLabel, type ProgressCertificateStatus } from "./certificate.js";

/** Raised when a certificate id or docNo does not exist. */
export class ProgressCertificateNotFoundError extends Error {
  readonly code = "CERTIFICATE_NOT_FOUND";
  constructor(readonly certificateId: string) {
    super(`المستخلص "${certificateId}" غير موجود.`);
    this.name = "ProgressCertificateNotFoundError";
  }
}

/** Raised when a certificate or one of its lines fails validation. Reasons are Arabic. */
export class InvalidProgressCertificateError extends Error {
  readonly code = "INVALID_CERTIFICATE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidProgressCertificateError";
  }
}

/** Raised when a status move is not one the lifecycle allows. */
export class InvalidProgressCertificateTransitionError extends Error {
  readonly code = "INVALID_CERTIFICATE_TRANSITION";
  constructor(
    readonly from: ProgressCertificateStatus,
    readonly to: ProgressCertificateStatus,
  ) {
    super(
      `لا يمكن نقل المستخلص من "${getProgressCertificateStatusLabel(from)}" إلى "${getProgressCertificateStatusLabel(to)}".`,
    );
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
  constructor(
    readonly certificateId: string,
    readonly laterDocNo: string,
    readonly laterSerial: number,
  ) {
    super(
      `لا يمكن تعديل هذا المستخلص أو نقل حالته لوجود مستخلص لاحق رقم ${laterSerial} (${laterDocNo}) مبني عليه.`,
    );
    this.name = "LaterCertificateExistsError";
  }
}

/** Raised when the same person would hold two of the three signatures (design §06). */
export class CertificateSegregationError extends Error {
  readonly code = "CERTIFICATE_SEGREGATION_REFUSED";
  constructor(
    readonly userId: string,
    message: string,
  ) {
    super(message);
    this.name = "CertificateSegregationError";
  }
}

/** Raised when a quantity would exceed what the contract carries as of the execution date. */
export class CertificateQuantityError extends Error {
  readonly code = "CERTIFICATE_QUANTITY_REFUSED";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "CertificateQuantityError";
  }
}
