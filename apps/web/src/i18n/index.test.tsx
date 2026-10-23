// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

async function freshI18n() {
  vi.resetModules();
  return { i18n: await import("./index"), toggle: await import("./LanguageToggle") };
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

describe("AppI18nProvider — English loads on demand", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a saved English preference blank until the English strings arrive, then renders English", async () => {
    const { i18n } = await freshI18n();
    function Probe() {
      return <span data-testid="text">{i18n.useAppTranslation().t("update.download")}</span>;
    }
    window.localStorage.setItem("mezan.locale", "en");
    const { container } = render(
      <i18n.AppI18nProvider>
        <Probe />
      </i18n.AppI18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByText("Download update")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("keeps Arabic on screen while switching, and flips to English once it has loaded", async () => {
    const { i18n, toggle } = await freshI18n();
    function Probe() {
      return <span data-testid="text">{i18n.useAppTranslation().t("update.download")}</span>;
    }
    render(
      <i18n.AppI18nProvider initialLocale="ar">
        <Probe />
        <toggle.LanguageToggle />
      </i18n.AppI18nProvider>,
    );
    expect(i18n.loadedEnglishCatalog()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByTestId("text")).toHaveTextContent("تنزيل التحديث");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(await screen.findByText("Download update")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(window.localStorage.getItem("mezan.locale")).toBe("en");
  });

  it("clears the reload-once mark after the English strings load", async () => {
    const { i18n } = await freshI18n();
    window.sessionStorage.setItem("mezan.reloadedForCatalog", "1");
    window.localStorage.setItem("mezan.locale", "en");
    render(
      <i18n.AppI18nProvider>
        <span>ready</span>
      </i18n.AppI18nProvider>,
    );
    await vi.waitFor(() => expect(window.sessionStorage.getItem("mezan.reloadedForCatalog")).toBeNull());
  });

  describe("when the English strings cannot be fetched", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      vi.resetModules();
      vi.doMock("./catalog-en", () => {
        throw new Error("chunk 404 after a deploy");
      });
    });
    afterEach(() => vi.doUnmock("./catalog-en"));

    it("keeps Arabic on a user's switch, says so, and never reloads over what is on screen", async () => {
      const i18n = await import("./index");
      const toggle = await import("./LanguageToggle");
      function Probe() {
        return <span data-testid="text">{i18n.useAppTranslation().t("update.download")}</span>;
      }
      render(
        <i18n.AppI18nProvider initialLocale="ar">
          <Probe />
          <toggle.LanguageToggle />
        </i18n.AppI18nProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "English" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل الواجهة الإنجليزية");
      expect(screen.getByTestId("text")).toHaveTextContent("تنزيل التحديث");
      expect(window.sessionStorage.getItem("mezan.reloadedForCatalog")).toBeNull();
      expect(window.localStorage.getItem("mezan.locale")).not.toBe("en");
    });

    it("reloads once for the new build when a saved English preference meets an empty screen", async () => {
      const i18n = await import("./index");
      window.localStorage.setItem("mezan.locale", "en");
      function Probe() {
        return <span data-testid="text">{i18n.useAppTranslation().t("update.download")}</span>;
      }
      render(
        <i18n.AppI18nProvider>
          <Probe />
        </i18n.AppI18nProvider>,
      );
      await vi.waitFor(() => expect(window.sessionStorage.getItem("mezan.reloadedForCatalog")).toBe("1"));
      expect(await screen.findByTestId("text")).toHaveTextContent("تنزيل التحديث");
    });
  });
});
