import { describe, it, expect } from "vitest";
import {
  tenantSettingsSchema,
  updateTenantSettingsSchema,
  sendTestEmailSchema,
  testEmailResultSchema,
  allowedCurrenciesSchema,
  tenantSettingsLookupSchema,
  TENANT_SETTINGS_LOOKUP_KEYS,
} from "./settings.js";

const baseSettings = {
  currency: "EGP",
  secondaryCurrencies: [],
  language: "ar" as const,
  timezone: "Africa/Cairo",
  direction: "RTL" as const,
  dateFormat: "dd/MM/yyyy",
  dateNumerals: "arabic" as const,
  weekendDays: [5, 6],
  fiscalYearStartMonth: 1,
  fxRateMissingPolicy: "STRICT" as const,
  multiCurrencyEnabled: false,
  weekStartDay: 6,
  companyName: "Acme Co",
  taxRegistrationNumber: "123456789",
  commercialRegistrationNumber: "987654321",
  phone: "+201000000000",
  email: "info@acme.test",
  allowedEmailDomains: [],
  address: "Cairo, Egypt",
  hrContractExpiryWarningDays: 30,
  payrollDayDivisorBasis: "FIXED_30",
  standardDailyWorkHours: 8,
  taxEnabled: true,
  defaultTaxRate: 14,
  taxCalculation: "EXCLUSIVE" as const,
  depreciationProrate: "DAILY" as const,
  priceListsEnabled: true,
  creditControlEnabled: true,
  creditControlMode: "BLOCK" as const,
  maxLineDiscountPercent: 20,
  contractingCbeCreditDiscountRatePercent: null,
  contractingSingleOperatorMode: false,
  periodCloseSingleOperatorMode: false,
  allowCrossWarehouseSales: false,
  showOtherWarehouseStock: true,
  allowBackorder: false,
  allowNegativeStock: false,
  agingWritedownEnabled: false,
  agingWritedownMonths: 6,
  agingWritedownRatePercent: 10,
  autoGenerateBatchNumbers: false,
  requirePoForGrn: false,
  requireGrnForInvoice: false,
  trackSoldPurchaseItems: false,
  preventNegativeCashBalance: true,
  allowNegativeTreasury: false,
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecurity: "STARTTLS" as const,
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "",
  smtpFromEmail: "",
  emailTemplateSubject: "",
  emailTemplateBody: "",
};

describe("tenantSettingsSchema", () => {
  it("accepts a minimal valid settings bag and preserves every field verbatim", () => {
    const result = tenantSettingsSchema.safeParse(baseSettings);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(baseSettings);
  });

  it("rejects a currency code that is not exactly 3 characters", () => {
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, currency: "EG" }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, currency: "EGYP" }).success).toBe(false);
  });

  it("rejects an out-of-enum language", () => {
    const result = tenantSettingsSchema.safeParse({ ...baseSettings, language: "fr" });
    expect(result.success).toBe(false);
  });

  it("rejects a fiscalYearStartMonth outside 1-12", () => {
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, fiscalYearStartMonth: 0 }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, fiscalYearStartMonth: 13 }).success).toBe(false);
  });

  it("rejects a defaultTaxRate outside 0-100", () => {
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, defaultTaxRate: -1 }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, defaultTaxRate: 101 }).success).toBe(false);
  });

  it("rejects an smtpPort outside 1-65535", () => {
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, smtpPort: 0 }).success).toBe(false);
    expect(tenantSettingsSchema.safeParse({ ...baseSettings, smtpPort: 70000 }).success).toBe(false);
  });

  it("normalises an allowed email domain — trims, lower-cases and strips a leading @ or .", () => {
    const result = tenantSettingsSchema.safeParse({ ...baseSettings, allowedEmailDomains: [" @Mezan.COM "] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowedEmailDomains).toEqual(["mezan.com"]);
  });

  it("rejects an allowed email domain that isn't a real domain shape after normalisation", () => {
    const result = tenantSettingsSchema.safeParse({ ...baseSettings, allowedEmailDomains: ["not a domain"] });
    expect(result.success).toBe(false);
  });

  it("rejects a settings bag missing a required field", () => {
    const { taxEnabled, ...rest } = baseSettings;
    const result = tenantSettingsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("taxEnabled");
  });

  it("rejects a weekendDays value outside 0-6", () => {
    const result = tenantSettingsSchema.safeParse({ ...baseSettings, weekendDays: [7] });
    expect(result.success).toBe(false);
  });
});

describe("updateTenantSettingsSchema", () => {
  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateTenantSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateTenantSettingsSchema.safeParse({ currency: "USD" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ currency: "USD" });
  });

  it("rejects an invalid currency length when supplied", () => {
    const result = updateTenantSettingsSchema.safeParse({ currency: "US" });
    expect(result.success).toBe(false);
  });
});

describe("sendTestEmailSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = sendTestEmailSchema.safeParse({ to: "admin@acme.test" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = sendTestEmailSchema.safeParse({ to: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a recipient carrying a line break, which would split RCPT TO or the To header", () => {
    expect(sendTestEmailSchema.safeParse({ to: "admin@acme.test\r\nBcc: x@evil.test" }).success).toBe(false);
  });
});

describe("updateTenantSettingsSchema — what reaches the SMTP command line", () => {
  it("rejects a sender address or host with CR/LF, and still lets the address be cleared", () => {
    expect(updateTenantSettingsSchema.safeParse({ smtpFromEmail: "shop@acme.test\r\nBcc: x@evil.test" }).success).toBe(false);
    expect(updateTenantSettingsSchema.safeParse({ smtpHost: "smtp.acme.test\r\nRSET" }).success).toBe(false);
    expect(updateTenantSettingsSchema.safeParse({ smtpFromEmail: "" }).success).toBe(true);
  });
});

describe("testEmailResultSchema", () => {
  const result = { ok: true, stage: "done" as const, message: "Test email sent" };

  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const parsed = testEmailResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects an out-of-enum stage", () => {
    const parsed = testEmailResultSchema.safeParse({ ...result, stage: "retry" });
    expect(parsed.success).toBe(false);
  });
});

describe("allowedCurrenciesSchema", () => {
  const currencies = { base: "EGP", multiCurrencyEnabled: true, allowed: ["EGP", "USD"] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = allowedCurrenciesSchema.safeParse(currencies);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(currencies);
  });

  it("rejects a base currency that is not exactly 3 characters", () => {
    const result = allowedCurrenciesSchema.safeParse({ ...currencies, base: "EG" });
    expect(result.success).toBe(false);
  });
});

describe("the settings lookup is an allowlist", () => {
  const SECRET_LOOKING = /secret|password|token|key|smtp|template/i;

  it("lists only settings that exist, and none that could carry a secret", () => {
    const known = Object.keys(tenantSettingsSchema.shape);
    expect(TENANT_SETTINGS_LOOKUP_KEYS.filter((key) => !known.includes(key))).toEqual([]);
    expect(TENANT_SETTINGS_LOOKUP_KEYS.filter((key) => SECRET_LOOKING.test(key))).toEqual([]);
  });

  it("serves exactly the listed keys, so a setting added later is not exposed by being added", () => {
    expect(Object.keys(tenantSettingsLookupSchema.shape).sort()).toEqual([...TENANT_SETTINGS_LOOKUP_KEYS].sort());
    const extended = tenantSettingsSchema.extend({ paymentGatewaySecret: tenantSettingsSchema.shape.companyName });
    expect(Object.keys(extended.shape)).toContain("paymentGatewaySecret");
    expect(Object.keys(tenantSettingsLookupSchema.shape)).not.toContain("paymentGatewaySecret");
  });

  it("leaves out the mail configuration and the mail templates", () => {
    for (const key of ["smtpHost", "smtpPassword", "smtpUsername", "allowedEmailDomains", "emailTemplateSubject", "emailTemplateBody"]) {
      expect(TENANT_SETTINGS_LOOKUP_KEYS as readonly string[]).not.toContain(key);
    }
  });
});
