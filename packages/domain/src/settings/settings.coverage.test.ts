import { describe, expect, it } from "vitest";
import { createDefaultSettings, updateSettings, InvalidSettingsError, type TenantSettings } from "./settings.js";

/**
 * The reasons a patch is refused for, or [] when it is accepted.
 *
 * `InvalidSettingsError` joins them into its message rather than carrying a
 * `reasons` array the way the other domain errors do, so they are read back
 * out of the message here.
 */
function reasonsFor(patch: Partial<TenantSettings>): readonly string[] {
  try {
    createDefaultSettings(patch);
    return [];
  } catch (err) {
    if (err instanceof InvalidSettingsError) {
      return err.message.replace(/^Invalid settings: /, "").split("; ");
    }
    throw err;
  }
}

describe("tenant settings — the currency rules", () => {
  it("refuses a secondary currency that is not a three-letter code", () => {
    expect(reasonsFor({ multiCurrencyEnabled: true, secondaryCurrencies: ["usd"] })).toContain(
      'secondaryCurrencies contains an invalid code: "usd"',
    );
  });

  it("refuses multi-currency switched on with nothing to switch to", () => {
    expect(reasonsFor({ multiCurrencyEnabled: true, secondaryCurrencies: [] })).toContain(
      "multiCurrencyEnabled needs at least one additional currency",
    );
  });

  it("refuses a secondary list that repeats the base currency", () => {
    expect(reasonsFor({ multiCurrencyEnabled: true, currency: "EGP", secondaryCurrencies: ["EGP", "USD"] })).toContain(
      "secondaryCurrencies must not repeat the base currency",
    );
  });

  it("accepts a real secondary currency list", () => {
    expect(reasonsFor({ multiCurrencyEnabled: true, currency: "EGP", secondaryCurrencies: ["USD", "EUR"] })).toEqual([]);
  });
});

describe("tenant settings — locale, calendar and the working week", () => {
  it("refuses an unknown language, direction or numeral system", () => {
    expect(reasonsFor({ language: "fr" as TenantSettings["language"] })[0]).toContain("language must be one of");
    expect(reasonsFor({ direction: "updown" as TenantSettings["direction"] })[0]).toContain("direction must be one of");
    expect(reasonsFor({ dateNumerals: "roman" as TenantSettings["dateNumerals"] })[0]).toContain(
      "dateNumerals must be one of",
    );
  });

  it("refuses a week start day outside 0..6, and a fractional one", () => {
    expect(reasonsFor({ weekStartDay: 7 })).toContain("weekStartDay must be an integer in 0..6");
    expect(reasonsFor({ weekStartDay: -1 })).toContain("weekStartDay must be an integer in 0..6");
    expect(reasonsFor({ weekStartDay: 1.5 })).toContain("weekStartDay must be an integer in 0..6");
  });

  it("accepts Egypt's Friday–Saturday weekend and refuses a repeated day", () => {
    expect(reasonsFor({ weekendDays: [5, 6] })).toEqual([]);
    expect(reasonsFor({ weekendDays: [5, 5] })).toContain("weekendDays must be unique integers in 0..6");
  });

  it("refuses an unknown fx-rate-missing policy", () => {
    expect(reasonsFor({ fxRateMissingPolicy: "shrug" as TenantSettings["fxRateMissingPolicy"] })[0]).toContain(
      "fxRateMissingPolicy must be one of",
    );
  });
});

describe("tenant settings — payroll and attendance bounds", () => {
  it("refuses an overtime multiplier of zero or less", () => {
    expect(reasonsFor({ overtimeMultiplier: 0 })).toContain("overtimeMultiplier must be greater than 0");
    expect(reasonsFor({ overtimeMultiplier: -1 })).toContain("overtimeMultiplier must be greater than 0");
    expect(reasonsFor({ overtimeMultiplier: 1.5 })).toEqual([]);
  });

  it("refuses a standard working day outside (0, 24]", () => {
    expect(reasonsFor({ standardDailyWorkHours: 0 })).toContain("standardDailyWorkHours must be in (0, 24]");
    expect(reasonsFor({ standardDailyWorkHours: 25 })).toContain("standardDailyWorkHours must be in (0, 24]");
    expect(reasonsFor({ standardDailyWorkHours: 24 })).toEqual([]);
  });
});

describe("tenant settings — tax, depreciation and credit control", () => {
  it("refuses an unknown tax calculation mode, prorate mode or credit-control mode", () => {
    expect(reasonsFor({ taxCalculation: "vibes" as TenantSettings["taxCalculation"] })[0]).toContain(
      "taxCalculation must be one of",
    );
    expect(reasonsFor({ depreciationProrate: "vibes" as TenantSettings["depreciationProrate"] })[0]).toContain(
      "depreciationProrate must be one of",
    );
    expect(reasonsFor({ creditControlMode: "vibes" as TenantSettings["creditControlMode"] })[0]).toContain(
      "creditControlMode must be one of",
    );
  });

  it("accepts both ends of the default tax rate range", () => {
    expect(reasonsFor({ defaultTaxRate: 0 })).toEqual([]);
    expect(reasonsFor({ defaultTaxRate: 100 })).toEqual([]);
    expect(reasonsFor({ defaultTaxRate: 101 })).toContain("defaultTaxRate must be in 0..100");
  });
});

describe("tenant settings — the discount ceiling and the aging write-down", () => {
  it("refuses a discount ceiling outside 0..100", () => {
    expect(reasonsFor({ maxLineDiscountPercent: -1 })).toContain("maxLineDiscountPercent must be in 0..100");
    expect(reasonsFor({ maxLineDiscountPercent: 101 })).toContain("maxLineDiscountPercent must be in 0..100");
    expect(reasonsFor({ maxLineDiscountPercent: 100 })).toEqual([]);
  });

  it("refuses an aging window outside 1..60 months", () => {
    expect(reasonsFor({ agingWritedownMonths: 0 })).toContain("agingWritedownMonths must be an integer in 1..60");
    expect(reasonsFor({ agingWritedownMonths: 61 })).toContain("agingWritedownMonths must be an integer in 1..60");
    expect(reasonsFor({ agingWritedownMonths: 12.5 })).toContain("agingWritedownMonths must be an integer in 1..60");
  });

  it("refuses a write-down rate outside 0..100", () => {
    expect(reasonsFor({ agingWritedownRatePercent: -1 })).toContain("agingWritedownRatePercent must be in 0..100");
    expect(reasonsFor({ agingWritedownRatePercent: 101 })).toContain("agingWritedownRatePercent must be in 0..100");
  });

  it("refuses the write-down switched on at a rate of zero — it would provision nothing", () => {
    expect(reasonsFor({ agingWritedownEnabled: true, agingWritedownRatePercent: 0 })).toContain(
      "agingWritedownEnabled needs a rate greater than 0",
    );
    expect(reasonsFor({ agingWritedownEnabled: true, agingWritedownRatePercent: 25 })).toEqual([]);
  });
});

describe("tenant settings — email", () => {
  it("refuses an email domain that is not a domain", () => {
    expect(reasonsFor({ allowedEmailDomains: ["not a domain"] })).toContain(
      'allowedEmailDomains contains an invalid domain: "not a domain"',
    );
    expect(reasonsFor({ allowedEmailDomains: ["mezan.example", "sub.mezan.example"] })).toEqual([]);
  });

  it("refuses an unknown SMTP security mode and a port outside 1..65535", () => {
    expect(reasonsFor({ smtpSecurity: "carrier-pigeon" as TenantSettings["smtpSecurity"] })[0]).toContain(
      "smtpSecurity must be one of",
    );
    expect(reasonsFor({ smtpPort: 0 })).toContain("smtpPort must be an integer in 1..65535");
    expect(reasonsFor({ smtpPort: 70000 })).toContain("smtpPort must be an integer in 1..65535");
  });

  it("refuses SMTP switched on with no host and no sender address", () => {
    const reasons = reasonsFor({ smtpEnabled: true, smtpHost: "   ", smtpFromEmail: "" });
    expect(reasons).toContain("smtpEnabled needs an SMTP host");
    expect(reasons).toContain("smtpEnabled needs a valid sender address");
  });

  it("accepts SMTP switched on once a host and a real sender address are set", () => {
    expect(
      reasonsFor({ smtpEnabled: true, smtpHost: "smtp.mezan.example", smtpFromEmail: "billing@mezan.example" }),
    ).toEqual([]);
  });

  it("leaves the host and sender unchecked while SMTP is switched off", () => {
    expect(reasonsFor({ smtpEnabled: false, smtpHost: "", smtpFromEmail: "" })).toEqual([]);
  });
});

describe("tenant settings — updateSettings", () => {
  it("re-validates the whole object, so a patch cannot produce an invalid combination", () => {
    const current = createDefaultSettings({ agingWritedownEnabled: false, agingWritedownRatePercent: 0 });
    expect(() => updateSettings(current, { agingWritedownEnabled: true })).toThrow(InvalidSettingsError);
  });

  it("collects every reason at once rather than stopping at the first", () => {
    const reasons = reasonsFor({ currency: "egp", weekStartDay: 9, defaultTaxRate: 400 });
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });
});
