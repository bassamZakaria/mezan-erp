/** Cheque-register domain errors. Stable `code`s so the api/UI can branch. */

export class ChequeNotFoundError extends Error {
  readonly code = "CHEQUE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly chequeId: string) {
    super(`الشيك "${chequeId}" غير موجود.`);
    this.messageEn = `Cheque "${chequeId}" was not found.`;
    this.name = "ChequeNotFoundError";
  }
}

const CHEQUE_DIRECTION_AR: Readonly<Record<string, string>> = {
  incoming: "وارد",
  outgoing: "صادر",
};

function chequeDirectionAr(direction: string): string {
  return CHEQUE_DIRECTION_AR[direction] ?? direction;
}

export class DuplicateChequeNumberError extends Error {
  readonly code = "DUPLICATE_CHEQUE_NUMBER";
  readonly messageEn: string;
  constructor(readonly direction: string, readonly chequeNumber: string) {
    super(`يوجد بالفعل شيك ${chequeDirectionAr(direction)} برقم "${chequeNumber}".`);
    this.messageEn = `A ${direction} cheque numbered "${chequeNumber}" already exists.`;
    this.name = "DuplicateChequeNumberError";
  }
}

/** Raised when an action is attempted from a status that cannot reach the target status. */
export class InvalidChequeTransitionError extends Error {
  readonly code = "INVALID_CHEQUE_TRANSITION";
  readonly messageEn: string;
  constructor(readonly chequeId: string, readonly from: string, readonly to: string) {
    super(`الشيك "${chequeId}" لا يمكن أن ينتقل من "${from}" إلى "${to}".`);
    this.messageEn = `Cheque "${chequeId}" cannot move from "${from}" to "${to}".`;
    this.name = "InvalidChequeTransitionError";
  }
}

/** Raised when `deposit()` is missing the bank treasury account, or `replace()` misses required fields. */
export class InvalidChequeCommandError extends Error {
  readonly code = "INVALID_CHEQUE_COMMAND";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidChequeCommandError";
  }
}

/** Raised by `replace()` when the replacement amount does not match the bounced cheque's amount. */
export class ReplacementAmountMismatchError extends Error {
  readonly code = "REPLACEMENT_AMOUNT_MISMATCH";
  readonly messageEn: string;
  constructor(readonly chequeId: string) {
    super(`مبلغ الشيك البديل يجب أن يساوي مبلغ الشيك المرتد "${chequeId}".`);
    this.messageEn = `Replacement cheque amount must equal the bounced cheque "${chequeId}"'s amount.`;
    this.name = "ReplacementAmountMismatchError";
  }
}
