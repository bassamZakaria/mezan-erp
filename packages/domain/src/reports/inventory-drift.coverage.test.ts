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
const items: Item[] = [{ id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" } as Item];
const warehouses: Warehouse[] = [{ id: "wh-1", code: "WH1", name: "المستودع الرئيسي", nameEn: "Main Warehouse", branchId: "br-1", type: "MAIN", isDefault: true, active: true }];

describe("inventory-drift — quantity-only drift and the type filter", () => {
  it("flags a position whose cached quantity disagrees while its value matches, as a qty-only drift", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ onHand: Qty.fromMajor("8"), totalValue: Money.fromMajor("100.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.typeLabel).toBe("فارق كمية فقط");
  });

  it("excludes a qty-only drift when the value-only filter is requested", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "value" },
      { snapshots: [snapshot({ onHand: Qty.fromMajor("8"), totalValue: Money.fromMajor("100.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes a value-only drift when the qty-only filter is requested", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "qty" },
      { snapshots: [snapshot({ totalValue: Money.fromMajor("150.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("keeps a qty-only drift when the qty-only filter is requested", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "qty" },
      { snapshots: [snapshot({ onHand: Qty.fromMajor("8"), totalValue: Money.fromMajor("100.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
  });
});

describe("inventory-drift — sign of the cache drift", () => {
  it("computes a positive drift magnitude when the recomputed value exceeds the cached value", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ totalValue: Money.fromMajor("50.00"), averageCost: Money.fromMajor("5.00") })], movements: [movement()], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.valueDiff).toBe(50); // recomputed(100) - cached(50)
  });
});

describe("inventory-drift — an over-issued ledger drives the recomputed value negative", () => {
  it("computes a negative recomputed value when the ledger issues more than it ever received", () => {
    const definition = createInventoryDriftReport();
    const overIssue = movement({ id: "m-out", direction: "OUT", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("10.00") });
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ onHand: Qty.zero(), totalValue: Money.zero(), averageCost: Money.zero() })], movements: [overIssue], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.onHand).toBe(-5);
    expect(outcome.rows[0]?.valueDiff).toBe(-50); // recomputed(-50) - cached(0)
    expect(outcome.rows[0]?.maxPctDrift).toBe(100);
  });
});

describe("inventory-drift — no recomputed value to measure a percentage against", () => {
  it("renders maxPctDrift as 0 when the recomputed value is exactly zero but the cache disagrees", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      { snapshots: [snapshot({ onHand: Qty.zero(), totalValue: Money.fromMajor("50.00"), averageCost: Money.zero() })], movements: [], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.maxPctDrift).toBe(0);
  });
});

describe("inventory-drift — missing reference data falls back to the raw id", () => {
  it("falls back to the item id when no item record matches", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      {
        snapshots: [snapshot({ itemId: "item-unknown", totalValue: Money.fromMajor("150.00") })],
        movements: [movement({ itemId: "item-unknown" })],
        items,
        warehouses,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameAr).toBe("item-unknown");
  });

  it("falls back to the warehouse id when no warehouse record matches", () => {
    const definition = createInventoryDriftReport();
    const outcome = runReport(
      definition,
      { type: "" },
      {
        snapshots: [snapshot({ warehouseId: "wh-unknown", totalValue: Money.fromMajor("150.00") })],
        movements: [movement({ warehouseId: "wh-unknown" })],
        items,
        warehouses,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.warehouseName).toBe("wh-unknown");
  });
});
