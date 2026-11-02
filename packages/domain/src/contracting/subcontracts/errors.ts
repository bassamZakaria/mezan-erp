import { getSubCertificateStatusLabel, getSubCertificateStatusLabelEn, type SubCertificateStatus } from "./sub-certificate.js";
import { getSubcontractStatusLabel, getSubcontractStatusLabelEn, type SubcontractStatus } from "./subcontract.js";
import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";

/** Raised when a subcontract id or docNo does not exist. */
export class SubcontractNotFoundError extends Error {
  readonly code = "SUBCONTRACT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly subcontractId: string) {
    super(`عقد الباطن "${subcontractId}" غير موجود.`);
    this.messageEn = `Subcontract "${subcontractId}" was not found.`;
    this.name = "SubcontractNotFoundError";
  }
}

/** Raised when a subcontract or one of its lines fails validation. Reasons are Arabic. */
export class InvalidSubcontractError extends Error {
  readonly code = "INVALID_SUBCONTRACT";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The subcontract data is invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidSubcontractError";
  }
}

/** Raised when a subcontract status move is not one the lifecycle allows. */
export class InvalidSubcontractTransitionError extends Error {
  readonly code = "INVALID_SUBCONTRACT_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: SubcontractStatus,
    readonly to: SubcontractStatus,
  ) {
    super(
      `لا يمكن نقل عقد الباطن من "${getSubcontractStatusLabel(from)}" إلى "${getSubcontractStatusLabel(to)}".`,
    );
    this.messageEn = `A subcontract cannot move from "${getSubcontractStatusLabelEn(from)}" to "${getSubcontractStatusLabelEn(to)}".`;
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
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(
    readonly supplierId: string,
    reasons: readonly ReasonInput[],
  ) {
    const split = splitReasons(reasons, "The subcontractor is not yet payable.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "SubcontractorNotPayableError";
  }
}

export class SubCertificateNotFoundError extends Error {
  readonly code = "SUB_CERTIFICATE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly certificateId: string) {
    super(`مستخلص مقاول الباطن "${certificateId}" غير موجود.`);
    this.messageEn = `Subcontractor certificate "${certificateId}" was not found.`;
    this.name = "SubCertificateNotFoundError";
  }
}

export class InvalidSubCertificateError extends Error {
  readonly code = "INVALID_SUB_CERTIFICATE";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The subcontractor certificate data is invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidSubCertificateError";
  }
}

export class InvalidSubCertificateTransitionError extends Error {
  readonly code = "INVALID_SUB_CERTIFICATE_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: SubCertificateStatus,
    readonly to: SubCertificateStatus,
  ) {
    super(
      `لا يمكن نقل مستخلص الباطن من "${getSubCertificateStatusLabel(from)}" إلى "${getSubCertificateStatusLabel(to)}".`,
    );
    this.messageEn = `A subcontractor certificate cannot move from "${getSubCertificateStatusLabelEn(from)}" to "${getSubCertificateStatusLabelEn(to)}".`;
    this.name = "InvalidSubCertificateTransitionError";
  }
}

/** Every later certificate's «سابق» column was read off this one. */
export class LaterSubCertificateExistsError extends Error {
  readonly code = "LATER_SUB_CERTIFICATE_EXISTS";
  readonly messageEn: string;
  constructor(
    readonly certificateId: string,
    readonly laterDocNo: string,
    readonly laterSerial: number,
  ) {
    super(
      `لا يمكن تعديل هذا المستخلص أو نقل حالته لوجود مستخلص لاحق رقم ${laterSerial} (${laterDocNo}) مبني عليه.`,
    );
    this.messageEn = `This certificate cannot be edited or have its status changed because a later certificate no. ${laterSerial} (${laterDocNo}) is built on it.`;
    this.name = "LaterSubCertificateExistsError";
  }
}

/** Raised when the same person would hold two of the three signatures (design §06). */
export class SubCertificateSegregationError extends Error {
  readonly code = "SUB_CERTIFICATE_SEGREGATION_REFUSED";
  readonly messageEn: string;
  constructor(
    readonly userId: string,
    message: string,
    messageEn: string,
  ) {
    super(message);
    this.messageEn = messageEn;
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
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The certified quantity is not allowed.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "SubCertificateQuantityError";
  }
}

/** Raised when a retention release would exceed the balance actually held. */
export class SubcontractRetentionError extends Error {
  readonly code = "SUBCONTRACT_RETENTION_REFUSED";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
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
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The deductions block is not payable.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "SubCertificateDeductionError";
  }
}
