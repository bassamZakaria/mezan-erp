/** Bank-reconciliation domain errors. Stable `code`s so the api/UI can branch. */

export class BankStatementNotFoundError extends Error {
  readonly code = "BANK_STATEMENT_NOT_FOUND";
  constructor(readonly statementId: string) {
    super(`Bank statement "${statementId}" was not found.`);
    this.name = "BankStatementNotFoundError";
  }
}

export class StatementLineNotFoundError extends Error {
  readonly code = "STATEMENT_LINE_NOT_FOUND";
  constructor(readonly lineId: string) {
    super(`Statement line "${lineId}" was not found.`);
    this.name = "StatementLineNotFoundError";
  }
}

export class StatementAlreadyFinalizedError extends Error {
  readonly code = "STATEMENT_ALREADY_FINALIZED";
  constructor(readonly statementId: string) {
    super(`Bank statement "${statementId}" is already منتهية (completed).`);
    this.name = "StatementAlreadyFinalizedError";
  }
}

export class LineAlreadyMatchedError extends Error {
  readonly code = "LINE_ALREADY_MATCHED";
  constructor(readonly lineId: string) {
    super(`Statement line "${lineId}" is already matched.`);
    this.name = "LineAlreadyMatchedError";
  }
}

export class LineNotMatchedError extends Error {
  readonly code = "LINE_NOT_MATCHED";
  constructor(readonly lineId: string) {
    super(`Statement line "${lineId}" is not matched.`);
    this.name = "LineNotMatchedError";
  }
}

/**
 * Raised when an imported statement's opening or closing balance is too large
 * in magnitude to be stored exactly. `Money` is a bigint, but the SQLite
 * column it lands in is a JS number, so a value past the safe-integer range
 * cannot round-trip — and a balance that big is a typo, not a real figure.
 * Refusing it here is what keeps the route answering 422 instead of throwing
 * a RangeError at the writer and surfacing as a 500.
 */
export class InvalidStatementBalanceError extends Error {
  readonly code = "INVALID_OPENING_BALANCE";
  constructor(
    readonly statementId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "InvalidStatementBalanceError";
  }
}

/** Raised by the CSV parser/mapper on structurally invalid input. */
export class InvalidStatementFileError extends Error {
  readonly code = "INVALID_STATEMENT_FILE";
  constructor(message: string) {
    super(message);
    this.name = "InvalidStatementFileError";
  }
}

/** Raised when a column mapping names a column absent from the CSV's header row. */
export class ColumnNotFoundError extends Error {
  readonly code = "COLUMN_NOT_FOUND";
  constructor(readonly columnName: string) {
    super(`Column "${columnName}" was not found in the statement file's header row.`);
    this.name = "ColumnNotFoundError";
  }
}

/** Raised when a mapping sets neither `amountColumn` nor both `debitColumn`+`creditColumn`. */
export class InvalidColumnMappingError extends Error {
  readonly code = "INVALID_COLUMN_MAPPING";
  constructor(message: string) {
    super(message);
    this.name = "InvalidColumnMappingError";
  }
}

/**
 * Raised when a statement is finalised while lines are still unmatched and no
 * explicit override was given. An unmatched line is a real difference — a bank
 * charge nobody booked, or a payment the books recorded and the bank did not —
 * and locking the statement over it buries the difference where nothing will
 * find it again (D82).
 */
export class StatementHasUnmatchedLinesError extends Error {
  readonly code = "STATEMENT_HAS_UNMATCHED_LINES";
  constructor(
    readonly statementId: string,
    readonly unmatchedCount: number,
  ) {
    super(
      `Bank statement "${statementId}" still has ${unmatchedCount} unmatched line(s); finalizing needs an explicit override with a reason.`,
    );
    this.name = "StatementHasUnmatchedLinesError";
  }
}

/** Raised when the unmatched-lines override is requested without a reason to record. */
export class FinalizeOverrideReasonRequiredError extends Error {
  readonly code = "FINALIZE_OVERRIDE_REASON_REQUIRED";
  constructor(readonly statementId: string) {
    super(`Finalizing bank statement "${statementId}" over unmatched lines requires a recorded reason.`);
    this.name = "FinalizeOverrideReasonRequiredError";
  }
}
