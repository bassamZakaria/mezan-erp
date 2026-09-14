import { describe, it, expect } from "vitest";
import type { DashboardLayout } from "@mezan/domain";
import {
  availableDashboardWidgets,
  defaultDashboardLayout,
  resolveDashboardWidgets,
} from "./widget-registry";

const ALL = () => true;
const NONE = () => false;

function layout(widgets: Partial<DashboardLayout["widgets"][number]>[]): DashboardLayout {
  return {
    columns: 2,
    widgets: widgets.map((w, i) => ({
      id: w.kind ?? `w${i}`,
      kind: w.kind ?? "aging",
      column: w.column ?? 0,
      order: w.order ?? i,
      size: w.size ?? "md",
      visible: w.visible ?? true,
      settings: w.settings ?? {},
    })),
  };
}

describe("the dashboard layout a user actually gets (§8.5, §8.7)", () => {
  it("falls back to the default order when the user has chosen nothing", () => {
    const resolved = resolveDashboardWidgets(null, ALL);
    expect(resolved.map((w) => w.kind)).toEqual(["aging", "expenses", "topItems", "activity"]);
  });

  it("honours the order the user chose", () => {
    const chosen = layout([
      { kind: "activity", order: 0 },
      { kind: "aging", order: 1 },
      { kind: "expenses", order: 2 },
      { kind: "topItems", order: 3 },
    ]);
    expect(resolveDashboardWidgets(chosen, ALL).map((w) => w.kind)).toEqual([
      "activity",
      "aging",
      "expenses",
      "topItems",
    ]);
  });

  it("drops a widget the user hid", () => {
    const chosen = layout([
      { kind: "aging", order: 0, visible: false },
      { kind: "expenses", order: 1 },
      { kind: "topItems", order: 2 },
      { kind: "activity", order: 3 },
    ]);
    expect(resolveDashboardWidgets(chosen, ALL).map((w) => w.kind)).not.toContain("aging");
  });

  it("drops a widget the user may NOT read, whatever the stored layout says (§8.7)", () => {
    // The permission is checked when the layout is RESOLVED, not when it was
    // saved: a layout stored before a permission was revoked must degrade
    // quietly rather than render a card the user is not allowed to see.
    const canAllButAging = (p: string) => p !== "reports.aging.read";
    const resolved = resolveDashboardWidgets(defaultDashboardLayout(), canAllButAging);
    expect(resolved.map((w) => w.kind)).not.toContain("aging");
    expect(resolved.map((w) => w.kind)).toContain("expenses");
  });

  it("shows nothing at all to a user who may read none of it, rather than erroring", () => {
    expect(resolveDashboardWidgets(defaultDashboardLayout(), NONE)).toEqual([]);
  });

  it("drops a widget the layout names but the product no longer has", () => {
    // An old layout must not blank the screen with a card that has no component.
    const stale = layout([{ kind: "a-widget-that-was-removed", order: 0 }, { kind: "aging", order: 1 }]);
    const resolved = resolveDashboardWidgets(stale, ALL).map((w) => w.kind);
    expect(resolved).not.toContain("a-widget-that-was-removed");
    // The widgets this layout never named are appended, which is the rule the
    // test below covers — what matters here is that the dead one is gone.
    expect(resolved).toContain("aging");
  });

  it("appends a widget the product gained since the layout was saved", () => {
    // Otherwise shipping a new panel would be invisible to every existing user
    // until they rebuilt their layout by hand.
    const old = layout([{ kind: "aging", order: 0 }]);
    const resolved = resolveDashboardWidgets(old, ALL).map((w) => w.kind);
    expect(resolved[0]).toBe("aging");
    expect(resolved).toContain("activity");
  });

  it("offers the editor only the widgets the user may read", () => {
    const canOnlySales = (p: string) => p === "sales.invoice.view";
    expect(availableDashboardWidgets(canOnlySales).map((w) => w.kind)).toEqual(["topItems"]);
  });

  it("gives every default widget a distinct id, so a stored layout can name one", () => {
    const ids = defaultDashboardLayout().widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
