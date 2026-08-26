import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryLedgerReport } from "./inventory-ledger.js";
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

const items: Item[] = [{ id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" } as Item];
const warehouses: Warehouse[] = [{ id: "wh-1", code: "WH1", name: "المستودع الرئيسي", branchId: "br-1", type: "MAIN", isDefault: true, active: true }];
const baseParams = { dateFrom: "", dateTo: "", itemId: "", warehouseId: "" };

describe("createInventoryLedgerReport", () => {
  it("computes a running balance in chronological order, per position", () => {
    const definition = createInventoryLedgerReport();
    const outcome = runReport(
      definition,
      baseParams,
      {
        movements: [
          movement({ id: "m1", direction: "IN", qty: Qty.fromMajor("10"), occurredAt: "2026-08-01T00:00:00.000Z" }),
          movement({ id: "m2", direction: "OUT", qty: Qty.fromMajor("3"), occurredAt: "2026-08-02T00:00:00.000Z" }),
          movement({ id: "m3", direction: "IN", qty: Qty.fromMajor("2"), occurredAt: "2026-08-03T00:00:00.000Z" }),
        ],
        items,
        warehouses,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.balance)).toEqual([10, 7, 9]);
  });

  it("keeps separate running balances for different item/warehouse positions", () => {
    const definition = createInventoryLedgerReport();
    const outcome = runReport(
      definition,
      baseParams,
      {
        movements: [
          movement({ id: "a1", itemId: "item-a", warehouseId: "wh-1", qty: Qty.fromMajor("10"), occurredAt: "2026-08-01T00:00:00.000Z" }),
          movement({ id: "b1", itemId: "item-b", warehouseId: "wh-1", qty: Qty.fromMajor("4"), occurredAt: "2026-08-01T01:00:00.000Z" }),
          movement({ id: "a2", itemId: "item-a", warehouseId: "wh-1", direction: "OUT", qty: Qty.fromMajor("1"), occurredAt: "2026-08-02T00:00:00.000Z" }),
        ],
        items,
        warehouses,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.movementId === "b1")?.balance).toBe(4);
    expect(outcome.rows.find((r) => r.movementId === "a2")?.balance).toBe(9);
  });

  it("defaults to full history when no date bounds are given", () => {
    const definition = createInventoryLedgerReport();
    const outcome = runReport(
      definition,
      baseParams,
      { movements: [movement({ occurredAt: "2020-01-01T00:00:00.000Z" }), movement({ id: "m2", occurredAt: "2030-01-01T00:00:00.000Z" })], items, warehouses },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(2);
  });
});
