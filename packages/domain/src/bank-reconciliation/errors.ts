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
