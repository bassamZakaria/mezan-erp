import { describe, expect, it } from "vitest";
import { decimalFromWireNumber, formatAmountWithCurrency, formatMoney, isNegative, isPositiveDecimal, sumDecimals, toAmountInput } from "./money";

describe("formatMoney", () => {
  it("groups thousands and keeps two decimals", () => {
    expect(formatMoney("1234567.5")).toBe("1,234,567.50");
  });

  it("keeps every digit of a figure a float would round", () => {
    expect(formatMoney("9007199254740993.45")).toBe("9,007,199,254,740,993.45");
  });

  it("rounds the scale-6 tail half-up", () => {
    expect(formatMoney("10.129999")).toBe("10.13");
    expect(formatMoney("10.124999")).toBe("10.12");
  });

  it("carries the rounding into the whole part", () => {
    expect(formatMoney("999.999")).toBe("1,000.00");
    expect(formatMoney("9.999")).toBe("10.00");
  });

  it("renders a negative sign before the grouped digits", () => {
    expect(formatMoney("-1000")).toBe("-1,000.00");
  });

  it("renders zero honestly, and never as minus zero", () => {
    expect(formatAmountWithCurrency("0")).toBe("0.00 ج.م");
    expect(formatMoney("-0.000001")).toBe("0.00");
  });
});

describe("isNegative", () => {
  it("does not call -0.000000 negative", () => {
    expect(isNegative("-0.000000")).toBe(false);
    expect(isNegative("-0.01")).toBe(true);
  });
});

describe("isPositiveDecimal", () => {
  it("accepts a plain positive amount", () => {
    expect(isPositiveDecimal("12")).toBe(true);
    expect(isPositiveDecimal("12.5")).toBe(true);
    expect(isPositiveDecimal("  3.25  ")).toBe(true);
  });

  it("refuses zero, negatives, blanks and non-decimal shapes", () => {
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("0.00")).toBe(false);
    expect(isPositiveDecimal("-5")).toBe(false);
    expect(isPositiveDecimal("")).toBe(false);
    expect(isPositiveDecimal("1e3")).toBe(false);
    expect(isPositiveDecimal("abc")).toBe(false);
  });
});

describe("toAmountInput", () => {
  it("cuts a wire decimal to the two places a person types, without rounding", () => {
    expect(toAmountInput("615.600000")).toBe("615.60");
    expect(toAmountInput("180.000000")).toBe("180.00");
    expect(toAmountInput("42")).toBe("42.00");
  });

  it("keeps every digit when the tail is not all zeros, so nothing is posted rounded", () => {
    expect(toAmountInput("440.483808")).toBe("440.483808");
    expect(toAmountInput("")).toBe("");
  });
});

describe("sumDecimals", () => {
  it("adds wire decimals exactly", () => {
    expect(sumDecimals(["4765094.009600", "58680.000000"])).toBe("4823774.009600");
  });

  it("keeps digits a float would lose", () => {
    expect(sumDecimals(["9007199254740993.45", "0.01"])).toBe("9007199254740993.460000");
  });

  it("handles negatives and an empty list", () => {
    expect(sumDecimals(["-10.5", "3"])).toBe("-7.500000");
    expect(sumDecimals([])).toBe("0.000000");
  });
});

describe("decimalFromWireNumber", () => {
  it("never renders exponent notation", () => {
    expect(decimalFromWireNumber(0.000001)).toBe("0.000001");
    expect(decimalFromWireNumber(218568.26)).toBe("218568.260000");
    expect(formatMoney(decimalFromWireNumber(60250.15))).toBe("60,250.15");
  });
});
