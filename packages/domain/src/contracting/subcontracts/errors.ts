import { getSubCertificateStatusLabel, type SubCertificateStatus } from "./sub-certificate.js";
import { getSubcontractStatusLabel, type SubcontractStatus } from "./subcontract.js";

/** Raised when a subcontract id or docNo does not exist. */
export class SubcontractNotFoundError extends Error {
  readonly code = "SUBCONTRACT_NOT_FOUND";
  constructor(readonly subcontractId: string) {
    super(`عقد الباطن "${subcontractId}" غير موجود.`);
    this.name = "SubcontractNotFoundError";
  }
}

/** Raised when a subcontract or one of its lines fails validation. Reasons are Arabic. */
export class InvalidSubcontractError extends Error {
  readonly code = "INVALID_SUBCONTRACT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidSubcontractError";
  }
}

/** Raised when a subcontract status move is not one the lifecycle allows. */
export class InvalidSubcontractTransitionError extends Error {
  readonly code = "INVALID_SUBCONTRACT_TRANSITION";
  constructor(
    readonly from: SubcontractStatus,
    readonly to: SubcontractStatus,
  ) {
    super(
      `لا يمكن نقل عقد الباطن من "${getSubcontractStatusLabel(from)}" إلى "${getSubcontractStatusLabel(to)}".`,
    );
    this.name = "InvalidSubcontractTransitionError";
  }
}

/**
 * Raised when the subcontractor is not yet payable: Egypt withholds tax on the
 * payment and remits it under the supplier's own tax number, and a bank
 * account is what a subcontractor is actually paid into. Both are named.
 */
export class SubcontractorNotPayableError extends Error {
  readonly code = "SUBCONTRACTOR_NOT_PAYABLE";
  constructor(
    readonly supplierId: string,
    readonly reasons: readonly string[],
  ) {
    super(reasons.join("، "));
    this.name = "SubcontractorNotPayableError";
  }
}

export class SubCertificateNotFoundError extends Error {
  readonly code = "SUB_CERTIFICATE_NOT_FOUND";
  constructor(readonly certificateId: string) {
    super(`مستخلص مقاول الباطن "${certificateId}" غير موجود.`);
    this.name = "SubCertificateNotFoundError";
  }
}

export class InvalidSubCertificateError extends Error {
  readonly code = "INVALID_SUB_CERTIFICATE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidSubCertificateError";
  }
}

export class InvalidSubCertificateTransitionError extends Error {
  readonly code = "INVALID_SUB_CERTIFICATE_TRANSITION";
  constructor(
    readonly from: SubCertificateStatus,
    readonly to: SubCertificateStatus,
  ) {
    super(
      `لا يمكن نقل مستخلص الباطن من "${getSubCertificateStatusLabel(from)}" إلى "${getSubCertificateStatusLabel(to)}".`,
    );
    this.name = "InvalidSubCertificateTransitionError";
  }
}

/** Every later certificate's «سابق» column was read off this one. */
export class LaterSubCertificateExistsError extends Error {
  readonly code = "LATER_SUB_CERTIFICATE_EXISTS";
  constructor(
    readonly certificateId: string,
    readonly laterDocNo: string,
    readonly laterSerial: number,
  ) {
    super(
      `لا يمكن تعديل هذا المستخلص أو نقل حالته لوجود مستخلص لاحق رقم ${laterSerial} (${laterDocNo}) مبني عليه.`,
    );
    this.name = "LaterSubCertificateExistsError";
  }
}

/** Raised when the same person would hold two of the three signatures (design §06). */
export class SubCertificateSegregationError extends Error {
  readonly code = "SUB_CERTIFICATE_SEGREGATION_REFUSED";
  constructor(
    readonly userId: string,
    message: string,
  ) {
    super(message);
    this.name = "SubCertificateSegregationError";
  }
}

/**
 * Raised when a quantity exceeds the subcontract's own line, or — the control
 * this slice exists for — what the consultant certified to the employer on the
 * client BOQ line the sub line sits under (design §03 "THE MIRROR").
 */
export class SubCertificateQuantityError extends Error {
  readonly code = "SUB_CERTIFICATE_QUANTITY_REFUSED";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "SubCertificateQuantityError";
  }
}

/** Raised when a retention release would exceed the balance actually held. */
export class SubcontractRetentionError extends Error {
  readonly code = "SUBCONTRACT_RETENTION_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "SubcontractRetentionError";
  }
}

/**
 * Raised when the deduction block is not payable: a net payable below zero, a
 * materials deduction larger than what was actually issued to this sub, or a
 * penalty past the ceiling the package was let at. Every one of the four
 * cumulative figures is typed by a person, so none of them may be believed.
 */
export class SubCertificateDeductionError extends Error {
  readonly code = "SUB_CERTIFICATE_DEDUCTION_REFUSED";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "SubCertificateDeductionError";
  }
}
