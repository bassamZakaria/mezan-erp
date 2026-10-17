import { z } from "zod";
import { companyNameSchema } from "./company-name.js";
import { mailAddressInput } from "./mail-address.js";

/** Wire contract for the tenant settings config bag (docs/archive/catalog/09 §"عام"). */
export const tenantSettingsSchema = z.object({
  currency: z.string().length(3),
  secondaryCurrencies: z.array(z.string().length(3)),
  language: z.enum(["ar", "en", "de"]),
  timezone: z.string().min(1),
  direction: z.enum(["LTR", "RTL"]),
  dateFormat: z.string().min(1),
  dateNumerals: z.enum(["western", "arabic"]),
  weekendDays: z.array(z.number().int().min(0).max(6)),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  fxRateMissingPolicy: z.enum(["STRICT", "ALLOW_MISSING"]),
  multiCurrencyEnabled: z.boolean(),

  weekStartDay: z.number().int().min(0).max(6),
  companyName: companyNameSchema,
  taxRegistrationNumber: z.string(),
  commercialRegistrationNumber: z.string(),
  phone: z.string(),
  email: z.string(),
  /**
   * Domains a user account's email may belong to. Empty means no restriction.
   * Normalised on the wire so "@Mezan.COM " and "mezan.com" cannot both be
   * stored and then disagree about whether one address is allowed.
   */
  allowedEmailDomains: z.array(
    z
      .string()
      .trim()
      .toLowerCase()
      .transform((d) => d.replace(/^[@.]+/, ""))
      .refine((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d), "Not a domain name"),
  ),
  address: z.string(),
  hrContractExpiryWarningDays: z.number().int().min(7).max(365),
  payrollDayDivisorBasis: z.enum(["FIXED_30", "CALENDAR_DAYS"]),
  standardDailyWorkHours: z.number().positive().max(24),

  taxEnabled: z.boolean(),
  defaultTaxRate: z.number().min(0).max(100),
  taxCalculation: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
  depreciationProrate: z.enum(["DAILY", "FULL_MONTH"]),

  priceListsEnabled: z.boolean(),
  creditControlEnabled: z.boolean(),
  creditControlMode: z.enum(["WARNING", "BLOCK"]),
  maxLineDiscountPercent: z.number().min(0).max(100),
  /** المقاولات — CBE credit-and-discount rate; null when the tenant has not set one. */
  contractingCbeCreditDiscountRatePercent: z.number().min(0).max(100).nullable().default(null),
  /** المقاولات — waives فصل المهام for a one-person install. Default false: the wildcard admin is bound like anyone. */
  contractingSingleOperatorMode: z.boolean().default(false),
  periodCloseSingleOperatorMode: z.boolean().default(false),

  allowCrossWarehouseSales: z.boolean(),
  showOtherWarehouseStock: z.boolean(),
  allowBackorder: z.boolean(),
  allowNegativeStock: z.boolean(),
  agingWritedownEnabled: z.boolean(),
  agingWritedownMonths: z.number().int().min(1).max(60),
  agingWritedownRatePercent: z.number().min(0).max(100),
  autoGenerateBatchNumbers: z.boolean(),

  requirePoForGrn: z.boolean(),
  requireGrnForInvoice: z.boolean(),
  trackSoldPurchaseItems: z.boolean(),

  preventNegativeCashBalance: z.boolean(),
  allowNegativeTreasury: z.boolean(),

  smtpEnabled: z.boolean(),
  // SECURITY: written into EHLO verbatim — no whitespace or CR/LF may reach the command line.
  smtpHost: z.string().trim().regex(/^[A-Za-z0-9.:[\]-]*$/),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecurity: z.enum(["NONE", "STARTTLS", "TLS"]),
  smtpUsername: z.string(),
  // Never carries the stored password outbound — GET masks it and an empty
  // string on the way in means "keep the one already stored".
  smtpPassword: z.string(),
  smtpFromName: z.string(),
  smtpFromEmail: mailAddressInput,
  emailTemplateSubject: z.string(),
  emailTemplateBody: z.string(),
});

/** PATCH /settings body — every field optional. */
export const updateTenantSettingsSchema = tenantSettingsSchema.partial();

/** POST /settings/email/test body — sends the configured template to one address. */
export const sendTestEmailSchema = z.object({
  to: z.string().trim().email(),
});

export enum SmtpStage {
  Disabled = "disabled",
  Refused = "refused",
  Connect = "connect",
  Greeting = "greeting",
  Ehlo = "ehlo",
  StartTls = "starttls",
  Auth = "auth",
  Send = "send",
  Done = "done",
}

export const testEmailResultSchema = z.object({
  ok: z.boolean(),
  stage: z.nativeEnum(SmtpStage),
  message: z.string(),
});

/** GET /settings/currencies — the currencies a document may be denominated in. */
export const allowedCurrenciesSchema = z.object({
  base: z.string().length(3),
  multiCurrencyEnabled: z.boolean(),
  allowed: z.array(z.string().length(3)),
});

export type TenantSettingsDTO = z.infer<typeof tenantSettingsSchema>;

/**
 * SECURITY: the ONLY settings `GET /settings/lookup` hands to every signed-in
 * user — what a screen or a printed document needs to render. A setting added
 * to `tenantSettingsSchema` is NOT served by the lookup until it is listed
 * here, so a secret, a mail template or an outbound credential added later is
 * closed by default.
 */
export const TENANT_SETTINGS_LOOKUP_KEYS = [
  "currency",
  "secondaryCurrencies",
  "language",
  "timezone",
  "direction",
  "dateFormat",
  "dateNumerals",
  "weekendDays",
  "weekStartDay",
  "fiscalYearStartMonth",
  "multiCurrencyEnabled",
  "companyName",
  "taxRegistrationNumber",
  "commercialRegistrationNumber",
  "phone",
  "email",
  "address",
  "taxEnabled",
  "defaultTaxRate",
  "taxCalculation",
  "requirePoForGrn",
] as const satisfies readonly (keyof z.infer<typeof tenantSettingsSchema>)[];

export type TenantSettingsLookupKey = (typeof TENANT_SETTINGS_LOOKUP_KEYS)[number];

/** GET /settings/lookup — see `TENANT_SETTINGS_LOOKUP_KEYS`. */
export const tenantSettingsLookupSchema = tenantSettingsSchema.pick(
  Object.fromEntries(TENANT_SETTINGS_LOOKUP_KEYS.map((key) => [key, true])) as { [K in TenantSettingsLookupKey]: true },
);
export type TenantSettingsLookupDTO = z.infer<typeof tenantSettingsLookupSchema>;
export type UpdateTenantSettingsDTO = z.infer<typeof updateTenantSettingsSchema>;
export type SendTestEmailDTO = z.infer<typeof sendTestEmailSchema>;
export type TestEmailResultDTO = z.infer<typeof testEmailResultSchema>;
export type AllowedCurrenciesDTO = z.infer<typeof allowedCurrenciesSchema>;
