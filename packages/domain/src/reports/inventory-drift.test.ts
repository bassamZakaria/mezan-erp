import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryDriftReport } from "./inventory-drift.js";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { StockMovement } from "../inventory/movement.js";

function movement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "m1", itemId: "item-a", warehouseId: "wh-1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("10.00"),
    sourceDocType: "PURCHASE_INVOICE", sourceDocId: "pi-1", sourceDocNumber: "PI-1", reason: null, occurredAt: "2026-08-01T00:00:00.000Z", ...overrides,
  };
}
function snapshot(overrides: Partial<WacSnapshot> = {}): WacSnapshot {
  return { itemId: "item-a", warehouseId: "wh-1", onHand: Qty.fromMajor("10"), totalValue: Money.fromMajor("100.00"), averageCost: Money.fromMajor("10.00"), ...overrides };
}
const items: Item[] = [{ id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, specifications: [], costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" } as Item];
const warehouses: Warehouse[] = [{ id: "wh-1", code: "WH1", name: "المستودع الرئيسي", branchId: "br-1", type: "MAIN", isDefault: true, active: true }];

describe("createInventoryDriftReport", () => {
  it("flags a position whose cached value diverges from the replayed ledger", () => {
    const definition = createInventoryDriftReport();
    // Ledger replay: 10 units received @10.00 = 100.00 total value. Cached snapshot says 150.00 — a stale/corrupted cache.
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ totalValue: Money.fromMajor("150.00"), averageCost: Money.fromMajor("15.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.valueDiff).toBe(-50); // recomputed(100) - cached(150)
    expect(outcome.rows[0]?.recomputedAverageCost).toBe(10);
    expect(outcome.rows[0]?.cachedAverageCost).toBe(15);
  });

  it("excludes a position where the cache exactly matches the replayed ledger", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(definition, { type: "" }, { snapshots: [snapshot()], movements: [movement()], items, warehouses });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("detects a quantity drift (cached onHand disagrees with the replayed ledger)", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ onHand: Qty.fromMajor("8"), totalValue: Money.fromMajor("80.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.typeLabel).toBe("فارق قيمة وكمية");
  });

  it("filters to value-only drift when type=value is requested", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "value" },
      {
        snapshots: [
          snapshot({ itemId: "item-a", totalValue: Money.fromMajor("150.00") }), // value diff only
        ],
        movements: [movement({ itemId: "item-a" })],
        items,
        warehouses,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
  });

  it("resolves item/warehouse Arabic names", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(definition, { type: "" }, { snapshots: [snapshot({ totalValue: Money.fromMajor("200.00") })], movements: [movement()], items, warehouses });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameAr).toBe("صنف أ");
    expect(outcome.rows[0]?.warehouseName).toBe("المستودع الرئيسي");
  });
});
