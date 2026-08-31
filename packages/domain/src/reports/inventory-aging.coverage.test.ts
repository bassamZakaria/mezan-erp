import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryAgingReport } from "./inventory-aging.js";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { CostLayer } from "../inventory/cost-layer.js";

function layer(overrides: Partial<CostLayer> = {}): CostLayer {
  return {
    id: "layer-1",
    itemId: "item-a",
    warehouseId: "wh-1",
    unitCost: Money.fromMajor("10.00"),
    originalQty: Qty.fromMajor("10"),
    remainingQty: Qty.fromMajor("10"),
    sourceDocType: "PURCHASE_INVOICE",
    sourceDocId: "pi-1",
    sourceDocNumber: "PI-000001",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const items: Item[] = [{ id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" } as Item];
const warehouses: Warehouse[] = [
  { id: "wh-1", code: "WH1", name: "المستودع الرئيسي", nameEn: "Main Warehouse", branchId: "br-1", type: "MAIN", isDefault: true, active: true },
  { id: "wh-2", code: "WH2", name: "مستودع فرعي", nameEn: "Branch Warehouse", branchId: "br-1", type: "MAIN", isDefault: false, active: true },
];
const baseParams = { bucket: "" as const, search: "", warehouseId: "" };

describe("inventory-aging — age bucket boundaries", () => {
  it("buckets a 45-day-old layer as '30to90'", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ createdAt: "2026-07-08T00:00:00.000Z" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.ageDays).toBe(45);
    expect(outcome.rows[0]?.ageBucketLabel).toBe("30-90 يوم");
  });

  it("buckets a 120-day-old layer as '90to180'", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ createdAt: "2026-04-24T00:00:00.000Z" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.ageDays).toBe(120);
    expect(outcome.rows[0]?.ageBucketLabel).toBe("90-180 يوم");
  });

  it("buckets a 200-day-old layer as '180to365'", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ createdAt: "2026-02-03T00:00:00.000Z" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.ageDays).toBe(200);
    expect(outcome.rows[0]?.ageBucketLabel).toBe("180-365 يوم");
  });
});

describe("inventory-aging — warehouse filter", () => {
  it("keeps only layers in the requested warehouse and drops the rest", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(
      definition,
      { ...baseParams, warehouseId: "wh-2" },
      { items, warehouses, layers: [layer({ id: "l1", warehouseId: "wh-1" }), layer({ id: "l2", warehouseId: "wh-2" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.warehouseName).toBe("مستودع فرعي");
  });
});

describe("inventory-aging — missing reference data falls back to the raw id", () => {
  it("falls back to the item id when no item record matches", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ itemId: "item-unknown" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameAr).toBe("item-unknown");
  });

  it("falls back to the warehouse id when no warehouse record matches", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ warehouseId: "wh-unknown" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.warehouseName).toBe("wh-unknown");
  });
});

describe("inventory-aging — search filter", () => {
  it("keeps a row whose Arabic item name contains the (lower-cased) search text and drops one that doesn't", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(
      definition,
      { ...baseParams, search: "صنف" },
      { items, warehouses, layers: [layer({ id: "l1", itemId: "item-a" }), layer({ id: "l2", itemId: "item-b", warehouseId: "wh-2" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.itemNameAr).toBe("صنف أ");
  });
});

describe("inventory-aging — latest receipt across multiple layers", () => {
  it("reports the most recent createdAt among several layers as the last receipt date, regardless of array order", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(
      definition,
      baseParams,
      {
        items,
        warehouses,
        layers: [
          layer({ id: "l1", createdAt: "2026-08-10T00:00:00.000Z" }),
          layer({ id: "l2", createdAt: "2026-08-01T00:00:00.000Z" }),
          layer({ id: "l3", createdAt: "2026-08-15T00:00:00.000Z" }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.lastReceiptDate).toBe("2026-08-15");
    expect(outcome.rows[0]?.ageDays).toBe(21);
  });
});
