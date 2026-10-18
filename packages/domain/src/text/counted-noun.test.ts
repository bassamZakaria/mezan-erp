import { describe, expect, it } from "vitest";
import { ArabicCase, CountLocale, CountedNoun, arabicDays, countPhrase } from "./counted-noun.js";

describe("countPhrase", () => {
  it("agrees an Arabic day count across every plural category", () => {
    expect(arabicDays(0)).toBe("0 يوم");
    expect(arabicDays(1)).toBe("يوم واحد");
    expect(arabicDays(2)).toBe("يومان");
    expect(arabicDays(2, ArabicCase.Oblique)).toBe("يومين");
    expect(arabicDays(3)).toBe("3 أيام");
    expect(arabicDays(10)).toBe("10 أيام");
    expect(arabicDays(11)).toBe("11 يومًا");
    expect(arabicDays(99)).toBe("99 يومًا");
    expect(arabicDays(100)).toBe("100 يوم");
    expect(arabicDays(103)).toBe("103 أيام");
  });

  it("agrees the other counted nouns", () => {
    expect(countPhrase(CountLocale.Ar, 5, CountedNoun.Invoice)).toBe("5 فواتير");
    expect(countPhrase(CountLocale.Ar, 12, CountedNoun.Customer)).toBe("12 عميلًا");
    expect(countPhrase(CountLocale.Ar, 1, CountedNoun.Item)).toBe("صنف واحد");
    expect(countPhrase(CountLocale.Ar, 2, CountedNoun.Invoice, { grammaticalCase: ArabicCase.Oblique })).toBe("فاتورتين");
  });

  it("pluralises English", () => {
    expect(countPhrase(CountLocale.En, 1, CountedNoun.Day)).toBe("1 day");
    expect(countPhrase("en", 7, CountedNoun.Customer)).toBe("7 customers");
  });
});
