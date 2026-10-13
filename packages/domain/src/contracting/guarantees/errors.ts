import { getGuaranteeStatusLabel, type GuaranteeStatus } from "./guarantee.js";

/** Raised when an operation names a letter of guarantee that does not exist. */
export class GuaranteeNotFoundError extends Error {
  readonly code = "GUARANTEE_NOT_FOUND";
  constructor(readonly guaranteeId: string) {
    super(`خطاب الضمان "${guaranteeId}" غير موجود.`);
    this.name = "GuaranteeNotFoundError";
  }
}

/** Raised when a letter fails validation. Reasons are Arabic and reach the screen verbatim. */
export class InvalidGuaranteeError extends Error {
  readonly code = "INVALID_GUARANTEE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidGuaranteeError";
  }
}

/** Raised when a status move is not one the guarantee lifecycle allows. */
export class InvalidGuaranteeTransitionError extends Error {
  readonly code = "INVALID_GUARANTEE_TRANSITION";
  constructor(
    readonly from: GuaranteeStatus,
    readonly to: GuaranteeStatus,
  ) {
    super(`لا يمكن نقل خطاب الضمان من "${getGuaranteeStatusLabel(from)}" إلى "${getGuaranteeStatusLabel(to)}".`);
    this.name = "InvalidGuaranteeTransitionError";
  }
}

/** Raised when an edit is attempted on a letter the bank has already issued. */
export class GuaranteeNotDraftError extends Error {
  readonly code = "GUARANTEE_NOT_DRAFT";
  constructor(
    readonly guaranteeId: string,
    readonly status: GuaranteeStatus,
  ) {
    super(`لا يمكن تعديل خطاب ضمان حالته "${getGuaranteeStatusLabel(status)}" — التعديل مسموح على المسودة فقط.`);
    this.name = "GuaranteeNotDraftError";
  }
}

/** Raised when a reduction (or a call) asks for more than the letter is still worth. */
export class GuaranteeAmountExceedsValueError extends Error {
  readonly code = "GUARANTEE_AMOUNT_EXCEEDS_VALUE";
  constructor(
    readonly guaranteeId: string,
    readonly requested: string,
    readonly available: string,
  ) {
    super(`المبلغ المطلوب (${requested}) يتجاوز القيمة القائمة لخطاب الضمان (${available}).`);
    this.name = "GuaranteeAmountExceedsValueError";
  }
}

/** Raised when the treasury account named is missing, inactive, or not a bank account. */
export class GuaranteeBankAccountInvalidError extends Error {
  readonly code = "GUARANTEE_BANK_ACCOUNT_INVALID";
  constructor(
    readonly treasuryAccountId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "GuaranteeBankAccountInvalidError";
  }
}

/** Raised when a call names a charge account that is not in the chart of accounts. */
export class GuaranteeChargeAccountNotFoundError extends Error {
  readonly code = "GUARANTEE_CHARGE_ACCOUNT_NOT_FOUND";
  constructor(readonly accountId: string) {
    super(`حساب تحميل المصادرة "${accountId}" غير موجود في دليل الحسابات.`);
    this.name = "GuaranteeChargeAccountNotFoundError";
  }
}

export class GuaranteeNothingToReverseError extends Error {
  readonly code = "GUARANTEE_NOTHING_TO_REVERSE";
  readonly messageEn: string;
  constructor(readonly guaranteeId: string) {
    super("لا يوجد على خطاب الضمان قيد قائم يُعكس.");
    this.messageEn = "The letter of guarantee has no standing posting to reverse.";
    this.name = "GuaranteeNothingToReverseError";
  }
}

export class GuaranteePostingFromDocumentError extends Error {
  readonly code = "GUARANTEE_POSTING_FROM_DOCUMENT";
  readonly messageEn: string;
  constructor(
    readonly guaranteeId: string,
    readonly sourceRef: string,
  ) {
    super(`آخر حركة على خطاب الضمان سجّلها المستند ${sourceRef} ولا تُعكس من هنا. ألغِ ذلك المستند من شاشته لتُعكس الحركة معه.`);
    this.messageEn = `The latest movement on this letter of guarantee was made by document ${sourceRef} and is not reversed here. Void that document on its own screen so the movement is reversed with it.`;
    this.name = "GuaranteePostingFromDocumentError";
  }
}
