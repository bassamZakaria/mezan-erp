import { describe, expect, it } from "vitest";
import { isPositiveAmount, toPiasters, westernDigits } from "./card-amount";

describe("a card amount on the console", () => {
  it("is cut to piasters as text, so a figure no float can hold comes through digit for digit", () => {
    expect(toPiasters("499.000000")).toBe("499.00");
    expect(toPiasters("0.100000")).toBe("0.10");
    expect(toPiasters("0.290000")).toBe("0.29");
    expect(toPiasters("900719925474099.330000")).toBe("900719925474099.33");
    expect(toPiasters("1250.5")).toBe("1250.50");
    expect(toPiasters("70")).toBe("70.00");
  });

  it("reads Arabic and Persian digits and the Arabic decimal mark as the same amount", () => {
    expect(westernDigits("١٢٥٠٫٥٠")).toBe("1250.50");
    expect(westernDigits("۴۹۹")).toBe("499");
  });

  it("accepts only a positive amount of at most two decimals", () => {
    expect(isPositiveAmount("499.00")).toBe(true);
    expect(isPositiveAmount("0.01")).toBe(true);
    expect(isPositiveAmount("0.00")).toBe(false);
    expect(isPositiveAmount("1.234")).toBe(false);
    expect(isPositiveAmount("-5")).toBe(false);
    expect(isPositiveAmount("1e3")).toBe(false);
  });
});
