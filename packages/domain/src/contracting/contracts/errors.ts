import { getWorksContractStatusLabel, getWorksContractStatusLabelEn, type WorksContractStatus } from "./contract.js";
import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";

/** Raised when a contract id or docNo does not exist. */
export class WorksContractNotFoundError extends Error {
  readonly code = "CONTRACT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly contractId: string) {
    super(`العقد "${contractId}" غير موجود.`);
    this.messageEn = `Contract "${contractId}" was not found.`;
    this.name = "WorksContractNotFoundError";
  }
}

/** Raised when a variation order id or docNo does not exist. */
export class VariationOrderNotFoundError extends Error {
  readonly code = "VARIATION_ORDER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly variationOrderId: string) {
    super(`أمر التغيير "${variationOrderId}" غير موجود.`);
    this.messageEn = `Variation order "${variationOrderId}" was not found.`;
    this.name = "VariationOrderNotFoundError";
  }
}

/** Raised when a contract, a BOQ line or a variation order fails validation. Reasons are Arabic. */
export class InvalidWorksContractError extends Error {
  readonly code = "INVALID_CONTRACT";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The contract data is invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidWorksContractError";
  }
}

/** Raised when a contract status change is not one the lifecycle allows. */
export class InvalidWorksContractTransitionError extends Error {
  readonly code = "INVALID_CONTRACT_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: WorksContractStatus,
    readonly to: WorksContractStatus,
  ) {
    super(`لا يمكن نقل العقد من "${getWorksContractStatusLabel(from)}" إلى "${getWorksContractStatusLabel(to)}".`);
    this.messageEn = `A contract cannot move from "${getWorksContractStatusLabelEn(from)}" to "${getWorksContractStatusLabelEn(to)}".`;
    this.name = "InvalidWorksContractTransitionError";
  }
}

/**
 * Raised when the base scope of an active contract is edited directly. Once a
 * contract is active its BOQ changes only through an أمر تغيير — that is the
 * whole reason variation orders exist.
 */
export class WorksContractNotDraftError extends Error {
  readonly code = "CONTRACT_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly contractId: string,
    readonly status: WorksContractStatus,
    message = `لا يمكن تعديل جدول الكميات بعد تفعيل العقد — التعديل يتم بأمر تغيير. حالة العقد: "${getWorksContractStatusLabel(status)}".`,
    messageEn = `The bill of quantities cannot be edited once the contract is active — change it with a variation order. Contract status: "${getWorksContractStatusLabelEn(status)}".`,
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "WorksContractNotDraftError";
  }
}

/** Raised when a variation order is approved or rejected by the person who drafted it. */
export class SelfApprovalError extends Error {
  readonly code = "SELF_APPROVAL_REFUSED";
  readonly messageEn: string;
  constructor(readonly userId: string) {
    super("لا يجوز اعتماد أمر التغيير من نفس الشخص الذي أعدّه.");
    this.messageEn = "A variation order cannot be approved by the same person who drafted it.";
    this.name = "SelfApprovalError";
  }
}
