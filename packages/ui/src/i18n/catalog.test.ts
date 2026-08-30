import { describe, expect, it } from "vitest";
import { uiCatalogs } from "./catalog";
import { interpolate } from "./translate";

const ARABIC_RANGE = /[؀-ۿ]/;
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();
}

describe("uiCatalogs", () => {
  it("every Arabic key has an English counterpart, and vice versa", () => {
    const arKeys = Object.keys(uiCatalogs.ar).sort();
    const enKeys = Object.keys(uiCatalogs.en).sort();
    expect(enKeys).toEqual(arKeys);
  });

  it("no catalog entry is an empty string", () => {
    for (const [locale, catalog] of Object.entries(uiCatalogs)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.length, `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("no Arabic string reaches the English catalog — the strings the shell renders in English carry no Arabic characters", () => {
    const offenders = Object.entries(uiCatalogs.en).filter(([, value]) => ARABIC_RANGE.test(value));
    expect(offenders).toEqual([]);
  });

  it("every English entry carries the same {placeholder} parameters as its Arabic source, so interpolation cannot silently drop one", () => {
    const mismatches: string[] = [];
    for (const key of Object.keys(uiCatalogs.ar)) {
      const arPlaceholders = placeholdersOf(uiCatalogs.ar[key as keyof typeof uiCatalogs.ar] ?? "");
      const enPlaceholders = placeholdersOf(uiCatalogs.en[key as keyof typeof uiCatalogs.en] ?? "");
      if (arPlaceholders.join(",") !== enPlaceholders.join(",")) mismatches.push(key);
    }
    expect(mismatches).toEqual([]);
  });

  it("a parameterized entry actually interpolates in both locales", () => {
    expect(interpolate(uiCatalogs.ar["shell.notifications.withCount"]!, { count: 3 })).toBe("الإشعارات (3)");
    expect(interpolate(uiCatalogs.en["shell.notifications.withCount"]!, { count: 3 })).toBe("Notifications (3)");
  });

  it("the endonyms used by shell.language.switchTo are themselves untranslated in both locales", () => {
    expect(uiCatalogs.ar["shell.language.name.ar"]).toBe("العربية");
    expect(uiCatalogs.en["shell.language.name.en"]).toBe("English");
  });
});
