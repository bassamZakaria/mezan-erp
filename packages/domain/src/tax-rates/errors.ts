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

export class DuplicateTaxRateIdError extends Error {
  readonly code = "TAX_RATE_ID_EXISTS";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
  ) {
    super(`توجد ضريبة بالمعرّف نفسه بالفعل («${taxRateName}»). عدّلها من شاشة الضرائب أو أنشئ ضريبة بمعرّف جديد.`);
    this.messageEn = `A tax rate with this id already exists ("${taxRateName}"). Edit it from Tax Rates, or create one under a new id.`;
    this.name = "DuplicateTaxRateIdError";
  }
}

export class InactiveTaxRateError extends Error {
  readonly code = "TAX_RATE_INACTIVE";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
  ) {
    super(`الضريبة «${taxRateName}» غير مفعّلة ولا يمكن استخدامها في مستند جديد.`);
    this.messageEn = `Tax rate "${taxRateName}" is inactive and cannot be used on a new document.`;
    this.name = "InactiveTaxRateError";
  }
}

export class TaxRatePercentMismatchError extends Error {
  readonly code = "TAX_RATE_PERCENT_MISMATCH";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
    readonly ratePercent: number,
    readonly claimedPercent: number,
  ) {
    super(`نسبة الضريبة المرسلة (${claimedPercent}٪) لا تطابق نسبة الضريبة «${taxRateName}» (${ratePercent}٪).`);
    this.messageEn = `The submitted tax percent (${claimedPercent}%) does not match tax rate "${taxRateName}" (${ratePercent}%).`;
    this.name = "TaxRatePercentMismatchError";
  }
}

export class TaxRateUnverifiableError extends Error {
  readonly code = "TAX_RATE_UNVERIFIABLE";
  readonly messageEn: string;
  constructor(readonly taxRateId: string) {
    super(`تعذّر التحقق من الضريبة "${taxRateId}": دليل الضرائب غير متاح لهذا المستند.`);
    this.messageEn = `Tax rate "${taxRateId}" could not be verified: no tax rate master is available to this document.`;
    this.name = "TaxRateUnverifiableError";
  }
}

export class TaxRateInUseError extends Error {
  readonly code = "TAX_RATE_IN_USE";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
  ) {
    super(
      `لا يمكن تغيير نسبة الضريبة «${taxRateName}» أو تصنيفها لدى المصلحة لأنها مستخدمة في مستندات مسجّلة. أنشئ ضريبة جديدة بالقيم المطلوبة ثم أوقف هذه.`,
    );
    this.messageEn = `Tax rate "${taxRateName}" is used by recorded documents, so its percent and ETA sub-type cannot change. Create a new tax rate with the values you need, then deactivate this one.`;
    this.name = "TaxRateInUseError";
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
