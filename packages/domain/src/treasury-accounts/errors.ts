/** Raised when a treasury account code already exists (codes are unique across treasury accounts). */
export class DuplicateTreasuryAccountCodeError extends Error {
  readonly code = "DUPLICATE_TREASURY_ACCOUNT_CODE";
  readonly messageEn: string;
  constructor(readonly accountCode: string) {
    super(`كود حساب الخزينة "${accountCode}" مستخدم من قبل.`);
    this.messageEn = `Treasury account code "${accountCode}" already exists.`;
    this.name = "DuplicateTreasuryAccountCodeError";
  }
}

/** Raised when an operation references a treasury account id that does not exist. */
export class TreasuryAccountNotFoundError extends Error {
  readonly code = "TREASURY_ACCOUNT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly accountId: string) {
    super(`حساب الخزينة "${accountId}" غير موجود.`);
    this.messageEn = `Treasury account "${accountId}" was not found.`;
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
  readonly messageEn: string;
  constructor(readonly accountId: string) {
    super(`الخزينة النقدية "${accountId}" لا يمكن أن يكون رصيدها سالباً.`);
    this.messageEn = `Cash treasury account "${accountId}" cannot have a negative balance.`;
    this.name = "NegativeCashBalanceError";
  }
}

/**
 * Raised when a guarantee facility limit is negative or too large to be stored
 * exactly. `Money` is a bigint, but the SQLite column it lands in is a JS
 * number, so a value past the safe-integer range cannot round-trip — and a
 * facility limit that big is a typo, not a bank's ceiling. Refusing it here is
 * what keeps the route answering 422 instead of throwing a RangeError at the
 * writer and surfacing as a 500.
 */
export class InvalidGuaranteeFacilityLimitError extends Error {
  readonly code = "INVALID_GUARANTEE_FACILITY_LIMIT";
  constructor(
    readonly accountId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "InvalidGuaranteeFacilityLimitError";
  }
}

/**
 * Raised when an opening balance is too large in magnitude to be stored
 * exactly. `Money` is a bigint, but the SQLite column it lands in is a JS
 * number, so a value past the safe-integer range cannot round-trip — and an
 * opening balance that big is a typo, not a real figure. Refusing it here is
 * what keeps the route answering 422 instead of throwing a RangeError at the
 * writer and surfacing as a 500.
 */
export class InvalidOpeningBalanceError extends Error {
  readonly code = "INVALID_OPENING_BALANCE";
  constructor(
    readonly accountId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "InvalidOpeningBalanceError";
  }
}
