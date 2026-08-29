import { describe, expect, it } from "vitest";
import { amountInWords, EGP_WORDS, SAR_WORDS, type ArabicCurrencyWords } from "./amount-in-words";

describe("amountInWords", () => {
  it("matches the reference system's captured print-preview example (docs/archive/catalog/09 §المجاميع)", () => {
    expect(amountInWords(1092.5, SAR_WORDS)).toBe(
      "ألف واثنان وتسعون ريال سعودي وخمسون هللة فقط لا غير",
    );
  });

  it("spells out zero", () => {
    expect(amountInWords(0, EGP_WORDS)).toBe("صفر جنيه مصري فقط لا غير");
  });

  it("uses the singular + واحد adjective for exactly 1 main unit", () => {
    expect(amountInWords(1, EGP_WORDS)).toBe("جنيه مصري واحد فقط لا غير");
  });

  it("uses the dual noun for exactly 2 main units, no numeral", () => {
    expect(amountInWords(2, EGP_WORDS)).toBe("جنيهان مصريان فقط لا غير");
  });

  it("applies masculine polarity forms (ة-suffixed) for 3-10 against a masculine noun", () => {
    expect(amountInWords(3, EGP_WORDS)).toBe("ثلاثة جنيهات مصرية فقط لا غير");
    expect(amountInWords(5, EGP_WORDS)).toBe("خمسة جنيهات مصرية فقط لا غير");
    expect(amountInWords(9, EGP_WORDS)).toBe("تسعة جنيهات مصرية فقط لا غير");
  });

  it("applies feminine polarity forms (bare) for 3-10 against a feminine noun", () => {
    const limeCurrency: ArabicCurrencyWords = {
      main: { singular: "ليرة", dual: "ليرتان", plural: "ليرات", gender: "feminine" },
      subunit: { singular: "قرش", dual: "قرشان", plural: "قروش", gender: "masculine" },
    };
    expect(amountInWords(3, limeCurrency)).toBe("ثلاث ليرات فقط لا غير");
    expect(amountInWords(8, limeCurrency)).toBe("ثماني ليرات فقط لا غير");
  });

  it("renders teens with gender-specific compound forms", () => {
    expect(amountInWords(11, EGP_WORDS)).toBe("أحد عشر جنيه مصري فقط لا غير");
    expect(amountInWords(15, EGP_WORDS)).toBe("خمسة عشر جنيه مصري فقط لا غير");
    expect(amountInWords(19, SAR_WORDS)).toBe("تسعة عشر ريال سعودي فقط لا غير");
  });

  it("renders tens and compound tens-ones", () => {
    expect(amountInWords(20, EGP_WORDS)).toBe("عشرون جنيه مصري فقط لا غير");
    expect(amountInWords(25, EGP_WORDS)).toBe("خمسة وعشرون جنيه مصري فقط لا غير");
    expect(amountInWords(92, SAR_WORDS)).toBe("اثنان وتسعون ريال سعودي فقط لا غير");
  });

  it("renders hundreds joined with و", () => {
    expect(amountInWords(100, EGP_WORDS)).toBe("مائة جنيه مصري فقط لا غير");
    expect(amountInWords(125, EGP_WORDS)).toBe("مائة وخمسة وعشرون جنيه مصري فقط لا غير");
  });

  it("renders thousand-scale groups with dual/plural/singular-construct forms", () => {
    expect(amountInWords(1000, EGP_WORDS)).toBe("ألف جنيه مصري فقط لا غير");
    expect(amountInWords(2000, EGP_WORDS)).toBe("ألفان جنيه مصري فقط لا غير");
    expect(amountInWords(3000, EGP_WORDS)).toBe("ثلاثة آلاف جنيه مصري فقط لا غير");
    expect(amountInWords(15000, EGP_WORDS)).toBe("خمسة عشر ألف جنيه مصري فقط لا غير");
  });

  it("renders millions and combines with lower groups", () => {
    expect(amountInWords(1_000_000, EGP_WORDS)).toBe("مليون جنيه مصري فقط لا غير");
    expect(amountInWords(2_500_000, EGP_WORDS)).toBe(
      "مليونان وخمسمائة ألف جنيه مصري فقط لا غير",
    );
  });

  it("combines main and subunit with a connecting و", () => {
    expect(amountInWords(1150.75, EGP_WORDS)).toBe(
      "ألف ومائة وخمسون جنيه مصري وخمسة وسبعون قرش فقط لا غير",
    );
  });

  it("uses the plural عشرة/عشر form (not singular attach) for exactly 10", () => {
    expect(amountInWords(10, EGP_WORDS)).toBe("عشرة جنيهات مصرية فقط لا غير");
  });

  it("rounds fractional subunits to the nearest whole subunit", () => {
    expect(amountInWords(10.004, EGP_WORDS)).toBe("عشرة جنيهات مصرية فقط لا غير");
    expect(amountInWords(10.006, EGP_WORDS)).toBe("عشرة جنيهات مصرية وقرش واحد فقط لا غير");
  });

  it("carries a subunit rounding overflow into the main unit", () => {
    expect(amountInWords(1.999, EGP_WORDS)).toBe("جنيهان مصريان فقط لا غير");
  });

  it("rejects negative and non-finite values", () => {
    expect(() => amountInWords(-1, EGP_WORDS)).toThrow(RangeError);
    expect(() => amountInWords(Number.NaN, EGP_WORDS)).toThrow(RangeError);
  });
});
