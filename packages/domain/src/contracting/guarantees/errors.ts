import { splitReasons, type ReasonInput } from "../../bilingual-reasons.js";
import { getGuaranteeStatusLabel, type GuaranteeStatus } from "./guarantee.js";

const GUARANTEE_STATUS_EN: Readonly<Record<GuaranteeStatus, string>> = {
  draft: "Draft",
  active: "Active",
  reduced: "Reduced",
  released: "Released",
  called: "Called",
  expired: "Expired",
};

/** Raised when an operation names a letter of guarantee that does not exist. */
export class GuaranteeNotFoundError extends Error {
  readonly code = "GUARANTEE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly guaranteeId: string) {
    super(`خطاب الضمان "${guaranteeId}" غير موجود.`);
    this.messageEn = `Letter of guarantee "${guaranteeId}" was not found.`;
    this.name = "GuaranteeNotFoundError";
  }
}

/** Raised when a letter fails validation. Reasons are Arabic and reach the screen verbatim. */
export class InvalidGuaranteeError extends Error {
  readonly code = "INVALID_GUARANTEE";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The letter of guarantee failed validation.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidGuaranteeError";
  }
}

/** Raised when a status move is not one the guarantee lifecycle allows. */
export class InvalidGuaranteeTransitionError extends Error {
  readonly code = "INVALID_GUARANTEE_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: GuaranteeStatus,
    readonly to: GuaranteeStatus,
  ) {
    super(`لا يمكن نقل خطاب الضمان من "${getGuaranteeStatusLabel(from)}" إلى "${getGuaranteeStatusLabel(to)}".`);
    this.messageEn = `A letter of guarantee cannot move from "${GUARANTEE_STATUS_EN[from]}" to "${GUARANTEE_STATUS_EN[to]}".`;
    this.name = "InvalidGuaranteeTransitionError";
  }
}

/** Raised when an edit is attempted on a letter the bank has already issued. */
export class GuaranteeNotDraftError extends Error {
  readonly code = "GUARANTEE_NOT_DRAFT";
  readonly messageEn: string;
  constructor(
    readonly guaranteeId: string,
    readonly status: GuaranteeStatus,
  ) {
    super(`لا يمكن تعديل خطاب ضمان حالته "${getGuaranteeStatusLabel(status)}" — التعديل مسموح على المسودة فقط.`);
    this.messageEn = `A letter of guarantee with status "${GUARANTEE_STATUS_EN[status]}" cannot be edited — editing is allowed on drafts only.`;
    this.name = "GuaranteeNotDraftError";
  }
}

/** Raised when a reduction (or a call) asks for more than the letter is still worth. */
export class GuaranteeAmountExceedsValueError extends Error {
  readonly code = "GUARANTEE_AMOUNT_EXCEEDS_VALUE";
  readonly messageEn: string;
  constructor(
    readonly guaranteeId: string,
    readonly requested: string,
    readonly available: string,
  ) {
    super(`المبلغ المطلوب (${requested}) يتجاوز القيمة القائمة لخطاب الضمان (${available}).`);
    this.messageEn = `The requested amount (${requested}) exceeds the outstanding value of the letter of guarantee (${available}).`;
    this.name = "GuaranteeAmountExceedsValueError";
  }
}

/** Raised when the treasury account named is missing, inactive, or not a bank account. */
export class GuaranteeBankAccountInvalidError extends Error {
  readonly code = "GUARANTEE_BANK_ACCOUNT_INVALID";
  readonly messageEn: string;
  constructor(
    readonly treasuryAccountId: string,
    readonly reason: string,
    reasonEn = "The treasury account chosen for the letter of guarantee is missing, inactive or not a bank account.",
  ) {
    super(reason);
    this.messageEn = reasonEn;
    this.name = "GuaranteeBankAccountInvalidError";
  }
}

/** Raised when a call names a charge account that is not in the chart of accounts. */
export class GuaranteeChargeAccountNotFoundError extends Error {
  readonly code = "GUARANTEE_CHARGE_ACCOUNT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly accountId: string) {
    super(`حساب تحميل المصادرة "${accountId}" غير موجود في دليل الحسابات.`);
    this.messageEn = `The forfeiture charge account "${accountId}" is not in the chart of accounts.`;
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
