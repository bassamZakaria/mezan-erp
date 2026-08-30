import { describe, expect, it } from "vitest";
import { navGroupItems } from "./types";
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
