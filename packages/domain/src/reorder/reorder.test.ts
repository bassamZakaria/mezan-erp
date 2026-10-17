import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import { ItemStatusCode } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { Warehouse } from "../settings/warehouse.js";
import {
  InvalidReorderPolicyError,
  ReorderProblem,
  ReorderRuleSource,
  ReorderTrigger,
  buildReorderPolicy,
  buildReorderWorklist,
  daysOfCover,
  evaluateLowStockCrossing,
  groupOrderLines,
  resolveLowStockThreshold,
  roundUpToPack,
  suggestedOrderQty,
  type ItemWarehousePolicy,
} from "./index.js";

const q = (value: string) => Qty.fromMajor(value);

function item(over: Partial<Item> = {}): Item {
  return {
    id: "i1",
    code: "I-1",
    nameAr: "صنف",
    nameEn: null,
    type: "stock",
    baseUnitCode: "pc",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    description: null,
    defaultSupplierId: "s1",
    seasonId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: Money.fromMajor("10"),
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: 10,
    imageAttachmentId: null,
    reorderQty: 40,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: ItemStatusCode.Active,
    ...over,
  };
}

function warehouse(id: string, over: Partial<Warehouse> = {}): Warehouse {
  return { id, code: id, name: id, nameEn: null, branchId: "b1", type: "MAIN", isDefault: id === "w1", active: true, projectId: null, custodianUserId: null, ...over };
}

function snapshot(itemId: string, warehouseId: string, onHand: string): WacSnapshot {
  return { itemId, warehouseId, onHand: q(onHand), totalValue: Money.zero(), averageCost: Money.zero() };
}

function policy(over: Partial<ItemWarehousePolicy> = {}): ItemWarehousePolicy {
  return { itemId: "i1", warehouseId: "w1", minQty: q("20"), maxQty: q("100"), leadDays: 7, packQty: q("12"), supplierId: null, updatedAt: "2026-10-01T00:00:00Z", updatedBy: "u", ...over };
}

const none = { open: Qty.zero(), draft: Qty.zero() };

function run(over: Partial<Parameters<typeof buildReorderWorklist>[0]>) {
  return buildReorderWorklist({
    items: [item()],
    warehouses: [warehouse("w1")],
    policies: [],
    snapshots: [snapshot("i1", "w1", "4")],
    reserved: () => Qty.zero(),
    onOrder: () => none,
    sold: () => Qty.zero(),
    windowDays: 30,
    ...over,
  });
}

describe("pack rounding", () => {
  it("rounds a suggestion up to a whole pack", () => {
    expect(roundUpToPack(q("25"), q("12")).toString()).toBe("36.000000");
    expect(roundUpToPack(q("24"), q("12")).toString()).toBe("24.000000");
    expect(roundUpToPack(q("0"), q("12")).isZero()).toBe(true);
    expect(roundUpToPack(q("3.5"), q("1")).toString()).toBe("3.500000");
  });

  it("suggests max minus the position, never negative", () => {
    expect(suggestedOrderQty(q("100"), q("30"), q("1")).toString()).toBe("70.000000");
    expect(suggestedOrderQty(q("100"), q("130"), q("1")).isZero()).toBe(true);
  });
});

describe("days of cover", () => {
  it("divides available stock by daily sales", () => {
    expect(daysOfCover(q("30"), q("0"), q("60"), 30)).toBe(15);
  });
  it("is zero when nothing is available and null without sales", () => {
    expect(daysOfCover(q("5"), q("5"), q("60"), 30)).toBe(0);
    expect(daysOfCover(q("5"), q("0"), q("0"), 30)).toBeNull();
  });
});

describe("worklist", () => {
  it("falls back to the item's reorder point and quantity", () => {
    const [row] = run({});
    expect(row?.source).toBe(ReorderRuleSource.ItemDefault);
    expect(row?.trigger).toBe(ReorderTrigger.BelowMinimum);
    expect(row?.suggestedQty.toString()).toBe("46.000000");
    expect(row?.supplierId).toBe("s1");
  });

  it("prefers the warehouse policy and rounds to its pack", () => {
    const [row] = run({ policies: [policy()] });
    expect(row?.source).toBe(ReorderRuleSource.Policy);
    expect(row?.suggestedQty.toString()).toBe("96.000000");
  });

  it("counts open and draft orders and reservations in the position", () => {
    const rows = run({ policies: [policy({ packQty: q("1") })], onOrder: () => ({ open: q("10"), draft: q("5") }), reserved: () => q("3") });
    expect(rows[0]?.position.toString()).toBe("16.000000");
    expect(rows[0]?.suggestedQty.toString()).toBe("84.000000");
  });

  it("leaves out an item that is covered", () => {
    expect(run({ snapshots: [snapshot("i1", "w1", "50")] })).toHaveLength(0);
  });

  it("flags a missing order quantity and a missing supplier", () => {
    const [row] = run({ items: [item({ reorderQty: null, defaultSupplierId: null })] });
    expect(row?.problems).toEqual([ReorderProblem.NoOrderQty, ReorderProblem.NoSupplier]);
    expect(row?.suggestedQty.isZero()).toBe(true);
  });

  it("triggers on cover shorter than the lead time even above the minimum", () => {
    const rows = run({
      policies: [policy({ minQty: q("5"), maxQty: q("200"), packQty: q("1"), leadDays: 10 })],
      snapshots: [snapshot("i1", "w1", "30")],
      sold: () => q("100"),
    });
    expect(rows[0]?.trigger).toBe(ReorderTrigger.CoverBelowLeadTime);
    expect(rows[0]?.daysOfCover).toBe(9);
  });

  it("ranks the least cover first and puts stock-outs ahead of unsold stock", () => {
    const rows = run({
      items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })],
      snapshots: [snapshot("a", "w1", "8"), snapshot("b", "w1", "2"), snapshot("c", "w1", "0")],
      sold: (id) => (id === "a" ? q("30") : id === "b" ? q("300") : Qty.zero()),
    });
    expect(rows.map((r) => r.itemId)).toEqual(["c", "b", "a"]);
  });

  it("applies the item default only to main warehouses that hold the item", () => {
    const rows = run({
      warehouses: [warehouse("w1"), warehouse("w2"), warehouse("van", { type: "VAN" })],
      snapshots: [snapshot("i1", "w1", "4"), snapshot("i1", "van", "1")],
    });
    expect(rows.map((r) => r.warehouseId)).toEqual(["w1"]);
  });

  it("skips services, inactive items and inactive warehouses", () => {
    expect(run({ items: [item({ type: "service" })] })).toHaveLength(0);
    expect(run({ items: [item({ status: ItemStatusCode.Inactive })] })).toHaveLength(0);
    expect(run({ policies: [policy()], items: [item({ reorderPoint: null })], warehouses: [warehouse("w1", { active: false })] })).toHaveLength(0);
  });
});

describe("policy validation", () => {
  const base = { itemId: "i1", warehouseId: "w1", minQty: q("5"), maxQty: q("20"), leadDays: 3, packQty: null, supplierId: null, updatedAt: "t", updatedBy: "u" };
  it("defaults the pack to one unit", () => {
    expect(buildReorderPolicy(base).packQty.toString()).toBe("1.000000");
  });
  it("refuses a maximum below the minimum and a bad lead time", () => {
    expect(() => buildReorderPolicy({ ...base, maxQty: q("2") })).toThrow(InvalidReorderPolicyError);
    expect(() => buildReorderPolicy({ ...base, leadDays: 400 })).toThrow(InvalidReorderPolicyError);
    expect(() => buildReorderPolicy({ ...base, packQty: q("0") })).toThrow(InvalidReorderPolicyError);
  });
});

describe("low stock crossing", () => {
  const threshold = q("10");
  it("fires once when stock falls to the point and stays quiet while it stays low", () => {
    const first = evaluateLowStockCrossing({ armed: true, onHandAfter: q("10"), threshold });
    expect(first).toEqual({ fire: true, armed: false });
    expect(evaluateLowStockCrossing({ armed: first.armed, onHandAfter: q("6"), threshold })).toEqual({ fire: false, armed: false });
  });
  it("re-arms when stock goes back above the point", () => {
    expect(evaluateLowStockCrossing({ armed: false, onHandAfter: q("11"), threshold })).toEqual({ fire: false, armed: true });
  });
  it("never fires without a usable threshold", () => {
    expect(evaluateLowStockCrossing({ armed: true, onHandAfter: q("0"), threshold: null }).fire).toBe(false);
    expect(evaluateLowStockCrossing({ armed: true, onHandAfter: q("0"), threshold: q("0") }).fire).toBe(false);
  });
  it("uses the warehouse policy minimum before the item's reorder point", () => {
    expect(resolveLowStockThreshold(policy(), item())?.toString()).toBe("20.000000");
    expect(resolveLowStockThreshold(null, item())?.toString()).toBe("10.000000");
    expect(resolveLowStockThreshold(null, item({ reorderPoint: null }))).toBeNull();
  });
});

describe("order grouping", () => {
  it("groups by supplier and warehouse and sets supplier-less lines aside", () => {
    const line = (itemId: string, warehouseId: string, supplierId: string | null) => ({ itemId, warehouseId, supplierId, qty: q("1") });
    const split = groupOrderLines([line("a", "w1", "s1"), line("b", "w1", "s1"), line("c", "w2", "s1"), line("d", "w1", "s2"), line("e", "w1", null)]);
    expect(split.groups.map((g) => [g.supplierId, g.warehouseId, g.lines.length])).toEqual([
      ["s1", "w1", 2],
      ["s1", "w2", 1],
      ["s2", "w1", 1],
    ]);
    expect(split.needsSupplier.map((l) => l.itemId)).toEqual(["e"]);
  });
});
