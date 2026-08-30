import { describe, expect, it } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_CURRENCY_CODES,
  findCurrency,
  foreignCurrencies,
  isSupportedCurrency,
} from "./currencies.js";

describe("the currency registry", () => {
  it("opens on the Egyptian pound, which is the base every tenant starts from", () => {
    expect(SUPPORTED_CURRENCIES[0]?.code).toBe("EGP");
    expect(SUPPORTED_CURRENCIES[0]?.nameAr).toBe("جنيه مصري");
  });

  it("carries eleven distinct ISO 4217 codes", () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(11);
    expect(new Set(SUPPORTED_CURRENCY_CODES).size).toBe(11);
    for (const code of SUPPORTED_CURRENCY_CODES) expect(/^[A-Z]{3}$/.test(code)).toBe(true);
  });

  it("names every currency in both languages and gives it a symbol", () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(currency.nameAr.trim().length).toBeGreaterThan(0);
      expect(currency.nameEn.trim().length).toBeGreaterThan(0);
      expect(currency.symbol.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(currency.nameAr)).toBe(true);
    }
  });

  it("carries the Gulf currencies an Egyptian exporter actually invoices in", () => {
    for (const code of ["SAR", "AED", "KWD", "QAR", "BHD", "OMR", "JOD"]) {
      expect(SUPPORTED_CURRENCY_CODES).toContain(code);
    }
  });

  it("keeps the code list in step with the definitions, in the same order", () => {
    expect(SUPPORTED_CURRENCY_CODES).toEqual(SUPPORTED_CURRENCIES.map((c) => c.code));
  });
});

describe("findCurrency", () => {
  it("finds a currency by its exact code", () => {
    expect(findCurrency("USD")).toMatchObject({ code: "USD", nameAr: "دولار أمريكي", symbol: "$" });
  });

  it("returns nothing for a code the registry does not carry, rather than a guess", () => {
    expect(findCurrency("XXX")).toBeNull();
    expect(findCurrency("")).toBeNull();
    expect(findCurrency("usd")).toBeNull();
  });
});

describe("isSupportedCurrency", () => {
  it("is true for every code in the registry", () => {
    for (const code of SUPPORTED_CURRENCY_CODES) expect(isSupportedCurrency(code)).toBe(true);
  });

  it("is false for an unknown code, and for nothing at all", () => {
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
  });

  it("is case-sensitive, because ISO 4217 codes are upper case", () => {
    expect(isSupportedCurrency("egp")).toBe(false);
  });
});

describe("foreignCurrencies", () => {
  it("excludes the base, since a rate is never quoted against itself", () => {
    const foreign = foreignCurrencies("EGP");
    expect(foreign.map((c) => c.code)).not.toContain("EGP");
    expect(foreign).toHaveLength(SUPPORTED_CURRENCIES.length - 1);
  });

  it("works for a tenant whose base is not the pound", () => {
    const foreign = foreignCurrencies("SAR");
    expect(foreign.map((c) => c.code)).not.toContain("SAR");
    expect(foreign.map((c) => c.code)).toContain("EGP");
  });

  it("returns the whole registry when the base is not one of its codes", () => {
    expect(foreignCurrencies("XXX")).toHaveLength(SUPPORTED_CURRENCIES.length);
  });

  it("keeps the registry's order, so two screens list them the same way", () => {
    const foreign = foreignCurrencies("EGP").map((c) => c.code);
    expect(foreign).toEqual(SUPPORTED_CURRENCY_CODES.filter((c) => c !== "EGP"));
  });
});
