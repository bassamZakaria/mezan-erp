import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { carryingBaseOf, convertToBase, convertFromBase, isBaseCurrency, FxRateMissingError } from "./convert.js";

describe("convertToBase", () => {
  it("multiplies a foreign amount by the base-per-foreign rate, rounding HALF_UP at scale 1e-6", () => {
    expect(convertToBase(Money.fromMajor("100"), "50.25").toString()).toBe("5025.000000");
    // 33.333333 × 3 = 99.999999 exactly — no rounding needed
    expect(convertToBase(Money.fromMajor("33.333333"), "3").toString()).toBe("99.999999");
  });

  it("rounds the sub-unit product half-away-from-zero", () => {
    // 0.5 × 0.000001 = 0.0000005 → rounds up to 0.000001 (half away from zero)
    expect(convertToBase(Money.fromMajor("0.5"), "0.000001").toString()).toBe("0.000001");
  });

  it("returns zero for a zero amount", () => {
    expect(convertToBase(Money.zero(), "50.25").toString()).toBe("0.000000");
  });

  it("handles negative amounts symmetrically", () => {
    expect(convertToBase(Money.fromMajor("-100"), "50").toString()).toBe("-5000.000000");
  });
});

describe("convertFromBase — inverse of convertToBase", () => {
  it("divides a base amount by the rate to recover the foreign balance", () => {
    expect(convertFromBase(Money.fromMajor("5025"), "50.25").toString()).toBe("100.000000");
  });

  it("returns zero when the rate itself is zero (defensive, avoids division by zero)", () => {
    expect(convertFromBase(Money.fromMajor("100"), "0").toString()).toBe("0.000000");
  });

  it("round-trips through convertToBase within rounding tolerance", () => {
    const original = Money.fromMajor("250.500000");
    const rate = "31.875";
    const base = convertToBase(original, rate);
    const back = convertFromBase(base, rate);
    // rounding at each cross-type boundary means we may be off by at most one scaled unit
    const diff = back.scaled - original.scaled < 0n ? original.scaled - back.scaled : back.scaled - original.scaled;
    expect(diff <= 1n).toBe(true);
  });
});

describe("isBaseCurrency", () => {
  it("is true for EGP, null, and the empty string", () => {
    expect(isBaseCurrency("EGP")).toBe(true);
    expect(isBaseCurrency(null)).toBe(true);
    expect(isBaseCurrency(undefined)).toBe(true);
    expect(isBaseCurrency("")).toBe(true);
  });

  it("is false for any foreign currency code", () => {
    expect(isBaseCurrency("USD")).toBe(false);
    expect(isBaseCurrency("EUR")).toBe(false);
  });
});

describe("FxRateMissingError", () => {
  it("carries the currency/date and a descriptive message", () => {
    const err = new FxRateMissingError("USD", "2026-08-31");
    expect(err.code).toBe("FX_RATE_MISSING");
    expect(err.currency).toBe("USD");
    expect(err.asOfDate).toBe("2026-08-31");
    expect(err.message).toContain("USD");
    expect(err.message).toContain("2026-08-31");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("carryingBaseOf — what leaves a foreign position leaves at what it is carried at", () => {
  const position = { foreign: Money.fromMajor("3"), base: Money.fromMajor("100") };

  it("a part takes its weighted share, rounded once", () => {
    expect(carryingBaseOf(position, Money.fromMajor("1"))).toEqual({ covered: Money.fromMajor("1"), base: Money.fromMajor("33.333333") });
  });

  it("all of the foreign money takes all of the base, so nothing is left behind by rounding", () => {
    expect(carryingBaseOf(position, Money.fromMajor("3"))).toEqual({ covered: Money.fromMajor("3"), base: Money.fromMajor("100") });
  });

  it("more than the position holds is covered only as far as it holds, at no more than its whole base", () => {
    expect(carryingBaseOf(position, Money.fromMajor("5"))).toEqual({ covered: Money.fromMajor("3"), base: Money.fromMajor("100") });
  });

  it("a position holding nothing carries nothing", () => {
    expect(carryingBaseOf({ foreign: Money.zero(), base: Money.fromMajor("7") }, Money.fromMajor("1"))).toEqual({ covered: Money.zero(), base: Money.zero() });
  });
});
