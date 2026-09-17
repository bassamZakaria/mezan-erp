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
    nameEn: "Whole Milk",
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
  { id: "wh-1", code: "WH1", name: "المستودع الرئيسي", nameEn: "Main Warehouse", branchId: "br-1", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
];

const baseParams = { window: "" as const, search: "", warehouseId: "" };
const today = "2026-08-30";

describe("createInventoryExpiringReport", () => {
  it("renders honestly over an empty context", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items: [], warehouses: [], layers: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.totalValue).toBe(0);
    const totalValueKpi = outcome.kpis.find((k) => k.key === "totalValue");
    expect(totalValueKpi?.value).toBe(0);
    const batchCount = outcome.kpis.find((k) => k.key === "batchCount");
    expect(batchCount?.value).toBe(0);
  });

  it("rejects an invalid window enum value without throwing", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, { ...baseParams, window: "within45" }, { items: [], warehouses: [], layers: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.some((e) => e.field === "window")).toBe(true);
  });

  it("excludes layers with no expiry date", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [layer({ expiryDate: null })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes layers with zero or negative remaining quantity", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(
      definition,
      baseParams,
      { items, warehouses, layers: [layer({ id: "zeroed", remainingQty: Qty.zero() }), layer({ id: "over-issued", remainingQty: Qty.fromScaled(-1n) })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("computes totalValue as remainingQty x unitCost with round numbers", () => {
    const definition = createInventoryExpiringReport(today);
    const outcome = runReport(
      definition,
      baseParams,
      { items, warehouses, layers: [layer({ remainingQty: Qty.fromMajor("5"), unitCost: Money.fromMajor("20.00") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.qty).toBe(5);
    expect(outcome.rows[0]?.totalValue).toBe(100);
    expect(outcome.grandTotals.totalValue).toBe(100);
    const totalValueKpi = outcome.kpis.find((k) => k.key === "totalValue");
    expect(totalValueKpi?.value).toBe(100);
  });

  it("sorts by expiryDate then receivedOn — FEFO, earliest expiry first, ties broken by earliest receipt", () => {
    const definition = createInventoryExpiringReport(today);
    const x = layer({ id: "x", expiryDate: "2026-09-10", createdAt: "2026-08-05T00:00:00.000Z" });
    const y = layer({ id: "y", expiryDate: "2026-09-01", createdAt: "2026-08-01T00:00:00.000Z" });
    const z = layer({ id: "z", expiryDate: "2026-09-01", createdAt: "2026-08-03T00:00:00.000Z" });
    const outcome = runReport(definition, baseParams, { items, warehouses, layers: [x, z, y] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.key)).toEqual(["y", "z", "x"]);
  });

  it("buckets a layer with a negative days-to-expiry as expired, and includes it under the expired window", () => {
    const definition = createInventoryExpiringReport(today);
    const expiredLayer = layer({ id: "expired", expiryDate: "2026-08-29" }); // 1 day before today
    const outcomeNoFilter = runReport(definition, baseParams, { items, warehouses, layers: [expiredLayer] });
    expect(outcomeNoFilter.ok).toBe(true);
    if (!outcomeNoFilter.ok) return;
    expect(outcomeNoFilter.rows[0]?.daysToExpiry).toBe(-1);
    expect(outcomeNoFilter.rows[0]?.statusLabel).toBe("منتهي الصلاحية");

    const outcomeFiltered = runReport(definition, { ...baseParams, window: "expired" as const }, { items, warehouses, layers: [expiredLayer] });
    expect(outcomeFiltered.ok).toBe(true);
    if (!outcomeFiltered.ok) return;
    expect(outcomeFiltered.rows).toHaveLength(1);
  });

  it("includes the boundary day (30) in within30 and excludes day 31", () => {
    const definition = createInventoryExpiringReport(today);
    const boundary = layer({ id: "boundary-30", expiryDate: "2026-09-29" }); // exactly 30 days out
    const overBoundary = layer({ id: "over-30", expiryDate: "2026-09-30" }); // 31 days out

    const inWindow = runReport(definition, { ...baseParams, window: "within30" as const }, { items, warehouses, layers: [boundary] });
    expect(inWindow.ok).toBe(true);
    if (inWindow.ok) {
      expect(inWindow.rows).toHaveLength(1);
      expect(inWindow.rows[0]?.daysToExpiry).toBe(30);
    }

    const outOfWindow = runReport(definition, { ...baseParams, window: "within30" as const }, { items, warehouses, layers: [overBoundary] });
    expect(outOfWindow.ok).toBe(true);
    if (!outOfWindow.ok) return;
    expect(outOfWindow.rows).toHaveLength(0);
  });

  it("filters within60 and within90 windows, and renders zero rows when a window matches nothing", () => {
    const definition = createInventoryExpiringReport(today);
    const within60Layer = layer({ id: "l60", expiryDate: "2026-10-15" }); // 46 days out
    const within90Layer = layer({ id: "l90", expiryDate: "2026-11-20" }); // 82 days out

    const outcome60 = runReport(definition, { ...baseParams, window: "within60" as const }, { items, warehouses, layers: [within60Layer, within90Layer] });
    expect(outcome60.ok).toBe(true);
    if (outcome60.ok) expect(outcome60.rows.map((r) => r.key)).toEqual(["l60"]);

    const outcome90 = runReport(definition, { ...baseParams, window: "within90" as const }, { items, warehouses, layers: [within60Layer, within90Layer] });
    expect(outcome90.ok).toBe(true);
    if (outcome90.ok) expect(outcome90.rows.map((r) => r.key).sort()).toEqual(["l60", "l90"]);

    const noMatch = runReport(
      definition,
      { ...baseParams, window: "within30" as const },
      { items, warehouses, layers: [within60Layer, within90Layer] },
    );
    expect(noMatch.ok).toBe(true);
    if (!noMatch.ok) return;
    expect(noMatch.rows).toHaveLength(0);
  });

  it("searches item name and batch number, and renders zero rows for a search with no match", () => {
    const definition = createInventoryExpiringReport(today);
    const context = { items, warehouses, layers: [layer({ id: "l1", batchNo: "LOT-2026-08" })] };

    const byName = runReport(definition, { ...baseParams, search: "لبن" }, context);
    expect(byName.ok).toBe(true);
    if (byName.ok) expect(byName.rows).toHaveLength(1);

    const byBatch = runReport(definition, { ...baseParams, search: "lot-2026-08" }, context);
    expect(byBatch.ok).toBe(true);
    if (byBatch.ok) expect(byBatch.rows).toHaveLength(1);

    const noMatch = runReport(definition, { ...baseParams, search: "no-such-thing" }, context);
    expect(noMatch.ok).toBe(true);
    if (!noMatch.ok) return;
    expect(noMatch.rows).toHaveLength(0);
  });

  it("filters by warehouseId, and renders zero rows for a warehouse with no stock", () => {
    const definition = createInventoryExpiringReport(today);
    const context = { items, warehouses, layers: [layer({ id: "l1", warehouseId: "wh-1" })] };

    const matching = runReport(definition, { ...baseParams, warehouseId: "wh-1" }, context);
    expect(matching.ok).toBe(true);
    if (matching.ok) expect(matching.rows).toHaveLength(1);

    const noMatch = runReport(definition, { ...baseParams, warehouseId: "wh-does-not-exist" }, context);
    expect(noMatch.ok).toBe(true);
    if (!noMatch.ok) return;
    expect(noMatch.rows).toHaveLength(0);
  });

  it("keeps the totalValue KPI and grand total in agreement across multiple layers", () => {
    const definition = createInventoryExpiringReport(today);
    const layers = [
      layer({ id: "l1", expiryDate: "2026-09-05", remainingQty: Qty.fromMajor("5"), unitCost: Money.fromMajor("20.00") }), // 100.00
      layer({ id: "l2", expiryDate: "2026-08-29", remainingQty: Qty.fromMajor("2"), unitCost: Money.fromMajor("15.50") }), // 31.00, expired
    ];
    const outcome = runReport(definition, baseParams, { items, warehouses, layers });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const totalValueKpi = outcome.kpis.find((k) => k.key === "totalValue");
    const expiredValueKpi = outcome.kpis.find((k) => k.key === "expiredValue");
    expect(totalValueKpi?.value).toBe(131);
    expect(outcome.grandTotals.totalValue).toBe(131);
    expect(expiredValueKpi?.value).toBe(31);
    expect(expiredValueKpi?.tone).toBe("danger");
  });
});
