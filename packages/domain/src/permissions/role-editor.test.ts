import { describe, it, expect } from "vitest";
import { togglePermission, toggleAll } from "./role-editor.js";

describe("togglePermission", () => {
  it("selecting a permission auto-selects its dependencies", () => {
    const next = togglePermission(new Set(), "sales.invoice.confirm");
    expect(next.has("sales.invoice.confirm")).toBe(true);
    expect(next.has("sales.invoice.view_own")).toBe(true);
  });

  it("selecting a multi-hop permission pulls in the full chain", () => {
    // purchases.rfq.convert depends on purchases.rfq.view AND purchases.order.create,
    // and purchases.order.create itself depends on purchases.order.view.
    const next = togglePermission(new Set(), "purchases.rfq.convert");
    expect(next).toEqual(
      new Set([
        "purchases.rfq.convert",
        "purchases.rfq.view",
        "purchases.order.create",
        "purchases.order.view",
      ]),
    );
  });

  it("deselecting a permission that nothing else depends on just removes it", () => {
    const selected = new Set(["sales.invoice.view_own", "sales.invoice.print"]);
    const next = togglePermission(selected, "sales.invoice.print");
    expect(next.has("sales.invoice.print")).toBe(false);
    expect(next.has("sales.invoice.view_own")).toBe(true);
  });

  it("deselecting a prerequisite cascades to remove everything that depends on it", () => {
    const selected = togglePermission(new Set(), "sales.invoice.confirm");
    expect(selected.has("sales.invoice.view_own")).toBe(true);
    expect(selected.has("sales.invoice.confirm")).toBe(true);

    const next = togglePermission(selected, "sales.invoice.view_own");
    expect(next.has("sales.invoice.view_own")).toBe(false);
    expect(next.has("sales.invoice.confirm")).toBe(false);
  });

  it("is idempotent: toggling on then off returns to the original set", () => {
    const start = new Set(["sales.invoice.view_own"]);
    const toggledOn = togglePermission(start, "sales.invoice.confirm");
    const toggledOff = togglePermission(toggledOn, "sales.invoice.confirm");
    expect(toggledOff).toEqual(start);
  });
});

describe("toggleAll", () => {
  const dashboardCodes = ["dashboard.view", "dashboard.export"];

  it("selecting a module's codes closes over dependencies", () => {
    const next = toggleAll(new Set(), dashboardCodes, true);
    expect(next.has("dashboard.view")).toBe(true);
    expect(next.has("dashboard.export")).toBe(true);
  });

  it("deselecting a module removes its codes and any surviving dependents", () => {
    const selected = toggleAll(new Set(), dashboardCodes, true);
    const next = toggleAll(selected, dashboardCodes, false);
    expect(next.size).toBe(0);
  });

  it("deselecting one module does not disturb an unrelated module's grants", () => {
    const selected = toggleAll(
      toggleAll(new Set(), dashboardCodes, true),
      ["sales.invoice.view_own"],
      true,
    );
    const next = toggleAll(selected, dashboardCodes, false);
    expect(next.has("sales.invoice.view_own")).toBe(true);
    expect(next.has("dashboard.view")).toBe(false);
  });
});
