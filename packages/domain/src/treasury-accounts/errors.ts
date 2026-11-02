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
  readonly messageEn: string;
  constructor(
    readonly accountId: string,
    readonly reason: string,
    reasonEn: string,
  ) {
    super(reason);
    this.messageEn = reasonEn;
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
  readonly messageEn: string;
  constructor(
    readonly accountId: string,
    readonly reason: string,
    reasonEn: string,
  ) {
    super(reason);
    this.messageEn = reasonEn;
    this.name = "InvalidOpeningBalanceError";
  }
}

export enum TreasuryAccountFixedField {
  Currency = "currency",
  GlAccount = "glAccountId",
}

const FIXED_FIELD_AR: Record<TreasuryAccountFixedField, string> = {
  [TreasuryAccountFixedField.Currency]: "العملة",
  [TreasuryAccountFixedField.GlAccount]: "حساب الأستاذ",
};

const FIXED_FIELD_EN: Record<TreasuryAccountFixedField, string> = {
  [TreasuryAccountFixedField.Currency]: "currency",
  [TreasuryAccountFixedField.GlAccount]: "ledger account",
};

export class TreasuryAccountHasMovementsError extends Error {
  readonly code = "TREASURY_ACCOUNT_HAS_MOVEMENTS";
  readonly messageEn: string;
  constructor(
    readonly accountId: string,
    readonly fields: readonly TreasuryAccountFixedField[],
  ) {
    super(
      `لا يمكن تغيير ${fields.map((f) => FIXED_FIELD_AR[f]).join(" أو ")} لحساب الخزينة "${accountId}" بعد أن رُحِّلت عليه حركات. أنشئ حساب خزينة جديداً وحوِّل الرصيد إليه.`,
    );
    this.messageEn = `The ${fields.map((f) => FIXED_FIELD_EN[f]).join(" or ")} of treasury account "${accountId}" cannot change once movements are posted to it. Create a new treasury account and transfer the balance.`;
    this.name = "TreasuryAccountHasMovementsError";
  }
}

export class TreasuryGlAccountCurrencyConflictError extends Error {
  readonly code = "TREASURY_GL_ACCOUNT_CURRENCY_CONFLICT";
  readonly messageEn: string;
  constructor(
    readonly glAccountId: string,
    readonly currency: string,
    readonly other: { readonly code: string; readonly currency: string },
  ) {
    super(
      `حساب الأستاذ "${glAccountId}" مربوط بحساب الخزينة "${other.code}" بعملة ${other.currency}، ولا يُربط به حساب خزينة بعملة ${currency}. اختر حساب أستاذ مستقلاً لكل عملة.`,
    );
    this.messageEn = `Ledger account "${glAccountId}" is used by treasury account "${other.code}" in ${other.currency}; a treasury account in ${currency} cannot share it. Use a separate ledger account per currency.`;
    this.name = "TreasuryGlAccountCurrencyConflictError";
  }
}

export function assertGlAccountHoldsOneCurrency(
  candidate: { readonly id: string; readonly glAccountId: string | null; readonly currency: string },
  others: readonly { readonly id: string; readonly code: string; readonly glAccountId: string | null; readonly currency: string }[],
): void {
  if (!candidate.glAccountId) return;
  const clash = others.find((o) => o.id !== candidate.id && o.glAccountId === candidate.glAccountId && o.currency !== candidate.currency);
  if (clash) throw new TreasuryGlAccountCurrencyConflictError(candidate.glAccountId, candidate.currency, { code: clash.code, currency: clash.currency });
}
