import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, directionOf, isLocale, LOCALE_ENDONYM, LOCALE_SHORT_LABEL, LOCALES } from "./locale";

describe("locale", () => {
  it("Arabic is the default locale", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
  });

  it("lists exactly the two supported locales", () => {
    expect(LOCALES).toEqual(["ar", "en"]);
  });

  describe("directionOf", () => {
    it("Arabic is rtl", () => {
      expect(directionOf("ar")).toBe("rtl");
    });

    it("English is ltr", () => {
      expect(directionOf("en")).toBe("ltr");
    });
  });

  describe("isLocale", () => {
    it("accepts 'ar' and 'en'", () => {
      expect(isLocale("ar")).toBe(true);
      expect(isLocale("en")).toBe(true);
    });

    it("rejects anything else, including null, undefined, numbers and other strings", () => {
      expect(isLocale("fr")).toBe(false);
      expect(isLocale(null)).toBe(false);
      expect(isLocale(undefined)).toBe(false);
      expect(isLocale(1)).toBe(false);
      expect(isLocale("")).toBe(false);
    });
  });

  it("every language's endonym is its own name, not translated", () => {
    expect(LOCALE_ENDONYM.ar).toBe("العربية");
    expect(LOCALE_ENDONYM.en).toBe("English");
  });

  it("the short switcher label is distinct per locale", () => {
    expect(LOCALE_SHORT_LABEL.ar).toBe("ع");
    expect(LOCALE_SHORT_LABEL.en).toBe("EN");
  });
});
