import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryStockLevelsReport } from "./inventory-stock-levels.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-a",
    code: "SKU-A",
    nameAr: "صنف أ",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  } as Item;
}

function snapshot(overrides: Partial<WacSnapshot> = {}): WacSnapshot {
  return { itemId: "item-a", warehouseId: "wh-1", onHand: Qty.fromMajor("10"), totalValue: Money.fromMajor("1000.00"), averageCost: Money.fromMajor("100.00"), ...overrides };
}

describe("createInventoryStockLevelsReport", () => {
  it("flags an item under its reorder point as low", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(definition, { warehouseId: "", search: "" }, { items: [item({ reorderPoint: 20 })], snapshots: [snapshot({ onHand: Qty.fromMajor("10") })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.status).toBe("low");
  });

  it("flags a zero-stock item as out regardless of reorder point", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(definition, { warehouseId: "", search: "" }, { items: [item()], snapshots: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.status).toBe("out");
    expect(outcome.rows[0]?.onHand).toBe(0);
  });

  it("aggregates on-hand and value across multiple warehouses for one item", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(
      definition,
      { warehouseId: "", search: "" },
      {
        items: [item({ reorderPoint: 5 })],
        snapshots: [
          snapshot({ warehouseId: "wh-1", onHand: Qty.fromMajor("10"), totalValue: Money.fromMajor("1000.00") }),
          snapshot({ warehouseId: "wh-2", onHand: Qty.fromMajor("5"), totalValue: Money.fromMajor("500.00") }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.warehouseCount).toBe(2);
    expect(outcome.rows[0]?.onHand).toBe(15);
    expect(outcome.rows[0]?.value).toBe(1500);
    expect(outcome.rows[0]?.status).toBe("normal");
  });

  it("filters to a single warehouse when warehouseId is set", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(
      definition,
      { warehouseId: "wh-1", search: "" },
      {
        items: [item()],
        snapshots: [snapshot({ warehouseId: "wh-1", onHand: Qty.fromMajor("10") }), snapshot({ warehouseId: "wh-2", onHand: Qty.fromMajor("5") })],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.onHand).toBe(10);
  });

  it("excludes service items entirely", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(definition, { warehouseId: "", search: "" }, { items: [item({ type: "service" })], snapshots: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });
});
