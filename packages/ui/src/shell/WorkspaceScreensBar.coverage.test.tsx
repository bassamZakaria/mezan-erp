// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider";
import { uiCatalogs } from "../i18n/catalog";
import type { Locale } from "../i18n/locale";
import { WorkspaceScreensBar } from "./WorkspaceScreensBar";
import type { NavGroup } from "./types";

function renderBar(group: NavGroup | undefined, activeKey: string, locale: Locale = "ar") {
  return render(
    <I18nProvider catalogs={uiCatalogs} initialLocale={locale}>
      <WorkspaceScreensBar group={group} activeKey={activeKey} ariaLabel="شاشات المبيعات" />
    </I18nProvider>,
  );
}

function chips() {
  return screen.getAllByRole("listitem").map((li) => li.firstElementChild as HTMLElement);
}

function salesGroup(overrides: Partial<NavGroup> = {}): NavGroup {
  return {
    key: "sales",
    label: "المبيعات",
    items: [
      { key: "invoices", label: "فواتير المبيعات" },
      { key: "customers", label: "العملاء" },
      { key: "quotes", label: "عروض الأسعار" },
    ],
    ...overrides,
  };
}

describe("WorkspaceScreensBar — a workspace with nothing to show", () => {
  it("shows no chip at all when no workspace is selected", () => {
    renderBar(undefined, "invoices");
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("shows the lone screen of a one-screen workspace as the open one", () => {
    renderBar({ key: "sales", label: "المبيعات", items: [{ key: "invoices", label: "فواتير المبيعات" }] }, "invoices");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "فواتير المبيعات" })).toHaveAttribute("aria-current", "page");
  });
});

describe("WorkspaceScreensBar — what a chip carries", () => {
  it("draws an item's own icon and its tag beside the label", () => {
    renderBar(
      salesGroup({
        items: [
          { key: "invoices", label: "فواتير المبيعات", icon: <svg data-testid="invoice-icon" /> },
          { key: "pos", label: "نقطة البيع", tag: { label: "قريباً", tone: "soon" } },
          { key: "customers", label: "العملاء" },
        ],
      }),
      "invoices",
    );

    expect(screen.getByTestId("invoice-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /نقطة البيع/ })).toHaveTextContent("قريباً");
  });

  it("marks the open screen as the current page and leaves every other chip unmarked", () => {
    renderBar(salesGroup(), "customers");

    expect(screen.getByRole("button", { name: "العملاء" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "فواتير المبيعات" })).not.toHaveAttribute("aria-current");
  });

  it("renders a screen that carries an href as a real link, and still calls its handler on click", () => {
    const onClick = vi.fn();
    renderBar(
      salesGroup({
        items: [
          { key: "invoices", label: "فواتير المبيعات", href: "#/sales/invoices", onClick },
          { key: "customers", label: "العملاء" },
        ],
      }),
      "invoices",
    );

    const link = screen.getByRole("link", { name: "فواتير المبيعات" });
    expect(link).toHaveAttribute("href", "#/sales/invoices");
    expect(link).toHaveAttribute("aria-current", "page");

    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceScreensBar — the arrow keys invert with the writing direction", () => {
  function focusFirstAndPress(key: string) {
    const [first] = chips();
    first!.focus();
    fireEvent.keyDown(screen.getByRole("list"), { key });
  }

  it("steps BACK on ArrowRight and FORWARD on ArrowLeft in Arabic", () => {
    renderBar(salesGroup(), "invoices");
    const cells = chips();

    focusFirstAndPress("ArrowLeft");
    expect(document.activeElement).toBe(cells[1]);

    fireEvent.keyDown(screen.getByRole("list"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("steps FORWARD on ArrowRight and BACK on ArrowLeft in English", () => {
    renderBar(salesGroup(), "invoices", "en");
    const cells = chips();

    focusFirstAndPress("ArrowRight");
    expect(document.activeElement).toBe(cells[1]);

    fireEvent.keyDown(screen.getByRole("list"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("wraps around both ends rather than stopping at them", () => {
    renderBar(salesGroup(), "invoices");
    const cells = chips();

    focusFirstAndPress("ArrowRight");
    expect(document.activeElement).toBe(cells[2]);

    fireEvent.keyDown(screen.getByRole("list"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("jumps to the first and last chip on Home and End", () => {
    renderBar(salesGroup(), "invoices");
    const cells = chips();

    fireEvent.keyDown(screen.getByRole("list"), { key: "End" });
    expect(document.activeElement).toBe(cells[2]);

    fireEvent.keyDown(screen.getByRole("list"), { key: "Home" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("ignores a key that is not a step, leaving focus where it was", () => {
    renderBar(salesGroup(), "invoices");
    const cells = chips();
    cells[1]!.focus();

    fireEvent.keyDown(screen.getByRole("list"), { key: "a" });
    expect(document.activeElement).toBe(cells[1]);
  });

  it("steps from the open screen when focus is not on the strip at all", () => {
    renderBar(salesGroup(), "customers");
    const cells = chips();
    expect(document.activeElement).not.toBe(cells[1]);

    fireEvent.keyDown(screen.getByRole("list"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[2]);
  });
});
