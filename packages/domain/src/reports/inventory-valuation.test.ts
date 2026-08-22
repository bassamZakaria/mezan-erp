import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryValuationReport } from "./inventory-valuation.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";

function item(overrides: Partial<Item> = {}): Item {
  return { id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brand: null, costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active", ...overrides } as Item;
}
function snapshot(overrides: Partial<WacSnapshot> = {}): WacSnapshot {
  return { itemId: "item-a", warehouseId: "wh-1", onHand: Qty.fromMajor("10"), totalValue: Money.fromMajor("1000.00"), averageCost: Money.fromMajor("100.00"), ...overrides };
}

describe("createInventoryValuationReport", () => {
  it("computes unit cost as totalValue / onHand across warehouses", () => {
    const definition = createInventoryValuationReport();
    const outcome = runReport(
      definition,
      { search: "", warehouseId: "" },
      {
        items: [item()],
        snapshots: [snapshot({ warehouseId: "wh-1", onHand: Qty.fromMajor("6"), totalValue: Money.fromMajor("600.00") }), snapshot({ warehouseId: "wh-2", onHand: Qty.fromMajor("4"), totalValue: Money.fromMajor("400.00") })],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.onHand).toBe(10);
    expect(outcome.rows[0]?.totalValue).toBe(1000);
    expect(outcome.rows[0]?.unitCost).toBe(100);
  });

  it("excludes items with no stock position at all", () => {
    const definition = createInventoryValuationReport();
    const outcome = runReport(definition, { search: "", warehouseId: "" }, { items: [item()], snapshots: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("filters by search text against name and code", () => {
    const definition = createInventoryValuationReport();
    const outcome = runReport(
      definition,
      { search: "SKU-B", warehouseId: "" },
      { items: [item({ id: "item-a", code: "SKU-A" }), item({ id: "item-b", code: "SKU-B", nameAr: "صنف ب" })], snapshots: [snapshot(), snapshot({ itemId: "item-b" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.itemId).toBe("item-b");
  });

  it("sums the totalValue grand total across items", () => {
    const definition = createInventoryValuationReport();
    const outcome = runReport(
      definition,
      { search: "", warehouseId: "" },
      { items: [item({ id: "item-a" }), item({ id: "item-b", code: "SKU-B" })], snapshots: [snapshot(), snapshot({ itemId: "item-b", totalValue: Money.fromMajor("250.00") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.grandTotals.totalValue).toBe(1250);
  });
});
