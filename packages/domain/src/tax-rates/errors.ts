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

export class SystemTaxRateOnlyError extends Error {
  readonly code = "TAX_RATE_SYSTEM_ONLY";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
  ) {
    super(
      `الضريبة «${taxRateName}» يسمّيها النظام وحده على مبيعات منشأة أوقفت ضريبة القيمة المضافة، ولا تُختار لبند والضريبة مفعّلة. اختر ضريبة بنسبة 0٪ من ضرائب المنشأة.`,
    );
    this.messageEn = `Tax rate "${taxRateName}" is named only by the system, on the sales of a tenant whose VAT is switched off; it cannot be picked for a line while VAT is on. Pick one of the tenant's own 0% rates.`;
    this.name = "SystemTaxRateOnlyError";
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

export class TaxRateOnCustomerCardsError extends Error {
  readonly code = "TAX_RATE_ON_CUSTOMER_CARDS";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
    readonly customerCount: number,
  ) {
    super(
      `الضريبة «${taxRateName}» مسجّلة ضريبةَ إعفاء على بطاقات ${customerCount} من العملاء، فلا تتغيّر نسبتها أو تصنيفها ولا تُوقف قبل إزالتها من تلك البطاقات.`,
    );
    this.messageEn = `Tax rate "${taxRateName}" is the exemption rate on ${customerCount} customer card(s); clear it from those cards before changing its percent or sub-type or deactivating it.`;
    this.name = "TaxRateOnCustomerCardsError";
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

export class TaxRateClassificationPercentError extends Error {
  readonly code = "TAX_RATE_CLASSIFICATION_PERCENT_MISMATCH";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
    readonly ratePercent: number,
    readonly storedPercent: number,
  ) {
    super(`البند مسجّل بنسبة ${storedPercent}٪ والضريبة «${taxRateName}» نسبتها ${ratePercent}٪. اختر ضريبة بالنسبة نفسها — التصنيف لا يغيّر مبلغ الضريبة.`);
    this.messageEn = `The line is recorded at ${storedPercent}% and tax rate "${taxRateName}" is ${ratePercent}%. Pick a rate at the same percent — classifying never changes the tax amount.`;
    this.name = "TaxRateClassificationPercentError";
  }
}

export class TaxRateAlreadyClassifiedError extends Error {
  readonly code = "TAX_RATE_ALREADY_CLASSIFIED";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly storedTaxRateName: string,
  ) {
    super(`هذا البند مسجّل بالفعل تحت الضريبة «${storedTaxRateName}»، ولا يُعاد تصنيف بند له ضريبة. صحّحه بمرتجع أو إشعار ثم أصدر المستند من جديد.`);
    this.messageEn = `This line is already recorded under tax rate "${storedTaxRateName}", and a classified line cannot be reclassified. Correct it with a return or a credit note, then raise the document again.`;
    this.name = "TaxRateAlreadyClassifiedError";
  }
}

export class ReservedTaxRateError extends Error {
  readonly code = "TAX_RATE_RESERVED";
  readonly messageEn: string;
  constructor(readonly systemTaxRateName: string) {
    super(`الضريبة «${systemTaxRateName}» معرّفة من النظام، ولا تُنشأ ضريبة بمعرّفها أو رمزها أو بالاسم والنسبة والتصنيف نفسها. استخدم ضريبة النظام أو اختر اسماً ورمزاً مختلفين.`);
    this.messageEn = `Tax rate "${systemTaxRateName}" is defined by the system, and no tax rate may take its id or code, or its name, percent and classification together. Use the system rate, or choose a different name and code.`;
    this.name = "ReservedTaxRateError";
  }
}

export class SystemTaxRateLockedError extends Error {
  readonly code = "TAX_RATE_SYSTEM_LOCKED";
  readonly messageEn: string;
  constructor(
    readonly taxRateId: string,
    readonly taxRateName: string,
  ) {
    super(`الضريبة «${taxRateName}» معرّفة من النظام ويسمّيها على مبيعات المنشأة التي أوقفت ضريبة القيمة المضافة، ولا يمكن تعديلها أو إيقافها.`);
    this.messageEn = `Tax rate "${taxRateName}" is defined by the system and named on the sales of a tenant whose VAT is switched off, so it cannot be edited or deactivated.`;
    this.name = "SystemTaxRateLockedError";
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
