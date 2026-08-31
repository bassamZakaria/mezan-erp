import { describe, expect, it } from "vitest";
import { amountInWords, EGP_WORDS, type ArabicCurrencyWords } from "./amount-in-words";

const LIRA_WORDS: ArabicCurrencyWords = {
  main: { singular: "ليرة", dual: "ليرتان", plural: "ليرات", gender: "feminine" },
  subunit: { singular: "قرش", dual: "قرشان", plural: "قروش", gender: "masculine" },
};

describe("amountInWords — remaining branches", () => {
  it("uses the singular + واحدة feminine adjective for exactly 1 feminine main unit", () => {
    expect(amountInWords(1, LIRA_WORDS)).toBe("ليرة واحدة فقط لا غير");
  });

  it("uses the feminine عشر form (not the masculine عشرة) for exactly 10 feminine units", () => {
    expect(amountInWords(10, LIRA_WORDS)).toBe("عشر ليرات فقط لا غير");
  });

  it("renders a hundred-plus-ones numeral, joining the ones digit with و", () => {
    expect(amountInWords(101, EGP_WORDS)).toBe("مائة وواحد جنيه مصري فقط لا غير");
  });

  it("renders an amount with no main units, spelling out the subunit alone", () => {
    expect(amountInWords(0.5, EGP_WORDS)).toBe("خمسون قرش فقط لا غير");
  });

  it("refuses to spell out a value with more chunks than the largest known scale noun covers", () => {
    expect(() => amountInWords(1_000_000_000_000_000, EGP_WORDS)).toThrow(RangeError);
    expect(() => amountInWords(1_000_000_000_000_000, EGP_WORDS)).toThrow(
      "amountInWords: value is too large to spell out",
    );
  });
});
