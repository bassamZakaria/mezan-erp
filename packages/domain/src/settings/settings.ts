/**
 * Tenant Settings — the config bag documented in docs/archive/catalog/09 §"Settings —
 * عام (General settings hub)": the `/settings` tabbed screen (عام / بيانات
 * المنشأة / الضريبة / الرقابة الائتمانية / سياسة المخزون / التحكم في
 * المشتريات / سياسة الخزينة) plus the raw tenant `settings` payload captured
 * from `/api/auth/me`. Fields are transcribed from that catalog, not invented.
 *
 * This is a pure domain module: no I/O, no framework types. `updateSettings`
 * is the one write path and enforces every numeric/enum invariant the catalog
 * documents (e.g. "allowed range 7–365" for the contract-expiry warning), so
 * an invalid patch can never reach persistence.
 */

export type TaxCalculationMode = "EXCLUSIVE" | "INCLUSIVE";
export type CreditControlMode = "WARNING" | "BLOCK";
export type FxRateMissingPolicy = "STRICT" | "ALLOW_MISSING";
export type DepreciationProrateMode = "DAILY" | "FULL_MONTH";
export type NumeralSystem = "western" | "arabic";
export type UiDirection = "LTR" | "RTL";
export type SettingsLanguage = "ar" | "en" | "de";
export type SmtpSecurity = "NONE" | "STARTTLS" | "TLS";
/** Mirrors `PayrollDayDivisorBasis` in hr/payroll-run.ts; settings must not import hr. */
export type PayrollDayDivisorBasisSetting = "FIXED_30" | "CALENDAR_DAYS";

export interface TenantSettings {
  // --- عام (General / localization) ---
  readonly currency: string;
  readonly secondaryCurrencies: readonly string[];
  readonly language: SettingsLanguage;
  readonly timezone: string;
  readonly direction: UiDirection;
  readonly dateFormat: string;
  readonly dateNumerals: NumeralSystem;
  readonly weekendDays: readonly number[];
  readonly fiscalYearStartMonth: number;
  readonly fxRateMissingPolicy: FxRateMissingPolicy;
  readonly multiCurrencyEnabled: boolean;

  /**
   * When this tenant was CLAIMED — the ISO timestamp `POST /bootstrap/admin`
   * wrote the first time it succeeded, or null on an install nobody has set up.
   *
   * A FACT, not a derivation. Claimed-ness used to be inferred as "some active
   * account exists whose email is not the seed admin's", and both halves of
   * that predicate are editable master data: deactivate the last non-seed
   * account (which a company admin may do to another company admin — they do
   * not outrank each other) or rename an email, and a fully provisioned tenant
   * reads as unclaimed again. An anonymous POST then returned a live
   * `permissions: ["*"]` session over the LAN socket, against real books. A
   * seasonal shop that deactivates every staff account over a closure reached
   * the same state without anybody meaning to.
   *
   * Written once and never cleared. Deliberately absent from the settings wire
   * contract, so no `PUT /settings` can reach it.
   */
  readonly tenantClaimedAt: string | null;

  // --- بيانات المنشأة (Company info) ---
  readonly weekStartDay: number;
  readonly companyName: string;
  readonly taxRegistrationNumber: string;
  readonly commercialRegistrationNumber: string;
  readonly phone: string;
  readonly email: string;
  /**
   * Domains a user account's email may belong to — the login is the email, so
   * this is who is allowed to have an account at all.
   *
   * EMPTY MEANS NO RESTRICTION, deliberately. A company is not blocked on day
   * one of a rollout by a policy nobody has configured yet; the owner turns it
   * on by naming a domain. Stored lower-cased and without a leading "@".
   */
  readonly allowedEmailDomains: readonly string[];
  readonly address: string;
  readonly hrContractExpiryWarningDays: number;
  /**
   * أساس قسمة اليوم — how a monthly salary breaks into a day's pay. FIXED_30 is
   * the Egyptian convention (a day is always salary/30); CALENDAR_DAYS uses the
   * month's real length. Payroll reads it per calculation to price a day of
   * unpaid leave.
   *
   * There is deliberately no overtime-multiplier setting: overtime premiums are
   * statute, not tenant preference.
   */
  readonly payrollDayDivisorBasis: PayrollDayDivisorBasisSetting;
  readonly standardDailyWorkHours: number;

  // --- الضريبة (Tax) ---
  readonly taxEnabled: boolean;
  readonly defaultTaxRate: number;
  readonly taxCalculation: TaxCalculationMode;
  readonly depreciationProrate: DepreciationProrateMode;

  // --- الرقابة الائتمانية (Credit control) ---
  readonly priceListsEnabled: boolean;
  readonly creditControlEnabled: boolean;
  readonly creditControlMode: CreditControlMode;
  /**
   * The line discount a salesperson may give unaided, as a percent. Above it
   * the caller must additionally hold `sales.discount.approve` — the permission
   * existed in the catalogue and was enforced nowhere, so a rep with plain
   * invoice-create could discount a line to nothing.
   *
   * Defaults to 100: the ceiling ships OFF, because one company's idea of a
   * safe discount is not another's and a silently-imposed limit would refuse
   * documents a tenant has always been allowed to raise. What does NOT depend
   * on it is a giveaway — a 100% discount, or a zero unit price — which always
   * requires the elevated permission.
   */
  readonly maxLineDiscountPercent: number;

  // --- المقاولات (Contracting) ---
  /**
   * سعر الائتمان والخصم المعلن من البنك المركزي, as a percent. Law 182/2018
   * Art. 45 compensates a contractor for a public employer's late payment at
   * this rate, and almost no contractor ever invoices it. NULL means the
   * tenant has not set it: the certificate screen then says «غير مُعد» and
   * reports zero rather than inventing a rate.
   */
  readonly contractingCbeCreditDiscountRatePercent: number | null;
  /**
   * وضع المشغّل الواحد. FALSE by default: فصل المهام on a مستخلص — preparer ≠
   * certifier ≠ approver — is enforced against EVERYONE, the tenant admin
   * holding the `"*"` wildcard included. A genuinely one-person install turns
   * this on and the admin may sign every step; every other tenant leaves it
   * off, and the admin bypass that used to be unconditional is gone.
   */
  readonly contractingSingleOperatorMode: boolean;

  // --- سياسة المخزون (Inventory policy) ---
  readonly allowCrossWarehouseSales: boolean;
  readonly showOtherWarehouseStock: boolean;
  readonly allowBackorder: boolean;
  readonly allowNegativeStock: boolean;
  readonly agingWritedownEnabled: boolean;
  readonly agingWritedownMonths: number;
  readonly agingWritedownRatePercent: number;
  readonly autoGenerateBatchNumbers: boolean;

  // --- التحكم في المشتريات (Purchase control) ---
  readonly requirePoForGrn: boolean;
  readonly requireGrnForInvoice: boolean;
  readonly trackSoldPurchaseItems: boolean;

  // --- سياسة الخزينة (Treasury policy) ---
  readonly preventNegativeCashBalance: boolean;
  readonly allowNegativeTreasury: boolean;

  // --- البريد الإلكتروني (Outgoing mail) ---
  readonly smtpEnabled: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecurity: SmtpSecurity;
  readonly smtpUsername: string;
  readonly smtpPassword: string;
  readonly smtpFromName: string;
  readonly smtpFromEmail: string;
  readonly emailTemplateSubject: string;
  readonly emailTemplateBody: string;
}

export class InvalidSettingsError extends Error {
  readonly code = "INVALID_SETTINGS";
  constructor(reasons: readonly string[]) {
    super(`Invalid settings: ${reasons.join("; ")}`);
    this.name = "InvalidSettingsError";
  }
}

const TAX_CALCULATION_MODES: readonly TaxCalculationMode[] = ["EXCLUSIVE", "INCLUSIVE"];
const CREDIT_CONTROL_MODES: readonly CreditControlMode[] = ["WARNING", "BLOCK"];
const FX_RATE_MISSING_POLICIES: readonly FxRateMissingPolicy[] = ["STRICT", "ALLOW_MISSING"];
const DEPRECIATION_PRORATE_MODES: readonly DepreciationProrateMode[] = ["DAILY", "FULL_MONTH"];
const PAYROLL_DAY_DIVISOR_BASES: readonly PayrollDayDivisorBasisSetting[] = ["FIXED_30", "CALENDAR_DAYS"];
const NUMERAL_SYSTEMS: readonly NumeralSystem[] = ["western", "arabic"];
const UI_DIRECTIONS: readonly UiDirection[] = ["LTR", "RTL"];
const LANGUAGES: readonly SettingsLanguage[] = ["ar", "en", "de"];
const SMTP_SECURITIES: readonly SmtpSecurity[] = ["NONE", "STARTTLS", "TLS"];

/**
 * Defaults mirroring the captured tenant payload (docs/archive/catalog/09 lines
 * 44-115), minus the couple of fields the catalog flags as platform-managed
 * (multi-currency activation itself, WAC drift knobs) which are out of this
 * tenant-settings surface.
 */
export const DEFAULT_SETTINGS: TenantSettings = {
  currency: "EGP",
  secondaryCurrencies: ["SAR", "USD", "AED", "EUR", "KWD", "QAR", "JOD"],
  language: "ar",
  timezone: "Africa/Cairo",
  direction: "RTL",
  dateFormat: "DD/MM/YYYY",
  dateNumerals: "western",
  weekendDays: [5, 6],
  fiscalYearStartMonth: 1,
  fxRateMissingPolicy: "STRICT",
  multiCurrencyEnabled: false,

  tenantClaimedAt: null,
  weekStartDay: 6,
  companyName: "",
  taxRegistrationNumber: "",
  commercialRegistrationNumber: "",
  phone: "",
  email: "",
  allowedEmailDomains: [],
  address: "",
  hrContractExpiryWarningDays: 30,
  payrollDayDivisorBasis: "FIXED_30",
  standardDailyWorkHours: 8,

  taxEnabled: true,
  defaultTaxRate: 14,
  taxCalculation: "EXCLUSIVE",
  depreciationProrate: "DAILY",

  priceListsEnabled: true,
  creditControlEnabled: false,
  creditControlMode: "WARNING",
  maxLineDiscountPercent: 100,
  contractingCbeCreditDiscountRatePercent: null,
  contractingSingleOperatorMode: false,

  allowCrossWarehouseSales: true,
  showOtherWarehouseStock: true,
  allowBackorder: false,
  allowNegativeStock: false,
  agingWritedownEnabled: false,
  agingWritedownMonths: 6,
  agingWritedownRatePercent: 25,
  autoGenerateBatchNumbers: false,

  requirePoForGrn: false,
  requireGrnForInvoice: false,
  trackSoldPurchaseItems: true,

  preventNegativeCashBalance: true,
  allowNegativeTreasury: true,

  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecurity: "STARTTLS",
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "",
  smtpFromEmail: "",
  emailTemplateSubject: "{{documentType}} رقم {{documentNumber}} من {{companyName}}",
  emailTemplateBody:
    "السلام عليكم {{recipientName}}،\n\nمرفق {{documentType}} رقم {{documentNumber}} بتاريخ {{documentDate}} بإجمالي {{documentTotal}}.\n\nمع خالص الشكر،\n{{companyName}}",
};

function validate(settings: TenantSettings): string[] {
  const reasons: string[] = [];

  if (!/^[A-Z]{3}$/.test(settings.currency)) {
    reasons.push("currency must be a 3-letter uppercase ISO 4217 code");
  }
  for (const code of settings.secondaryCurrencies) {
    if (!/^[A-Z]{3}$/.test(code)) {
      reasons.push(`secondaryCurrencies contains an invalid code: "${code}"`);
    }
  }
  if (!LANGUAGES.includes(settings.language)) {
    reasons.push(`language must be one of ${LANGUAGES.join(", ")}`);
  }
  if (!UI_DIRECTIONS.includes(settings.direction)) {
    reasons.push(`direction must be one of ${UI_DIRECTIONS.join(", ")}`);
  }
  if (!NUMERAL_SYSTEMS.includes(settings.dateNumerals)) {
    reasons.push(`dateNumerals must be one of ${NUMERAL_SYSTEMS.join(", ")}`);
  }
  const uniqueWeekendDays = new Set(settings.weekendDays);
  if (
    uniqueWeekendDays.size !== settings.weekendDays.length ||
    settings.weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    reasons.push("weekendDays must be unique integers in 0..6");
  }
  if (!Number.isInteger(settings.fiscalYearStartMonth) || settings.fiscalYearStartMonth < 1 || settings.fiscalYearStartMonth > 12) {
    reasons.push("fiscalYearStartMonth must be an integer in 1..12");
  }
  if (!FX_RATE_MISSING_POLICIES.includes(settings.fxRateMissingPolicy)) {
    reasons.push(`fxRateMissingPolicy must be one of ${FX_RATE_MISSING_POLICIES.join(", ")}`);
  }

  if (
    !Number.isInteger(settings.hrContractExpiryWarningDays) ||
    settings.hrContractExpiryWarningDays < 7 ||
    settings.hrContractExpiryWarningDays > 365
  ) {
    reasons.push("hrContractExpiryWarningDays must be an integer in 7..365");
  }
  if (!PAYROLL_DAY_DIVISOR_BASES.includes(settings.payrollDayDivisorBasis)) {
    reasons.push("payrollDayDivisorBasis must be FIXED_30 or CALENDAR_DAYS");
  }
  if (settings.standardDailyWorkHours <= 0 || settings.standardDailyWorkHours > 24) {
    reasons.push("standardDailyWorkHours must be in (0, 24]");
  }

  if (settings.defaultTaxRate < 0 || settings.defaultTaxRate > 100) {
    reasons.push("defaultTaxRate must be in 0..100");
  }
  if (!TAX_CALCULATION_MODES.includes(settings.taxCalculation)) {
    reasons.push(`taxCalculation must be one of ${TAX_CALCULATION_MODES.join(", ")}`);
  }
  if (!DEPRECIATION_PRORATE_MODES.includes(settings.depreciationProrate)) {
    reasons.push(`depreciationProrate must be one of ${DEPRECIATION_PRORATE_MODES.join(", ")}`);
  }
  if (!CREDIT_CONTROL_MODES.includes(settings.creditControlMode)) {
    reasons.push(`creditControlMode must be one of ${CREDIT_CONTROL_MODES.join(", ")}`);
  }

  if (!Number.isInteger(settings.weekStartDay) || settings.weekStartDay < 0 || settings.weekStartDay > 6) {
    reasons.push("weekStartDay must be an integer in 0..6");
  }
  for (const domain of settings.allowedEmailDomains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      reasons.push(`allowedEmailDomains contains an invalid domain: "${domain}"`);
    }
  }
  if (settings.multiCurrencyEnabled && settings.secondaryCurrencies.length === 0) {
    reasons.push("multiCurrencyEnabled needs at least one additional currency");
  }
  if (settings.secondaryCurrencies.includes(settings.currency)) {
    reasons.push("secondaryCurrencies must not repeat the base currency");
  }

  if (
    !Number.isInteger(settings.agingWritedownMonths) ||
    settings.agingWritedownMonths < 1 ||
    settings.agingWritedownMonths > 60
  ) {
    reasons.push("agingWritedownMonths must be an integer in 1..60");
  }
  if (settings.maxLineDiscountPercent < 0 || settings.maxLineDiscountPercent > 100) {
    reasons.push("maxLineDiscountPercent must be in 0..100");
  }
  if (
    settings.contractingCbeCreditDiscountRatePercent !== null &&
    (settings.contractingCbeCreditDiscountRatePercent < 0 || settings.contractingCbeCreditDiscountRatePercent > 100)
  ) {
    reasons.push("contractingCbeCreditDiscountRatePercent must be in 0..100");
  }
  if (settings.agingWritedownRatePercent < 0 || settings.agingWritedownRatePercent > 100) {
    reasons.push("agingWritedownRatePercent must be in 0..100");
  }
  if (settings.agingWritedownEnabled && settings.agingWritedownRatePercent <= 0) {
    reasons.push("agingWritedownEnabled needs a rate greater than 0");
  }

  if (!SMTP_SECURITIES.includes(settings.smtpSecurity)) {
    reasons.push(`smtpSecurity must be one of ${SMTP_SECURITIES.join(", ")}`);
  }
  if (!Number.isInteger(settings.smtpPort) || settings.smtpPort < 1 || settings.smtpPort > 65535) {
    reasons.push("smtpPort must be an integer in 1..65535");
  }
  if (settings.smtpEnabled) {
    if (settings.smtpHost.trim() === "") reasons.push("smtpEnabled needs an SMTP host");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.smtpFromEmail)) {
      reasons.push("smtpEnabled needs a valid sender address");
    }
  }

  return reasons;
}

/** Builds a `TenantSettings`, applying `overrides` on top of the catalog defaults. */
export function createDefaultSettings(overrides: Partial<TenantSettings> = {}): TenantSettings {
  const settings: TenantSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const reasons = validate(settings);
  if (reasons.length > 0) throw new InvalidSettingsError(reasons);
  return settings;
}

/**
 * The single write path for tenant settings: merges `patch` onto `current`
 * and re-validates the whole object (a patch can never produce an invalid
 * combination, e.g. a tax rate of 140).
 */
export function updateSettings(current: TenantSettings, patch: Partial<TenantSettings>): TenantSettings {
  const next: TenantSettings = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidSettingsError(reasons);
  return next;
}
