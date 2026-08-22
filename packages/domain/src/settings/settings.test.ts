import { describe, expect, it } from "vitest";
import { createDefaultSettings, updateSettings, InvalidSettingsError, DEFAULT_SETTINGS } from "./settings.js";

describe("createDefaultSettings", () => {
  it("returns the catalog-default tenant settings unmodified", () => {
    const settings = createDefaultSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("applies overrides on top of the defaults", () => {
    const settings = createDefaultSettings({ companyName: "Cyag", defaultTaxRate: 14 });
    expect(settings.companyName).toBe("Cyag");
    expect(settings.currency).toBe(DEFAULT_SETTINGS.currency);
  });

  it("rejects an invalid currency code", () => {
    expect(() => createDefaultSettings({ currency: "egp" })).toThrow(InvalidSettingsError);
  });
});

describe("updateSettings", () => {
  const base = createDefaultSettings({ companyName: "Cyag" });

  it("merges a partial patch onto the current settings", () => {
    const next = updateSettings(base, { defaultTaxRate: 15 });
    expect(next.defaultTaxRate).toBe(15);
    expect(next.companyName).toBe("Cyag");
  });

  it("rejects a tax rate outside 0..100", () => {
    expect(() => updateSettings(base, { defaultTaxRate: 140 })).toThrow(InvalidSettingsError);
  });

  it("rejects an hrContractExpiryWarningDays outside 7..365", () => {
    expect(() => updateSettings(base, { hrContractExpiryWarningDays: 3 })).toThrow(InvalidSettingsError);
    expect(() => updateSettings(base, { hrContractExpiryWarningDays: 400 })).toThrow(InvalidSettingsError);
  });

  it("rejects an out-of-range fiscalYearStartMonth", () => {
    expect(() => updateSettings(base, { fiscalYearStartMonth: 13 })).toThrow(InvalidSettingsError);
  });

  it("rejects duplicate or out-of-range weekendDays", () => {
    expect(() => updateSettings(base, { weekendDays: [5, 5] })).toThrow(InvalidSettingsError);
    expect(() => updateSettings(base, { weekendDays: [7] })).toThrow(InvalidSettingsError);
  });

  it("rejects an unknown creditControlMode", () => {
    expect(() =>
      updateSettings(base, { creditControlMode: "STRICT" as unknown as "WARNING" }),
    ).toThrow(InvalidSettingsError);
  });

  it("accepts toggling the treasury/inventory/purchase policy flags", () => {
    const next = updateSettings(base, {
      allowNegativeStock: true,
      requirePoForGrn: true,
      preventNegativeCashBalance: false,
      creditControlEnabled: true,
      creditControlMode: "BLOCK",
    });
    expect(next.allowNegativeStock).toBe(true);
    expect(next.requirePoForGrn).toBe(true);
    expect(next.preventNegativeCashBalance).toBe(false);
    expect(next.creditControlMode).toBe("BLOCK");
  });

  it("does not mutate the original settings object", () => {
    const next = updateSettings(base, { defaultTaxRate: 20 });
    expect(base.defaultTaxRate).toBe(14);
    expect(next).not.toBe(base);
  });
});
