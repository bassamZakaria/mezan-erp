/** Raised when a tax code already exists (codes are unique across tax rates). */
export class DuplicateTaxCodeError extends Error {
  readonly code = "DUPLICATE_TAX_CODE";
  constructor(readonly taxCode: string) {
    super(`Tax code "${taxCode}" already exists.`);
    this.name = "DuplicateTaxCodeError";
  }
}

/** Raised when an operation references a tax rate id that does not exist. */
export class TaxRateNotFoundError extends Error {
  readonly code = "TAX_RATE_NOT_FOUND";
  constructor(readonly taxRateId: string) {
    super(`Tax rate "${taxRateId}" was not found.`);
    this.name = "TaxRateNotFoundError";
  }
}

/** Raised when the rate percentage is outside the valid 0–100 range. */
export class InvalidTaxRateError extends Error {
  readonly code = "INVALID_TAX_RATE";
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaxRateError";
  }
}
