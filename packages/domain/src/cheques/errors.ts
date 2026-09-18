/** Cheque-register domain errors. Stable `code`s so the api/UI can branch. */

export class ChequeNotFoundError extends Error {
  readonly code = "CHEQUE_NOT_FOUND";
  constructor(readonly chequeId: string) {
    super(`Cheque "${chequeId}" was not found.`);
    this.name = "ChequeNotFoundError";
  }
}

export class DuplicateChequeNumberError extends Error {
  readonly code = "DUPLICATE_CHEQUE_NUMBER";
  constructor(readonly direction: string, readonly chequeNumber: string) {
    super(`A ${direction} cheque numbered "${chequeNumber}" already exists.`);
    this.name = "DuplicateChequeNumberError";
  }
}

/** Raised when an action is attempted from a status that cannot reach the target status. */
export class InvalidChequeTransitionError extends Error {
  readonly code = "INVALID_CHEQUE_TRANSITION";
  constructor(readonly chequeId: string, readonly from: string, readonly to: string) {
    super(`Cheque "${chequeId}" cannot move from "${from}" to "${to}".`);
    this.name = "InvalidChequeTransitionError";
  }
}

/** Raised when `deposit()` is missing the bank treasury account, or `replace()` misses required fields. */
export class InvalidChequeCommandError extends Error {
  readonly code = "INVALID_CHEQUE_COMMAND";
  constructor(message: string) {
    super(message);
    this.name = "InvalidChequeCommandError";
  }
}

/** Raised by `replace()` when the replacement amount does not match the bounced cheque's amount. */
export class ReplacementAmountMismatchError extends Error {
  readonly code = "REPLACEMENT_AMOUNT_MISMATCH";
  constructor(readonly chequeId: string) {
    super(`Replacement cheque amount must equal the bounced cheque "${chequeId}"'s amount.`);
    this.name = "ReplacementAmountMismatchError";
  }
}
