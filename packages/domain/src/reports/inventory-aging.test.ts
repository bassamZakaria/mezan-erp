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
const warehouses: Warehouse[] = [{ id: "wh-1", code: "WH1", name: "المستودع الرئيسي", branchId: "br-1", type: "MAIN", isDefault: true, active: true }];
const baseParams = { bucket: "" as const, search: "", warehouseId: "" };

describe("createInventoryAgingReport", () => {
  it("computes age from the OLDEST surviving layer, not the newest", () => {
    const today = "2026-08-22"; // 21 days after the old layer, 1 day after the new one
    const definition = createInventoryAgingReport(today);
    const outcome = runReport(
      definition,
      baseParams,
      {
        items,
        warehouses,
        layers: [layer({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }), layer({ id: "new", createdAt: "2026-08-21T00:00:00.000Z" })],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.ageDays).toBe(21);
    expect(outcome.rows[0]?.ageBucketLabel).toBe("أقل من 30 يوم");
  });

  it("buckets a layer older than 365 days as 'over365'", () => {
    const today = "2027-09-01";
    const definition = createInventoryAgingReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ createdAt: "2026-08-01T00:00:00.000Z" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.ageBucketLabel).toBe("أكثر من 365 يوم");
  });

  it("excludes fully-consumed layers (remainingQty = 0)", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ remainingQty: Qty.zero() })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("filters by age bucket param", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(
      definition,
      { ...baseParams, bucket: "over365" },
      { items, warehouses, layers: [layer({ createdAt: "2026-08-01T00:00:00.000Z" })] }, // only 21 days old
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("sums remaining qty and value across multiple layers in the same position", () => {
    const definition = createInventoryAgingReport("2026-08-22");
    const outcome = runReport(
      definition,
      baseParams,
      { items, warehouses, layers: [layer({ id: "l1", remainingQty: Qty.fromMajor("3"), unitCost: Money.fromMajor("10.00") }), layer({ id: "l2", remainingQty: Qty.fromMajor("2"), unitCost: Money.fromMajor("20.00") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.qty).toBe(5);
    expect(outcome.rows[0]?.totalValue).toBe(70); // 3*10 + 2*20
  });
});
