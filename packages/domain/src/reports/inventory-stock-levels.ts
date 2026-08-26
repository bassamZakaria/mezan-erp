import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows } from "./kpi.js";
import { itemTypeTracksStock } from "../items/item-type.js";

/**
 * مستويات المخزون — Stock Levels (docs/catalog/08-reports.md): point-in-time
 * stock status per item (aggregated across warehouses, or one warehouse when
 * filtered), flagging items at/under their reorder point. Sourced from the
 * cached WAC snapshots (`WacSnapshotRepository`) — the same fast-read cache
 * the costing engine itself serves from.
 */

export type StockLevelStatus = "out" | "low" | "normal";

export interface InventoryStockLevelsContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
}

export interface InventoryStockLevelsParams {
  readonly warehouseId: string;
  readonly search: string;
}

export interface InventoryStockLevelsRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly sku: string;
  readonly warehouseCount: number;
  readonly onHand: number;
  readonly averageCost: number;
  readonly value: number;
  readonly status: StockLevelStatus;
}

const STATUS_LABEL: Record<StockLevelStatus, string> = { out: "نافد", low: "منخفض", normal: "طبيعي" };

const paramsSchema = z.object({
  warehouseId: z.string(),
  search: z.string(),
});

function computeStatus(onHand: number, reorderPoint: number | null): StockLevelStatus {
  if (onHand <= 0) return "out";
  if (reorderPoint !== null && onHand <= reorderPoint) return "low";
  return "normal";
}

export function createInventoryStockLevelsReport(): ReportDefinition<
  InventoryStockLevelsParams,
  InventoryStockLevelsRow,
  InventoryStockLevelsContext
> {
  return {
    id: "inventory.stock-levels",
    titleAr: "مستويات المخزون",
    descriptionAr: "الأصناف التي تحتاج تدخلاً الآن — الأصناف الأقل من حد إعادة الطلب.",
    paramsSchema,
    defaultParams: { warehouseId: "", search: "" },
    paramFields: [
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع (اتركه فارغاً لكل المستودعات)" },
      { kind: "text", key: "search", label: "الصنف", placeholder: "ابحث بالاسم أو الكود" },
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "sku", header: "الكود", format: "text", value: (row) => row.sku },
      { key: "warehouseCount", header: "عدد المستودعات", format: "qty", align: "end", value: (row) => row.warehouseCount },
      { key: "onHand", header: "إجمالي المخزون", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "averageCost", header: "متوسط التكلفة", format: "money", align: "end", value: (row) => row.averageCost },
      { key: "value", header: "قيمة المخزون", format: "money", align: "end", total: true, value: (row) => row.value },
      { key: "status", header: "الحالة", format: "text", value: (row) => STATUS_LABEL[row.status] },
    ],
    kpis: [
      { key: "value", labelAr: "إجمالي قيمة المخزون", format: "money", value: (rows) => sumRows(rows, (r) => r.value) },
      { key: "onHand", labelAr: "إجمالي الكميات", format: "qty", value: (rows) => sumRows(rows, (r) => r.onHand) },
      { key: "itemCount", labelAr: "عدد الأصناف", format: "qty", value: (rows) => rows.length },
      { key: "needsAttention", labelAr: "أصناف تحت حد الطلب", format: "qty", value: (rows) => countRows(rows, (r) => r.status !== "normal"), tone: (value) => (value > 0 ? "danger" : "success") },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "value",
      maxPoints: 8,
      captionAr: "الأصناف الأعلى قيمة مخزونية — أين يقف رأس المال.",
    },
    run: (params, ctx) => {
      const search = params.search.trim().toLowerCase();
      const rows: InventoryStockLevelsRow[] = [];
      for (const item of ctx.items) {
        if (!itemTypeTracksStock(item.type)) continue;
        if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;
        const positions = ctx.snapshots.filter(
          (s) => s.itemId === item.id && (params.warehouseId === "" || s.warehouseId === params.warehouseId),
        );
        const onHand = Qty.sum(positions.map((p) => p.onHand));
        const value = Money.sum(positions.map((p) => p.totalValue));
        const onHandNumber = Number(onHand.toString());
        rows.push({
          itemId: item.id,
          itemNameAr: item.nameAr,
          sku: item.code,
          warehouseCount: positions.length,
          onHand: onHandNumber,
          averageCost: onHandNumber !== 0 ? Number(value.toString()) / onHandNumber : 0,
          value: Number(value.toString()),
          status: computeStatus(onHandNumber, item.reorderPoint),
        });
      }
      return rows.sort((a, b) => a.itemNameAr.localeCompare(b.itemNameAr));
    },
  };
}
