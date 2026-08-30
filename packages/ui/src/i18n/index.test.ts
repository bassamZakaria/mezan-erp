import { describe, expect, it } from "vitest";
import * as i18n from "./index";

describe("i18n barrel", () => {
  it("re-exports the locale primitives", () => {
    expect(i18n.DEFAULT_LOCALE).toBe("ar");
    expect(i18n.LOCALES).toEqual(["ar", "en"]);
    expect(i18n.isLocale("en")).toBe(true);
    expect(i18n.directionOf("en")).toBe("ltr");
    expect(i18n.LOCALE_ENDONYM.ar).toBe("العربية");
    expect(i18n.LOCALE_SHORT_LABEL.en).toBe("EN");
  });

  it("re-exports the translation primitives", () => {
    expect(typeof i18n.translate).toBe("function");
    expect(typeof i18n.interpolate).toBe("function");
    expect(typeof i18n.humanizeKey).toBe("function");
    expect(typeof i18n.mergeCatalogs).toBe("function");
  });

  it("re-exports the storage helpers", () => {
    expect(typeof i18n.loadPersistedLocale).toBe("function");
    expect(typeof i18n.persistLocale).toBe("function");
  });

  it("re-exports the ui catalog", () => {
    expect(i18n.uiCatalogs.ar["shell.signOut"]).toBeDefined();
    expect(i18n.uiCatalogs.en["shell.signOut"]).toBeDefined();
  });

  it("re-exports the provider and hooks", () => {
    expect(typeof i18n.I18nProvider).toBe("function");
    expect(typeof i18n.useTranslation).toBe("function");
    expect(typeof i18n.useUiTranslation).toBe("function");
  });
});
