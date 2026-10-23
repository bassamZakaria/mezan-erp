import { describe, it, expect } from "vitest";
import { StockLevelStatusDTO } from "@mezan/contracts";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventoryStockLevelsReport, summarizeStockLevels, STOCK_LEVELS_ATTENTION_LIMIT } from "./inventory-stock-levels.js";
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
    expect(outcome.rows[0]?.status).toBe(StockLevelStatusDTO.Low);
  });

  it("flags a zero-stock item as out regardless of reorder point", () => {
    const definition = createInventoryStockLevelsReport();
    const outcome = runReport(definition, { warehouseId: "", search: "" }, { items: [item()], snapshots: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.status).toBe(StockLevelStatusDTO.Out);
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
    expect(outcome.rows[0]?.status).toBe(StockLevelStatusDTO.Normal);
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

describe("summarizeStockLevels", () => {
  function seededContext(count: number) {
    const items: Item[] = [];
    const snapshots: WacSnapshot[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `item-${i}`;
      items.push(item({ id, code: `SKU-${i}`, nameAr: `صنف ${String(i).padStart(5, "0")}`, nameEn: `Item ${i}`, reorderPoint: i % 3 === 0 ? 50 : null }));
      if (i % 7 === 0) continue;
      snapshots.push(snapshot({ itemId: id, warehouseId: "wh-1", onHand: Qty.fromMajor(String((i % 90) + 1)), totalValue: Money.fromMajor(`${i}.333333`) }));
      if (i % 2 === 0) snapshots.push(snapshot({ itemId: id, warehouseId: "wh-2", onHand: Qty.fromMajor("0.5"), totalValue: Money.fromMajor("0.10") }));
    }
    return { items, snapshots };
  }

  it("agrees with the full report on every figure the overview and the dashboard show", () => {
    const ctx = seededContext(400);
    const params = { warehouseId: "", search: "", branchId: "" };
    const report = runReport(createInventoryStockLevelsReport(), params, ctx);
    if (!report.ok) throw new Error("report refused");
    const summary = summarizeStockLevels(params, ctx);

    const notNormal = report.rows.filter((r) => r.status !== StockLevelStatusDTO.Normal);
    const low = report.rows.filter((r) => r.status === StockLevelStatusDTO.Low);
    expect(summary.needsAttentionCount).toBe(report.kpis.find((k) => k.key === "needsAttention")?.value);
    expect(summary.needsAttentionCount).toBe(notNormal.length);
    expect(summary.lowCount).toBe(low.length);
    expect(summary.attention.map((r) => [r.itemId, r.itemNameAr, r.sku, Number(r.onHand), r.status])).toEqual(
      notNormal.slice(0, STOCK_LEVELS_ATTENTION_LIMIT).map((r) => [r.itemId, r.itemNameAr, r.sku, r.onHand, r.status]),
    );
    expect(summary.firstLow?.itemId).toBe(low[0]?.itemId);
    expect(summary.firstLow?.itemNameEn).toBe(low[0]?.itemNameEn);
    expect(summary.totalValue).toBe(Money.sum(ctx.snapshots.map((s) => s.totalValue)).toString());
    expect(Number(summary.totalValue)).toBeCloseTo(Number(report.grandTotals.value), 6);
    expect(summary.lowCount).toBeGreaterThan(0);
    expect(summary.needsAttentionCount).toBeGreaterThan(summary.lowCount);
  });

  it("narrows by warehouse exactly as the report does", () => {
    const ctx = seededContext(60);
    const params = { warehouseId: "wh-2", search: "", branchId: "" };
    const report = runReport(createInventoryStockLevelsReport(), params, ctx);
    if (!report.ok) throw new Error("report refused");
    const summary = summarizeStockLevels(params, ctx);
    expect(summary.needsAttentionCount).toBe(report.rows.filter((r) => r.status !== StockLevelStatusDTO.Normal).length);
    expect(Number(summary.totalValue)).toBeCloseTo(Number(report.grandTotals.value), 6);
  });

  it("is a fraction of the full report's payload at 3,000 items", () => {
    const ctx = seededContext(3000);
    const params = { warehouseId: "", search: "", branchId: "" };
    const report = runReport(createInventoryStockLevelsReport(), params, ctx);
    const full = JSON.stringify(report).length;
    const small = JSON.stringify(summarizeStockLevels(params, ctx)).length;
    expect(small).toBeLessThan(2_000);
    expect(small * 200).toBeLessThan(full);
  });
});
