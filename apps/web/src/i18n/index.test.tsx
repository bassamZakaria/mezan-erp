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
});
