import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, averageOf } from "./kpi.js";
import { itemTypeTracksStock } from "../items/item-type.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";

/**
 * تقييم المخزون — Inventory Valuation (docs/archive/catalog/08-reports.md): current
 * stock valuation per item (qty × average cost), aggregated across every
 * warehouse the item has a WAC position in.
 */

export interface InventoryValuationContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
  /**
   * Balance of the inventory CONTROL account in the GL (D112).
   *
   * This is the single test that proves the costing engine: the valuation this
   * report sums from the stock sub-ledger must equal what every receipt,
   * issue, adjustment and landed cost actually posted to inventory. Optional —
   * omit it and the report runs without claiming to tie.
   */
  readonly inventoryControlBalance?: () => number;
  /**
   * The warehouse register, for resolving each position's branch (D111). A WAC
   * snapshot carries a warehouse and never a branch, so without this the
   * `branchId` parameter has nothing to match on. Optional: omit it and the
   * report runs unfiltered by branch — every route that mounts this report
   * wires it.
   */
  readonly warehouses?: readonly Warehouse[];
}

export interface InventoryValuationParams {
  readonly search: string;
  readonly warehouseId: string;
  readonly branchId: string;
}

export interface InventoryValuationRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly onHand: number;
  readonly unitCost: number;
  readonly totalValue: number;
}

const paramsSchema = z.object({
  search: z.string(),
  warehouseId: z.string(),
  branchId: branchIdParamSchema,
});

export function createInventoryValuationReport(): ReportDefinition<
  InventoryValuationParams,
  InventoryValuationRow,
  InventoryValuationContext
> {
  return {
    id: "inventory.valuation",
    titleAr: "تقييم المخزون",
    descriptionAr: "قيمة المخزون الحالية لكل صنف (الكمية × متوسط التكلفة).",
    paramsSchema,
    defaultParams: { search: "", warehouseId: "", branchId: "" },
    paramFields: [
      { kind: "text", key: "search", label: "بحث", placeholder: "بحث بالاسم أو الكود" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "onHand", header: "المخزون الحالي", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "unitCost", header: "متوسط التكلفة", format: "money", align: "end", value: (row) => row.unitCost },
      { key: "totalValue", header: "القيمة الإجمالية", format: "money", align: "end", total: true, value: (row) => row.totalValue },
    ],
    reconciliation: {
      labelAr: "قيمة المخزون مقابل حساب المخزون في دفتر الأستاذ",
      computeReportTotal: (rows) => sumRows(rows, (row) => row.totalValue),
      computeReferenceTotal: (_rows, ctx) => ctx.inventoryControlBalance?.() ?? 0,
      available: (ctx) => ctx.inventoryControlBalance !== undefined,
      toleranceMoney: 0.01,
    },
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "totalValue",
      maxPoints: 8,
      captionAr: "الأصناف مرتبة حسب قيمة المخزون — أين يتركز رأس المال.",
    },
    kpis: [
      { key: "totalValue", labelAr: "إجمالي قيمة المخزون", format: "money", value: (rows) => sumRows(rows, (r) => r.totalValue) },
      { key: "onHand", labelAr: "إجمالي الكمية", format: "qty", value: (rows) => sumRows(rows, (r) => r.onHand) },
      { key: "itemCount", labelAr: "عدد الأصناف", format: "qty", value: (rows) => rows.length },
      { key: "avgUnitCost", labelAr: "متوسط تكلفة الوحدة", hintAr: "القيمة ÷ الكمية", format: "money", value: (rows) => averageOf(sumRows(rows, (r) => r.totalValue), sumRows(rows, (r) => r.onHand)) },
    ],
    run: (params, ctx) => {
      const search = params.search.trim().toLowerCase();
      const branchOf = branchOfWarehouse(ctx.warehouses);
      const rows: InventoryValuationRow[] = [];
      for (const item of ctx.items) {
        if (!itemTypeTracksStock(item.type)) continue;
        if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;
        const positions = ctx.snapshots.filter(
          (s) =>
            s.itemId === item.id &&
            (params.warehouseId === "" || s.warehouseId === params.warehouseId) &&
            matchesBranch(branchOf(s.warehouseId), params.branchId),
        );
        if (positions.length === 0) continue;
        const onHand = Qty.sum(positions.map((p) => p.onHand));
        const value = Money.sum(positions.map((p) => p.totalValue));
        const onHandNumber = Number(onHand.toString());
        if (onHandNumber === 0 && value.scaled === 0n) continue;
        rows.push({
          itemId: item.id,
          itemNameAr: item.nameAr,
          itemNameEn: item.nameEn ?? null,
          onHand: onHandNumber,
          unitCost: onHandNumber !== 0 ? Number(value.toString()) / onHandNumber : 0,
          totalValue: Number(value.toString()),
        });
      }
      return rows.sort((a, b) => b.totalValue - a.totalValue);
    },
  };
}

/**
 * دفتر المخزون (الخامات والبضاعة) — the stock register required by قرار وزير
 * المالية 420 لسنة 2025، المادة 3: quantity and value per item, which is what
 * تقييم المخزون already is.
 */
export const createDecree420StockRegister = createInventoryValuationReport;
