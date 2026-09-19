/** Raised when a tax code already exists (codes are unique across tax rates). */
export class DuplicateTaxCodeError extends Error {
  readonly code = "DUPLICATE_TAX_CODE";
  readonly messageEn: string;
  constructor(readonly taxCode: string) {
    super(`رمز الضريبة "${taxCode}" مستخدم من قبل.`);
    this.messageEn = `Tax code "${taxCode}" already exists.`;
    this.name = "DuplicateTaxCodeError";
  }
}

/** Raised when an operation references a tax rate id that does not exist. */
export class TaxRateNotFoundError extends Error {
  readonly code = "TAX_RATE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly taxRateId: string) {
    super(`الضريبة "${taxRateId}" غير موجودة.`);
    this.messageEn = `Tax rate "${taxRateId}" was not found.`;
    this.name = "TaxRateNotFoundError";
  }
}

/** Raised when the rate percentage is outside the valid 0–100 range. */
export class InvalidTaxRateError extends Error {
  readonly code = "INVALID_TAX_RATE";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidTaxRateError";
  }
}

/** Raised when a tax group is structurally invalid (R6.4). */
export class InvalidTaxGroupError extends Error {
  readonly code = "INVALID_TAX_GROUP";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidTaxGroupError";
  }
}

/** Raised when an operation references a tax group id that does not exist. */
export class TaxGroupNotFoundError extends Error {
  readonly code = "TAX_GROUP_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly taxGroupId: string) {
    super(`مجموعة الضرائب "${taxGroupId}" غير موجودة.`);
    this.messageEn = `Tax group "${taxGroupId}" was not found.`;
    this.name = "TaxGroupNotFoundError";
  }
}
