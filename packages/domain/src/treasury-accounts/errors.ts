/** Raised when a treasury account code already exists (codes are unique across treasury accounts). */
export class DuplicateTreasuryAccountCodeError extends Error {
  readonly code = "DUPLICATE_TREASURY_ACCOUNT_CODE";
  constructor(readonly accountCode: string) {
    super(`Treasury account code "${accountCode}" already exists.`);
    this.name = "DuplicateTreasuryAccountCodeError";
  }
}

/** Raised when an operation references a treasury account id that does not exist. */
export class TreasuryAccountNotFoundError extends Error {
  readonly code = "TREASURY_ACCOUNT_NOT_FOUND";
  constructor(readonly accountId: string) {
    super(`Treasury account "${accountId}" was not found.`);
    this.name = "TreasuryAccountNotFoundError";
  }
}

/**
 * Raised when a cash-type treasury account would have a negative opening
 * balance. Mirrors the tenant policy documented in docs/archive/catalog/09
 * §"منع الرصيد السالب للحسابات النقدية": cash-drawer accounts can never go
 * negative, while bank accounts are explicitly exempt (overdraft allowed).
 */
export class NegativeCashBalanceError extends Error {
  readonly code = "NEGATIVE_CASH_BALANCE";
  constructor(readonly accountId: string) {
    super(`Cash treasury account "${accountId}" cannot have a negative balance.`);
    this.name = "NegativeCashBalanceError";
  }
}
