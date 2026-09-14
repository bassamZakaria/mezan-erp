import { getWorksContractStatusLabel, type WorksContractStatus } from "./contract.js";

/** Raised when a contract id or docNo does not exist. */
export class WorksContractNotFoundError extends Error {
  readonly code = "CONTRACT_NOT_FOUND";
  constructor(readonly contractId: string) {
    super(`العقد "${contractId}" غير موجود.`);
    this.name = "WorksContractNotFoundError";
  }
}

/** Raised when a variation order id or docNo does not exist. */
export class VariationOrderNotFoundError extends Error {
  readonly code = "VARIATION_ORDER_NOT_FOUND";
  constructor(readonly variationOrderId: string) {
    super(`أمر التغيير "${variationOrderId}" غير موجود.`);
    this.name = "VariationOrderNotFoundError";
  }
}

/** Raised when a contract, a BOQ line or a variation order fails validation. Reasons are Arabic. */
export class InvalidWorksContractError extends Error {
  readonly code = "INVALID_CONTRACT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidWorksContractError";
  }
}

/** Raised when a contract status change is not one the lifecycle allows. */
export class InvalidWorksContractTransitionError extends Error {
  readonly code = "INVALID_CONTRACT_TRANSITION";
  constructor(
    readonly from: WorksContractStatus,
    readonly to: WorksContractStatus,
  ) {
    super(`لا يمكن نقل العقد من "${getWorksContractStatusLabel(from)}" إلى "${getWorksContractStatusLabel(to)}".`);
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
  constructor(
    readonly contractId: string,
    readonly status: WorksContractStatus,
    message = `لا يمكن تعديل جدول الكميات بعد تفعيل العقد — التعديل يتم بأمر تغيير. حالة العقد: "${getWorksContractStatusLabel(status)}".`,
  ) {
    super(message);
    this.name = "WorksContractNotDraftError";
  }
}

/** Raised when a variation order is approved or rejected by the person who drafted it. */
export class SelfApprovalError extends Error {
  readonly code = "SELF_APPROVAL_REFUSED";
  constructor(readonly userId: string) {
    super("لا يجوز اعتماد أمر التغيير من نفس الشخص الذي أعدّه.");
    this.name = "SelfApprovalError";
  }
}
