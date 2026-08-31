import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryExpiringReport } from "./inventory-expiring.js";
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
    batchNo: "BATCH-1",
    expiryDate: "2026-09-01",
    ...overrides,
  };
}

const items: Item[] = [
  {
    id: "item-a",
    code: "SKU-A",
    nameAr: "لبن كامل الدسم",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    seasonId: null,
    description: null,
    defaultSupplierId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: true,
    trackExpiry: true,
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
  } as Item,
];

const warehouses: Warehouse[] = [
  { id: "wh-1", code: "WH1", name: "المستودع الرئيسي", nameEn: "Main Warehouse", branchId: "br-1", type: "MAIN", isDefault: true, active: true },
];

const baseParams = { window: "" as const, search: "", warehouseId: "" };
const today = "2026-08-30";

describe("inventory-expiring — status label beyond 90 days", () => {
  it("labels a layer more than 90 days from expiry as 'أكثر من 90 يوم'", () => {
    const definition = createInventoryExpiringReport(today);
    const farOut = layer({ id: "far", expiryDate: "2026-12-15" }); // 107 days out
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [farOut] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.daysToExpiry).toBe(107);
    expect(outcome.rows[0]?.statusLabel).toBe("أكثر من 90 يوم");
  });
});

describe("inventory-expiring — missing reference data falls back to the raw id", () => {
  it("falls back to the item id and a null English name when no item record matches", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ itemId: "item-unknown" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameAr).toBe("item-unknown");
    expect(outcome.rows[0]?.itemNameEn).toBeNull();
  });

  it("falls back to the warehouse id when no warehouse record matches", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ warehouseId: "wh-unknown" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.warehouseName).toBe("wh-unknown");
  });
});

describe("inventory-expiring — an item record whose English name is stored as null", () => {
  it("carries a null English name through unchanged", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameEn).toBeNull();
  });
});

describe("inventory-expiring — optional layer fields", () => {
  it("renders an empty batch number when the layer carries none", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ batchNo: null })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.batchNo).toBe("");
  });

  it("falls back to the source document id when the layer has no source document number", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ sourceDocNumber: null, sourceDocId: "pi-77" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.sourceDocNumber).toBe("pi-77");
  });
});

describe("inventory-expiring — the 'expired' window excludes a not-yet-expired layer", () => {
  it("renders zero rows when the expired window is applied to a layer that has not expired yet", () => {
    const definition = createInventoryExpiringReport(today);
    const notExpired = layer({ id: "future", expiryDate: "2026-09-10" }); // 11 days out, not expired
    const outcome = runReport(definition, { ...baseParams, window: "expired" as const }, { items, warehouses, layers: [notExpired] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });
});
