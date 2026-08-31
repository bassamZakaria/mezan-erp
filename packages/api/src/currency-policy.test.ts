import { describe, it, expect } from "vitest";
import { createDefaultSettings, type SettingsRepository, type TenantSettings } from "@mezan/domain";
import { createCurrencyCheck } from "./currency-policy.js";

function settingsRepo(settings: TenantSettings | null): SettingsRepository {
  return {
    async get() {
      return settings;
    },
    async save() {
      /* the check never writes */
    },
  };
}

describe("createCurrencyCheck", () => {
  it("allows a document that names no currency at all", async () => {
    const check = createCurrencyCheck(settingsRepo(null));
    expect(await check(undefined)).toBeNull();
    expect(await check(null)).toBeNull();
    expect(await check("")).toBeNull();
  });

  it("allows the tenant's own base currency", async () => {
    const check = createCurrencyCheck(settingsRepo(createDefaultSettings({ currency: "EGP" })));
    expect(await check("EGP")).toBeNull();
  });

  it("falls back to the default settings when the tenant has saved none yet", async () => {
    const check = createCurrencyCheck(settingsRepo(null));
    expect(await check(createDefaultSettings().currency)).toBeNull();
  });

  it("refuses a foreign currency while multi-currency is switched off, naming both currencies", async () => {
    const check = createCurrencyCheck(
      settingsRepo(createDefaultSettings({ currency: "EGP", multiCurrencyEnabled: false })),
    );
    const refusal = await check("USD");
    expect(refusal).toContain("USD");
    expect(refusal).toContain("EGP");
    expect(refusal).toContain("تعدد العملات غير مُفعَّل");
  });

  it("allows a currency the tenant listed once multi-currency is on", async () => {
    const check = createCurrencyCheck(
      settingsRepo(
        createDefaultSettings({ currency: "EGP", multiCurrencyEnabled: true, secondaryCurrencies: ["USD", "EUR"] }),
      ),
    );
    expect(await check("USD")).toBeNull();
    expect(await check("EUR")).toBeNull();
  });

  it("refuses a currency that is not on the tenant's list, even with multi-currency on", async () => {
    const check = createCurrencyCheck(
      settingsRepo(createDefaultSettings({ currency: "EGP", multiCurrencyEnabled: true, secondaryCurrencies: ["USD"] })),
    );
    const refusal = await check("SAR");
    expect(refusal).toContain("SAR");
    expect(refusal).toContain("غير مُدرجة");
  });

  it("reads the settings fresh on every call, so a toggle applies without a restart", async () => {
    let settings = createDefaultSettings({ currency: "EGP", multiCurrencyEnabled: false });
    const check = createCurrencyCheck({
      async get() {
        return settings;
      },
      async save() {
        /* unused */
      },
    });
    expect(await check("USD")).not.toBeNull();

    settings = createDefaultSettings({ currency: "EGP", multiCurrencyEnabled: true, secondaryCurrencies: ["USD"] });
    expect(await check("USD")).toBeNull();
  });
});
