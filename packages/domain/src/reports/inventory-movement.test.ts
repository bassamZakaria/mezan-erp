import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryMovementReport } from "./inventory-movement.js";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { StockMovement } from "../inventory/movement.js";

function movement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "m1",
    itemId: "item-a",
    warehouseId: "wh-1",
    direction: "IN",
    qty: Qty.fromMajor("5"),
    unitCost: Money.fromMajor("10.00"),
    sourceDocType: "PURCHASE_INVOICE",
    sourceDocId: "pi-1",
    sourceDocNumber: "PI-000001",
    reason: null,
    occurredAt: "2026-08-10T09:00:00.000Z",
    ...overrides,
  };
}

const items: Item[] = [
  { id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brand: null, costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" } as Item,
];
const warehouses: Warehouse[] = [{ id: "wh-1", code: "WH1", name: "المستودع الرئيسي", branchId: "br-1", type: "MAIN", isDefault: true, active: true }];

const baseParams = { dateFrom: "2026-08-01", dateTo: "2026-08-31", direction: "" as const, itemId: "", warehouseId: "" };

describe("createInventoryMovementReport", () => {
  it("lists IN and OUT movements with correct magnitude and Arabic direction label", () => {
    const definition = createInventoryMovementReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      baseParams,
      { movements: [movement({ id: "m1", direction: "IN", qty: Qty.fromMajor("5") }), movement({ id: "m2", direction: "OUT", qty: Qty.fromMajor("2") })], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows.find((r) => r.movementId === "m1")?.direction).toBe("وارد");
    expect(outcome.rows.find((r) => r.movementId === "m2")?.direction).toBe("صادر");
    expect(outcome.rows.find((r) => r.movementId === "m2")?.qty).toBe(2);
  });

  it("filters by direction", () => {
    const definition = createInventoryMovementReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { ...baseParams, direction: "OUT" },
      { movements: [movement({ id: "m1", direction: "IN" }), movement({ id: "m2", direction: "OUT" })], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.movementId).toBe("m2");
  });

  it("filters by date range", () => {
    const definition = createInventoryMovementReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      baseParams,
      { movements: [movement({ id: "in-range", occurredAt: "2026-08-15T00:00:00.000Z" }), movement({ id: "out-of-range", occurredAt: "2026-09-01T00:00:00.000Z" })], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.movementId)).toEqual(["in-range"]);
  });

  it("resolves the Arabic source-doc-type label", () => {
    const definition = createInventoryMovementReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, baseParams, { movements: [movement({ sourceDocType: "SALES_INVOICE" })], items, warehouses });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.sourceDocTypeLabel).toBe("فاتورة مبيعات");
  });

  it("sums the qty total column across all rows", () => {
    const definition = createInventoryMovementReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      baseParams,
      { movements: [movement({ id: "m1", qty: Qty.fromMajor("5") }), movement({ id: "m2", qty: Qty.fromMajor("3") })], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.grandTotals.qty).toBe(8);
  });
});
