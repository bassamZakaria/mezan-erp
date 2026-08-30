// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider, useTranslation, useUiTranslation } from "./I18nProvider";
import { uiCatalogs } from "./catalog";
import type { LocaleCatalogs } from "./translate";

const catalogs: LocaleCatalogs = { ar: { greet: "أهلاً {name}" }, en: { greet: "Hello {name}" } };

function Probe() {
  const { locale, direction, setLocale, t } = useTranslation();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="direction">{direction}</span>
      <span data-testid="text">{t("greet", { name: "Sam" })}</span>
      <button onClick={() => setLocale("en")}>to-en</button>
      <button onClick={() => setLocale("ar")}>to-ar</button>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

describe("I18nProvider / useTranslation", () => {
  it("defaults to Arabic, rtl, and stamps <html lang>/<html dir> accordingly", () => {
    render(
      <I18nProvider catalogs={catalogs}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("ar");
    expect(screen.getByTestId("direction")).toHaveTextContent("rtl");
    expect(screen.getByTestId("text")).toHaveTextContent("أهلاً Sam");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("switching locale flips <html dir> and <html lang> live, with no reload", () => {
    render(
      <I18nProvider catalogs={catalogs}>
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText("to-en"));
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("direction")).toHaveTextContent("ltr");
    expect(screen.getByTestId("text")).toHaveTextContent("Hello Sam");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");

    fireEvent.click(screen.getByText("to-ar"));
    expect(screen.getByTestId("direction")).toHaveTextContent("rtl");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("persists the chosen locale to localStorage", () => {
    render(
      <I18nProvider catalogs={catalogs}>
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText("to-en"));
    expect(window.localStorage.getItem("mezan.locale")).toBe("en");
  });

  it("a fresh mount picks up the persisted locale over the Arabic default", () => {
    window.localStorage.setItem("mezan.locale", "en");
    render(
      <I18nProvider catalogs={catalogs}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
  });

  it("initialLocale overrides the persisted choice — the SSR/test seam wins", () => {
    window.localStorage.setItem("mezan.locale", "en");
    render(
      <I18nProvider catalogs={catalogs} initialLocale="ar">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("ar");
  });

  it("falls back to the Arabic string when the active locale's catalog lacks the key, and reports the miss", () => {
    const onMissingKey = vi.fn();
    const partial: LocaleCatalogs = { ar: { onlyAr: "فقط بالعربية" }, en: {} };
    function OnlyArProbe() {
      const { t, setLocale } = useTranslation();
      return (
        <div>
          <span data-testid="text">{t("onlyAr")}</span>
          <button onClick={() => setLocale("en")}>to-en</button>
        </div>
      );
    }
    render(
      <I18nProvider catalogs={partial} initialLocale="en" onMissingKey={onMissingKey}>
        <OnlyArProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("text")).toHaveTextContent("فقط بالعربية");
    expect(onMissingKey).toHaveBeenCalledWith("onlyAr", "en");
  });

  it("useTranslation works with no provider in the tree, resolving the shared @mezan/ui catalog in Arabic", () => {
    function Bare() {
      const { t, locale } = useUiTranslation();
      return (
        <span data-testid="bare">
          {locale}:{t("shell.signOut")}
        </span>
      );
    }
    render(<Bare />);
    expect(screen.getByTestId("bare")).toHaveTextContent(`ar:${uiCatalogs.ar["shell.signOut"]}`);
  });

  it("useUiTranslation narrows to the same context as useTranslation, inside a provider", () => {
    function UiProbe() {
      const { t } = useUiTranslation();
      return <span data-testid="ui">{t("shell.signOut")}</span>;
    }
    render(
      <I18nProvider catalogs={uiCatalogs}>
        <UiProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("ui")).toHaveTextContent(uiCatalogs.ar["shell.signOut"]!);
  });
});
