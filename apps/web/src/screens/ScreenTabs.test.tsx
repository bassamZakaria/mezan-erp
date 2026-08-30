// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, within } from "@testing-library/react";
import { ScreenTabs, type ScreenTab } from "./ScreenTabs";
import { renderWithProviders, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * `ScreenTabs` reads/writes tab state through `useSubPage()` (`../navigation`),
 * which reads from `NavigationContext` and no-ops outside a real
 * `NavigationProvider`. This stands in for it with in-memory segments — same
 * pattern as `TestNavigation` in `apps/web/src/screens/purchases-screens.test.tsx`.
 */
function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function renderTabs(tabs: readonly ScreenTab[], opts: { primaryCount?: number; moreLabel?: string } = {}) {
  return renderWithProviders(
    <TestNavigation>
      <ScreenTabs tabs={tabs} ariaLabel="أقسام الشاشة" primaryCount={opts.primaryCount} moreLabel={opts.moreLabel} />
    </TestNavigation>,
    { initialSession: testAdminSession },
  );
}

function tab(key: string, label: string): { tab: ScreenTab; render: ReturnType<typeof vi.fn> } {
  const render = vi.fn(() => <div>{`body-${key}`}</div>);
  return { tab: { key, label, render }, render };
}

describe("ScreenTabs", () => {
  it("defaults to the first tab when no segment matches, and only renders its own body", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    const c = tab("c", "ج");
    renderTabs([a.tab, b.tab, c.tab]);
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("body-a")).toBeInTheDocument();
    expect(a.render).toHaveBeenCalledTimes(1);
    expect(b.render).not.toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
  });

  it("clicking a non-first tab opens it (useSubPage.open) and lazily renders only that tab's body", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    renderTabs([a.tab, b.tab]);
    fireEvent.click(screen.getByRole("tab", { name: "ب" }));
    expect(screen.getByRole("tab", { name: "ب" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("body-b")).toBeInTheDocument();
    expect(screen.queryByText("body-a")).not.toBeInTheDocument();
    expect(b.render).toHaveBeenCalledTimes(1);
  });

  it("clicking the first tab closes the sub-page (useSubPage.close → segments become [])", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    renderTabs([a.tab, b.tab]);
    fireEvent.click(screen.getByRole("tab", { name: "ب" }));
    expect(screen.getByText("body-b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "أ" }));
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("body-a")).toBeInTheDocument();
  });

  it("an unknown segment falls back to the default (first) tab rather than an empty page", () => {
    function Wrapper() {
      const [segments] = useState<readonly string[]>(["not-a-real-tab"]);
      return (
        <NavigationProvider value={{ navigate: () => {}, segments, openSubPage: () => {}, openScreenAt: () => {}, intent: null, clearIntent: () => {} }}>
          <ScreenTabs
            tabs={[{ key: "a", label: "أ", render: () => <div>body-a</div> }, { key: "b", label: "ب", render: () => <div>body-b</div> }]}
            ariaLabel="أقسام الشاشة"
          />
        </NavigationProvider>
      );
    }
    renderWithProviders(<Wrapper />, { initialSession: testAdminSession });
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("body-a")).toBeInTheDocument();
  });

  it("RTL keyboard navigation: on this app's default Arabic (RTL) locale, ArrowRight steps BACK and ArrowLeft steps FORWARD", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    const c = tab("c", "ج");
    renderTabs([a.tab, b.tab, c.tab]);
    const tablist = screen.getByRole("tablist");
    // Starting at "أ" (index 0): ArrowLeft moves forward (RTL) to "ب".
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "ب" })).toHaveAttribute("aria-selected", "true");
    // ArrowRight from "ب" moves BACK (RTL) to "أ".
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "true");
  });

  it(
    "DEFECT-CANDIDATE (test-harness limitation, not necessarily a product bug): " +
      "AppProviders (apps/web/src/data/AppProviders.tsx) never forwards an `initialLocale` " +
      "to AppI18nProvider, so `renderWithProviders`/`test-support.tsx` has no way to force " +
      "the LTR/English locale in a test — the component always mounts at the persisted-or-" +
      "default locale (Arabic/RTL). The LTR-inverted half of ScreenTabs' arrow-key handling " +
      "(apps/web/src/screens/ScreenTabs.tsx's `direction === 'rtl'` branch) is therefore " +
      "UNVERIFIED by this test file — only the RTL branch above is exercised. Fixing this " +
      "would require adding a locale seam to AppProviders/test-support, which is out of " +
      "scope for a test-only change.",
    () => {
      const a = tab("a", "أ");
      const b = tab("b", "ب");
      renderTabs([a.tab, b.tab]);
      expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    },
  );

  it("Home/End jump to the first/last tab", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    const c = tab("c", "ج");
    renderTabs([a.tab, b.tab, c.tab]);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: "ج" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: "أ" })).toHaveAttribute("aria-selected", "true");
  });

  it("folds extra tabs beyond primaryCount into a RowMenu, but keeps the ACTIVE folded tab on the strip", () => {
    const a = tab("a", "أ");
    const b = tab("b", "ب");
    const c = tab("c", "ج");
    const d = tab("d", "د");
    renderTabs([a.tab, b.tab, c.tab, d.tab], { primaryCount: 2, moreLabel: "المزيد من الأقسام" });
    // Only the first 2 (primaryCount) show as strip tabs; c/d fold into the menu.
    expect(screen.getByRole("tab", { name: "أ" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ب" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "ج" })).not.toBeInTheDocument();

    const menuButton = screen.getByRole("button", { name: "المزيد من الأقسام" });
    fireEvent.click(menuButton);
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "ج" }));

    // The now-active "ج" is pulled onto the strip as a real tab, not left buried in the menu.
    expect(screen.getByRole("tab", { name: "ج" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("body-c")).toBeInTheDocument();
  });
});
