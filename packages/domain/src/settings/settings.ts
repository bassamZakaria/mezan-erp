import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { BilingualReason } from "../collections/errors.js";
import { DEFAULT_STATEMENT_EMAIL_BODY, DEFAULT_STATEMENT_EMAIL_SUBJECT } from "../collections/statement.js";
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

export enum TaxCalculationModeCode {
  Exclusive = "EXCLUSIVE",
  Inclusive = "INCLUSIVE",
}
export type TaxCalculationMode = `${TaxCalculationModeCode}`;
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
  readonly periodCloseSingleOperatorMode: boolean;

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
  readonly overReceiptTolerancePercent: number;

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

/** SECURITY: these values become mail headers; a CR or LF would let them add a header of their own. */
const HEADER_BREAK = /[\u0000-\u001f\u007f]/;

export class InvalidSettingsError extends Error {
  readonly code = "INVALID_SETTINGS";
  readonly reasons: string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the details are not valid");
    super(`الإعدادات غير صالحة: ${split.ar.join("؛ ")}`);
    this.reasons = [...split.ar];
    this.messageEn = `Invalid settings: ${split.en}`;
    this.name = "InvalidSettingsError";
  }
}

const TAX_CALCULATION_MODES: readonly TaxCalculationMode[] = Object.values(TaxCalculationModeCode);
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
  periodCloseSingleOperatorMode: false,

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
  overReceiptTolerancePercent: 0,

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
  emailTemplateSubject: DEFAULT_STATEMENT_EMAIL_SUBJECT,
  emailTemplateBody: DEFAULT_STATEMENT_EMAIL_BODY,
};

function validate(settings: TenantSettings): BilingualReason[] {
  const reasons: BilingualReason[] = [];

  if (!/^[A-Z]{3}$/.test(settings.currency)) {
    reasons.push({ ar: "العملة الأساسية يجب أن تكون رمز ISO 4217 من ثلاثة أحرف لاتينية كبيرة", en: "The base currency must be a 3-letter uppercase ISO 4217 code" });
  }
  for (const code of settings.secondaryCurrencies) {
    if (!/^[A-Z]{3}$/.test(code)) {
      reasons.push({ ar: `العملات الثانوية تحتوي رمزاً غير صالح: "${code}"`, en: `The secondary currencies include an invalid code: "${code}"` });
    }
  }
  if (!LANGUAGES.includes(settings.language)) {
    reasons.push({ ar: "اللغة يجب أن تكون العربية أو الإنجليزية أو الألمانية.", en: "The language must be Arabic, English or German." });
  }
  if (!UI_DIRECTIONS.includes(settings.direction)) {
    reasons.push({ ar: "اتجاه الواجهة يجب أن يكون من اليمين إلى اليسار أو من اليسار إلى اليمين.", en: "The interface direction must be right-to-left or left-to-right." });
  }
  if (!NUMERAL_SYSTEMS.includes(settings.dateNumerals)) {
    reasons.push({ ar: "أرقام التواريخ يجب أن تكون غربية (1، 2، 3) أو عربية (١، ٢، ٣).", en: "The date numerals must be Western (1, 2, 3) or Arabic-Indic (١, ٢, ٣)." });
  }
  const uniqueWeekendDays = new Set(settings.weekendDays);
  if (
    uniqueWeekendDays.size !== settings.weekendDays.length ||
    settings.weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    reasons.push({ ar: "أيام العطلة الأسبوعية يجب أن تكون أعداداً صحيحة غير مكررة بين 0 و6", en: "The weekend days must be different whole numbers from 0 to 6" });
  }
  if (!Number.isInteger(settings.fiscalYearStartMonth) || settings.fiscalYearStartMonth < 1 || settings.fiscalYearStartMonth > 12) {
    reasons.push({ ar: "شهر بداية السنة المالية يجب أن يكون عدداً صحيحاً بين 1 و12", en: "The fiscal year start month must be a whole number from 1 to 12" });
  }
  if (!FX_RATE_MISSING_POLICIES.includes(settings.fxRateMissingPolicy)) {
    reasons.push({ ar: "سياسة غياب سعر الصرف يجب أن تكون إيقاف العملية أو السماح بالمتابعة.", en: "The missing exchange rate policy must be to stop the operation or to allow it to continue." });
  }

  if (
    !Number.isInteger(settings.hrContractExpiryWarningDays) ||
    settings.hrContractExpiryWarningDays < 7 ||
    settings.hrContractExpiryWarningDays > 365
  ) {
    reasons.push({ ar: "أيام التنبيه قبل انتهاء عقد الموظف يجب أن تكون عدداً صحيحاً بين 7 و365", en: "The days of notice before an employee contract expires must be a whole number from 7 to 365" });
  }
  if (!PAYROLL_DAY_DIVISOR_BASES.includes(settings.payrollDayDivisorBasis)) {
    reasons.push({ ar: "أساس قسمة أجر اليوم يجب أن يكون ثلاثين يوماً ثابتة أو أيام الشهر الفعلية.", en: "The daily wage divisor must be a fixed 30 days or the actual days of the month." });
  }
  if (settings.standardDailyWorkHours <= 0 || settings.standardDailyWorkHours > 24) {
    reasons.push({ ar: "ساعات العمل اليومية القياسية يجب أن تكون أكبر من صفر وحتى 24", en: "The standard daily work hours must be more than 0 and at most 24" });
  }

  if (settings.defaultTaxRate < 0 || settings.defaultTaxRate > 100) {
    reasons.push({ ar: "نسبة الضريبة الافتراضية يجب أن تكون بين 0 و100", en: "The default tax rate must be between 0 and 100" });
  }
  if (!TAX_CALCULATION_MODES.includes(settings.taxCalculation)) {
    reasons.push({ ar: "طريقة احتساب الضريبة يجب أن تكون ضريبة مضافة على السعر أو ضريبة مشمولة في السعر.", en: "The tax calculation method must be tax added to the price or tax included in the price." });
  }
  if (!DEPRECIATION_PRORATE_MODES.includes(settings.depreciationProrate)) {
    reasons.push({ ar: "طريقة تقسيم الإهلاك يجب أن تكون بالأيام أو بالشهر الكامل.", en: "The depreciation proration must be by day or by full month." });
  }
  if (!CREDIT_CONTROL_MODES.includes(settings.creditControlMode)) {
    reasons.push({ ar: "وضع رقابة الائتمان يجب أن يكون تنبيهاً أو منعاً.", en: "The credit control mode must be warn or block." });
  }

  if (!Number.isInteger(settings.weekStartDay) || settings.weekStartDay < 0 || settings.weekStartDay > 6) {
    reasons.push({ ar: "أول يوم في الأسبوع يجب أن يكون عدداً صحيحاً بين 0 و6", en: "The first day of the week must be a whole number from 0 to 6" });
  }
  for (const domain of settings.allowedEmailDomains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      reasons.push({ ar: `نطاقات البريد المسموحة تحتوي نطاقاً غير صالح: "${domain}"`, en: `The allowed email domains include an invalid domain: "${domain}"` });
    }
  }
  if (settings.multiCurrencyEnabled && settings.secondaryCurrencies.length === 0) {
    reasons.push({ ar: "تعدد العملات يتطلب عملة إضافية واحدة على الأقل", en: "Multi-currency needs at least one additional currency" });
  }
  if (settings.secondaryCurrencies.includes(settings.currency)) {
    reasons.push({ ar: "العملات الثانوية يجب ألا تكرر العملة الأساسية", en: "The secondary currencies must not include the base currency" });
  }

  if (
    !Number.isInteger(settings.agingWritedownMonths) ||
    settings.agingWritedownMonths < 1 ||
    settings.agingWritedownMonths > 60
  ) {
    reasons.push({ ar: "عدد أشهر تقادم المخزون للتخفيض يجب أن يكون عدداً صحيحاً بين 1 و60", en: "The months before aged stock is written down must be a whole number from 1 to 60" });
  }
  if (
    !Number.isFinite(settings.overReceiptTolerancePercent) ||
    settings.overReceiptTolerancePercent < 0 ||
    settings.overReceiptTolerancePercent > 100 ||
    Math.abs(settings.overReceiptTolerancePercent * 100 - Math.round(settings.overReceiptTolerancePercent * 100)) > 1e-9
  ) {
    reasons.push({ ar: "نسبة التجاوز المسموح في الاستلام يجب أن تكون بين 0 و100 بحد أقصى خانتين عشريتين", en: "The over-receipt tolerance must be between 0 and 100 with at most two decimals" });
  }
  if (settings.maxLineDiscountPercent < 0 || settings.maxLineDiscountPercent > 100) {
    reasons.push({ ar: "الحد الأقصى لخصم البند يجب أن يكون بين 0 و100", en: "The maximum line discount must be between 0 and 100" });
  }
  if (
    settings.contractingCbeCreditDiscountRatePercent !== null &&
    (settings.contractingCbeCreditDiscountRatePercent < 0 || settings.contractingCbeCreditDiscountRatePercent > 100)
  ) {
    reasons.push({ ar: "سعر الائتمان والخصم المعلن من البنك المركزي يجب أن يكون بين 0 و100.", en: "The CBE credit and discount rate must be between 0 and 100." });
  }
  if (settings.agingWritedownRatePercent < 0 || settings.agingWritedownRatePercent > 100) {
    reasons.push({ ar: "نسبة تخفيض المخزون المتقادم يجب أن تكون بين 0 و100", en: "The aged stock write-down rate must be between 0 and 100" });
  }
  if (settings.agingWritedownEnabled && settings.agingWritedownRatePercent <= 0) {
    reasons.push({ ar: "تفعيل تخفيض المخزون المتقادم يتطلب نسبة أكبر من صفر", en: "Aged stock write-down needs a rate greater than 0" });
  }

  if (!SMTP_SECURITIES.includes(settings.smtpSecurity)) {
    reasons.push({ ar: "تأمين اتصال البريد يجب أن يكون بدون تشفير أو STARTTLS أو TLS.", en: "The mail connection security must be none, STARTTLS or TLS." });
  }
  if (!Number.isInteger(settings.smtpPort) || settings.smtpPort < 1 || settings.smtpPort > 65535) {
    reasons.push({ ar: "منفذ خادم البريد يجب أن يكون عدداً صحيحاً بين 1 و65535", en: "The mail server port must be a whole number from 1 to 65535" });
  }
  if (HEADER_BREAK.test(settings.smtpFromName)) reasons.push({ ar: "اسم مرسل البريد يجب ألا يحتوي فاصل سطر أو رمز تحكم", en: "The sender name must not contain a line break or control character" });
  if (HEADER_BREAK.test(settings.smtpFromEmail)) reasons.push({ ar: "عنوان مرسل البريد يجب ألا يحتوي فاصل سطر أو رمز تحكم", en: "The sender address must not contain a line break or control character" });
  if (HEADER_BREAK.test(settings.emailTemplateSubject)) reasons.push({ ar: "عنوان قالب البريد يجب ألا يحتوي فاصل سطر أو رمز تحكم", en: "The email subject must not contain a line break or control character" });
  if (settings.smtpEnabled) {
    if (settings.smtpHost.trim() === "") reasons.push({ ar: "تفعيل البريد يتطلب عنوان خادم البريد", en: "Enabling email needs a mail server address" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.smtpFromEmail)) {
      reasons.push({ ar: "تفعيل البريد يتطلب عنوان مرسل صالحاً", en: "Enabling email needs a valid sender address" });
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
