import { describe, expect, it } from "vitest";
import { formatPercent } from "./percent";

describe("formatPercent", () => {
  it("trims a scale-6 decimal string to at most two decimals", () => {
    expect(formatPercent("3.750000")).toBe("3.75");
    expect(formatPercent("14.000000")).toBe("14");
    expect(formatPercent("5.000000")).toBe("5");
  });

  it("leaves a one-decimal value alone", () => {
    expect(formatPercent("4.5")).toBe("4.5");
  });

  it("rounds beyond two decimals rather than truncating", () => {
    expect(formatPercent("3.126")).toBe("3.13");
  });

  it("treats a missing figure as an empty string", () => {
    expect(formatPercent(null)).toBe("");
    expect(formatPercent(undefined)).toBe("");
    expect(formatPercent("")).toBe("");
  });

  it("accepts a number as well as a string", () => {
    expect(formatPercent(18.75)).toBe("18.75");
    expect(formatPercent(0)).toBe("0");
  });
});
