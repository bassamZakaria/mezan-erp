import { z } from "zod";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { StockMovement } from "../inventory/movement.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";

/**
 * حركة المخزون — Stock Movement (docs/catalog/08-reports.md): every stock-
 * affecting transaction (in/out) in a period, one row per `StockMovement` —
 * the ledger IS the report; nothing here is derived beyond formatting.
 */

export interface InventoryMovementContext {
  readonly movements: readonly StockMovement[];
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
}

export interface InventoryMovementParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly direction: "" | "IN" | "OUT";
  readonly itemId: string;
  readonly warehouseId: string;
}

export interface InventoryMovementRow {
  readonly movementId: string;
  readonly date: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly warehouseName: string;
  readonly direction: "وارد" | "صادر";
  readonly qty: number;
  readonly sourceDocTypeLabel: string;
  readonly sourceDocNumber: string;
}

const paramsSchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  direction: z.enum(["", "IN", "OUT"]),
  itemId: z.string(),
  warehouseId: z.string(),
});

export function createInventoryMovementReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<InventoryMovementParams, InventoryMovementRow, InventoryMovementContext> {
  return {
    id: "inventory.movement",
    titleAr: "حركة المخزون",
    descriptionAr: "ما الذي حرك المخزون دخولاً وخروجاً في هذه الفترة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, direction: "", itemId: "", warehouseId: "" },
    paramFields: [
      { kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      {
        kind: "select",
        key: "direction",
        label: "الاتجاه",
        options: [
          { value: "", label: "الكل" },
          { value: "IN", label: "وارد" },
          { value: "OUT", label: "صادر" },
        ],
      },
      { kind: "text", key: "itemId", label: "الصنف", placeholder: "معرف الصنف" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
    ],
    rowKey: (row) => row.movementId,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "direction", header: "الاتجاه", format: "text", value: (row) => row.direction },
      { key: "qty", header: "الكمية", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "sourceDocTypeLabel", header: "نوع المرجع", format: "text", value: (row) => row.sourceDocTypeLabel },
      { key: "sourceDocNumber", header: "المرجع", format: "text", value: (row) => row.sourceDocNumber },
    ],
    kpis: [
      { key: "inQty", labelAr: "الكمية الواردة", format: "qty", value: (rows) => sumRows(rows, (r) => (r.direction === "وارد" ? r.qty : 0)) },
      { key: "outQty", labelAr: "الكمية الصادرة", format: "qty", value: (rows) => sumRows(rows, (r) => (r.direction === "صادر" ? r.qty : 0)) },
      { key: "netQty", labelAr: "صافي الحركة", format: "qty", value: (rows) => sumRows(rows, (r) => (r.direction === "وارد" ? r.qty : -r.qty)), tone: (value) => (value < 0 ? "danger" : "default") },
      { key: "movementCount", labelAr: "عدد الحركات", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      labelColumn: "direction",
      valueColumn: "qty",
      aggregate: true,
      maxPoints: 2,
      captionAr: "إجمالي الكمية الواردة مقابل الصادرة في الفترة.",
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const itemNamesEn = new Map(ctx.items.map((i) => [i.id, i.nameEn ?? null]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      return ctx.movements
        .filter((m) => withinDateRange(m.occurredAt.slice(0, 10), params.dateFrom, params.dateTo))
        .filter((m) => params.direction === "" || m.direction === params.direction)
        .filter((m) => params.itemId === "" || m.itemId === params.itemId)
        .filter((m) => params.warehouseId === "" || m.warehouseId === params.warehouseId)
        .map((m) => ({
          movementId: m.id,
          date: m.occurredAt.slice(0, 10),
          itemNameAr: itemNames.get(m.itemId) ?? m.itemId,
          itemNameEn: itemNamesEn.get(m.itemId) ?? null,
          warehouseName: warehouseNames.get(m.warehouseId) ?? m.warehouseId,
          direction: m.direction === "IN" ? ("وارد" as const) : ("صادر" as const),
          qty: Number(m.qty.toString()),
          sourceDocTypeLabel: STOCK_SOURCE_DOC_TYPE_LABELS_AR[m.sourceDocType],
          sourceDocNumber: m.sourceDocNumber ?? m.sourceDocId,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    },
  };
}
