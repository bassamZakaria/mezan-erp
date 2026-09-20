import { describe, expect, it } from "vitest";
import { formatAmountWithCurrency, formatMoney, isNegative } from "./money";

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
