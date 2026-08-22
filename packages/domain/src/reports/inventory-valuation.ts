import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { ReportDefinition } from "./types.js";

/**
 * تقييم المخزون — Inventory Valuation (docs/catalog/08-reports.md): current
 * stock valuation per item (qty × average cost), aggregated across every
 * warehouse the item has a WAC position in.
 */

export interface InventoryValuationContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
}

export interface InventoryValuationParams {
  readonly search: string;
  readonly warehouseId: string;
}

export interface InventoryValuationRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly onHand: number;
  readonly unitCost: number;
  readonly totalValue: number;
}

const paramsSchema = z.object({
  search: z.string(),
  warehouseId: z.string(),
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
    defaultParams: { search: "", warehouseId: "" },
    paramFields: [
      { kind: "text", key: "search", label: "بحث", placeholder: "بحث بالاسم أو الكود" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "onHand", header: "المخزون الحالي", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "unitCost", header: "متوسط التكلفة", format: "money", align: "end", value: (row) => row.unitCost },
      { key: "totalValue", header: "القيمة الإجمالية", format: "money", align: "end", total: true, value: (row) => row.totalValue },
    ],
    run: (params, ctx) => {
      const search = params.search.trim().toLowerCase();
      const rows: InventoryValuationRow[] = [];
      for (const item of ctx.items) {
        if (item.type !== "stock") continue;
        if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;
        const positions = ctx.snapshots.filter(
          (s) => s.itemId === item.id && (params.warehouseId === "" || s.warehouseId === params.warehouseId),
        );
        if (positions.length === 0) continue;
        const onHand = Qty.sum(positions.map((p) => p.onHand));
        const value = Money.sum(positions.map((p) => p.totalValue));
        const onHandNumber = Number(onHand.toString());
        if (onHandNumber === 0 && value.scaled === 0n) continue;
        rows.push({
          itemId: item.id,
          itemNameAr: item.nameAr,
          onHand: onHandNumber,
          unitCost: onHandNumber !== 0 ? Number(value.toString()) / onHandNumber : 0,
          totalValue: Number(value.toString()),
        });
      }
      return rows.sort((a, b) => b.totalValue - a.totalValue);
    },
  };
}
