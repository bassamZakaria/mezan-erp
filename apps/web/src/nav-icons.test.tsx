// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DIRECTIONAL_NAV_ICONS, navGroupIcon, navItemIcon } from "./nav-icons";

/**
 * The app is Arabic-first and runs RTL. An icon that POINTS has to flip; an
 * icon that carries an OBJECT must not — mirroring a clock or a building is the
 * usual overcorrection (§8.8).
 *
 * The rule lives in the registry's one render path, so a new nav entry cannot
 * reintroduce an unmirrored arrow.
 */
function classOf(node: ReturnType<typeof navItemIcon>): string {
  const { container } = render(<>{node}</>);
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

describe("nav icons mirror under RTL only when they carry a direction (§8.8)", () => {
  it("mirrors the transfer arrows, which read backwards in Arabic otherwise", () => {
    // «تحويلات المخزون» / «تحويل بين الخزائن» — an arrow pair that points the
    // wrong way is worse than no icon.
    expect(classOf(navItemIcon("stock-transfers"))).toContain("rtl:-scale-x-100");
  });

  it("does NOT mirror an icon that carries an object", () => {
    // Settings is a cog: it means the same thing in both directions.
    expect(classOf(navItemIcon("settings"))).not.toContain("rtl:-scale-x-100");
    expect(classOf(navGroupIcon("settings"))).not.toContain("rtl:-scale-x-100");
  });

  it("keeps the directional set small — an over-eager list is the failure mode here", () => {
    // Every entry has to be defensible as "this glyph points". If this number
    // climbs, someone has started mirroring objects.
    expect(DIRECTIONAL_NAV_ICONS.size).toBeLessThanOrEqual(12);
    expect(DIRECTIONAL_NAV_ICONS.size).toBeGreaterThan(0);
  });

  it("renders every icon with the same size and hides it from the accessibility tree", () => {
    // The mirroring must not have disturbed what the icon is FOR: it is
    // decoration beside a real label, and a screen reader should skip it.
    const { container } = render(<>{navItemIcon("dashboard")}</>);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden");
    expect(svg?.getAttribute("class")).toContain("h-[13px]");
  });

  it("returns nothing for a key with no icon, rather than an empty box", () => {
    expect(navItemIcon("no-such-nav-key")).toBeUndefined();
    expect(navGroupIcon("no-such-group")).toBeUndefined();
  });
});
