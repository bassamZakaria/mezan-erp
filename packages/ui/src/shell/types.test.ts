import { describe, expect, it } from "vitest";
import { filterNavGroups, isNavItemVisible, navGroupItems } from "./types";
import type { NavGroup } from "./types";

describe("navGroupItems", () => {
  it("returns only the direct items when the group has no sections", () => {
    const group: NavGroup = {
      key: "sell",
      label: "البيع",
      items: [{ key: "hub", label: "لوحة المبيعات" }],
    };
    expect(navGroupItems(group).map((i) => i.key)).toEqual(["hub"]);
  });

  it("flattens direct items and every section's items, in order", () => {
    const group: NavGroup = {
      key: "buy",
      label: "الشراء",
      items: [{ key: "hub", label: "لوحة المشتريات" }],
      sections: [
        { key: "daily", label: "اليومي", items: [{ key: "po", label: "أوامر الشراء" }] },
        { key: "reports", label: "التقارير", items: [{ key: "aging", label: "أعمار الموردين" }, { key: "spend", label: "الإنفاق" }] },
      ],
    };
    expect(navGroupItems(group).map((i) => i.key)).toEqual(["hub", "po", "aging", "spend"]);
  });

  it("returns an empty array for a group with no items and no sections", () => {
    const group: NavGroup = { key: "empty", label: "فارغ", items: [] };
    expect(navGroupItems(group)).toEqual([]);
  });

  it("skips a section that itself has no items", () => {
    const group: NavGroup = {
      key: "stock",
      label: "المخزون",
      items: [],
      sections: [{ key: "empty-section", label: "قسم فارغ", items: [] }],
    };
    expect(navGroupItems(group)).toEqual([]);
  });
});

/** guards P-3 — the rail used to render all 117 destinations for every seat. */
describe("nav visibility (P-3)", () => {
  const groups: NavGroup[] = [
    {
      key: "stock",
      label: "المخزون",
      items: [{ key: "stock-balance", label: "أرصدة المخزون", permission: "inventory.stock.view", module: "inventory" }],
    },
    {
      key: "money",
      label: "المحاسبة",
      items: [],
      sections: [
        { key: "daily", label: "اليومي", items: [{ key: "journals", label: "القيود المحاسبية", permission: "accounting.journal.view", module: "accounting" }] },
      ],
    },
    {
      key: "people",
      label: "الموارد البشرية",
      items: [{ key: "payroll", label: "الرواتب", permission: "hr.payroll.view", module: "hr" }],
    },
    { key: "setup", label: "الإعداد", items: [{ key: "settings-profile", label: "الملف الشخصي" }] },
  ];

  const warehouseKeeper = {
    permissions: ["inventory.stock.view", "inventory.transfer.view", "inventory.count.view"],
    activeModules: ["sales", "purchases", "inventory", "accounting", "hr"],
  };

  it("hides الرواتب and القيود المحاسبية from a warehouse keeper", () => {
    const keys = filterNavGroups(groups, warehouseKeeper).flatMap((g) => navGroupItems(g)).map((i) => i.key);
    expect(keys).toContain("stock-balance");
    expect(keys).not.toContain("payroll");
    expect(keys).not.toContain("journals");
  });

  it("drops a group and a section left with nothing in it", () => {
    const kept = filterNavGroups(groups, warehouseKeeper).map((g) => g.key);
    expect(kept).toEqual(["stock", "setup"]);
  });

  it("shows every destination to the `*` admin", () => {
    const keys = filterNavGroups(groups, { permissions: ["*"], activeModules: warehouseKeeper.activeModules })
      .flatMap((g) => navGroupItems(g))
      .map((i) => i.key);
    expect(keys).toEqual(["stock-balance", "journals", "payroll", "settings-profile"]);
  });

  it("hides a licensed-module screen the licence does not cover, even from the admin", () => {
    const item = { key: "work-orders", label: "أوامر التصنيع", permission: "manufacturing.wo.view", module: "manufacturing" };
    expect(isNavItemVisible(item, { permissions: ["*"], activeModules: ["sales"] })).toBe(false);
    expect(isNavItemVisible(item, { permissions: ["*"], activeModules: ["sales", "manufacturing"] })).toBe(true);
  });

  it("keeps every module row while the licence has not resolved yet", () => {
    const keys = filterNavGroups(groups, { permissions: ["*"], activeModules: null }).flatMap((g) => navGroupItems(g));
    expect(keys).toHaveLength(4);
  });

  it("keeps an item that declares no permission", () => {
    expect(isNavItemVisible({ key: "settings-profile", label: "الملف الشخصي" }, { permissions: [], activeModules: [] })).toBe(true);
  });
});
