// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChromeActions, HelpButton, LanguageToggle, ThemeToggle } from "./ChromeActions";
import { I18nProvider } from "../i18n/I18nProvider";
import { uiCatalogs } from "../i18n/catalog";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  window.localStorage.clear();
});

describe("LanguageToggle", () => {
  it("offers to switch to English while Arabic is active, and flips <html lang>/<html dir> on click", () => {
    render(
      <I18nProvider catalogs={uiCatalogs}>
        <LanguageToggle />
      </I18nProvider>,
    );
    const button = screen.getByRole("button", { name: "التبديل إلى الإنجليزية" });
    fireEvent.click(button);
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("offers to switch back to Arabic once English is active", () => {
    render(
      <I18nProvider catalogs={uiCatalogs} initialLocale="en">
        <LanguageToggle />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Switch to Arabic" })).toBeInTheDocument();
  });
});

describe("ThemeToggle", () => {
  it("owns its own useTheme when no theme/onToggleTheme is supplied", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("is driven by the caller when theme/onToggleTheme are supplied", () => {
    const onToggleTheme = vi.fn();
    render(<ThemeToggle theme="dark" onToggleTheme={onToggleTheme} />);
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });
});

describe("HelpButton", () => {
  it("calls onShowHelp when clicked", () => {
    const onShowHelp = vi.fn();
    render(<HelpButton onShowHelp={onShowHelp} />);
    fireEvent.click(screen.getByRole("button", { name: "اختصارات لوحة المفاتيح" }));
    expect(onShowHelp).toHaveBeenCalledOnce();
  });
});

describe("ChromeActions", () => {
  it("renders help, language and appearance as a named group, in that order", () => {
    const onShowHelp = vi.fn();
    render(
      <I18nProvider catalogs={uiCatalogs}>
        <ChromeActions onShowHelp={onShowHelp} />
      </I18nProvider>,
    );
    const group = screen.getByRole("group", { name: "أدوات الواجهة" });
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName("اختصارات لوحة المفاتيح");
    expect(buttons[1]).toHaveAccessibleName("التبديل إلى الإنجليزية");
    expect(buttons[2]).toHaveAccessibleName("تبديل المظهر");
  });

  it("omits the help button entirely when onShowHelp is not supplied", () => {
    render(
      <I18nProvider catalogs={uiCatalogs}>
        <ChromeActions />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "اختصارات لوحة المفاتيح" })).toBeNull();
    expect(screen.getByRole("group", { name: "أدوات الواجهة" }).querySelectorAll("button")).toHaveLength(2);
  });
});
