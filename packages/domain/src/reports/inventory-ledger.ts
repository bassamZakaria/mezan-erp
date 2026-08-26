import { z } from "zod";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import { signedQty, type StockMovement } from "../inventory/movement.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countDistinct } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";

/**
 * سجل المخزون — Stock Ledger (docs/catalog/08-reports.md): the full
 * chronological event-by-event ledger with a running balance per item/
 * warehouse position — the inventory analogue of a GL account ledger.
 * Blank دون تاريخ (no date bounds) is the catalog's own default — "full
 * history".
 */

export interface InventoryLedgerContext {
  readonly movements: readonly StockMovement[];
  readonly items: readonly Item[];
  readonly warehouses: readonly Warehouse[];
}

export interface InventoryLedgerParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly itemId: string;
  readonly warehouseId: string;
}

export interface InventoryLedgerRow {
  readonly movementId: string;
  readonly event: string;
  readonly itemNameAr: string;
  readonly warehouseName: string;
  readonly movementQty: number;
  readonly unitCost: number;
  readonly balance: number;
}

const paramsSchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  itemId: z.string(),
  warehouseId: z.string(),
});

export function createInventoryLedgerReport(): ReportDefinition<
  InventoryLedgerParams,
  InventoryLedgerRow,
  InventoryLedgerContext
> {
  return {
    id: "inventory.ledger",
    titleAr: "سجل المخزون",
    descriptionAr: "السجل الزمني الكامل لحركات المخزون مع الرصيد الجاري لكل صنف/مستودع. جميع التكاليف بالعملة الأساسية للشركة.",
    paramsSchema,
    defaultParams: { dateFrom: "", dateTo: "", itemId: "", warehouseId: "" },
    paramFields: [
      { kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      { kind: "text", key: "itemId", label: "الصنف", placeholder: "معرف الصنف" },
      { kind: "text", key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
    ],
    rowKey: (row) => row.movementId,
    columns: [
      { key: "event", header: "الحدث", format: "text", value: (row) => row.event },
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "movementQty", header: "الحركة", format: "qty", align: "end", value: (row) => row.movementQty },
      { key: "unitCost", header: "التكلفة", format: "money", align: "end", value: (row) => row.unitCost },
      { key: "balance", header: "الرصيد", format: "qty", align: "end", value: (row) => row.balance },
    ],
    kpis: [
      { key: "movementCount", labelAr: "عدد الحركات", format: "qty", value: (rows) => rows.length },
      { key: "inQty", labelAr: "الوارد", format: "qty", value: (rows) => sumRows(rows, (r) => (r.movementQty > 0 ? r.movementQty : 0)) },
      { key: "outQty", labelAr: "الصادر", format: "qty", value: (rows) => sumRows(rows, (r) => (r.movementQty < 0 ? -r.movementQty : 0)) },
      { key: "positionCount", labelAr: "عدد المواضع", format: "qty", value: (rows) => countDistinct(rows, (r) => `${r.itemNameAr}·${r.warehouseName}`) },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "movementQty",
      aggregate: true,
      maxPoints: 8,
      captionAr: "صافي الحركة لكل صنف في السجل المعروض — الموجب دخول، والسالب خروج.",
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));

      const filtered = ctx.movements
        .filter((m) => params.itemId === "" || m.itemId === params.itemId)
        .filter((m) => params.warehouseId === "" || m.warehouseId === params.warehouseId)
        .filter((m) => withinDateRange(m.occurredAt.slice(0, 10), params.dateFrom || undefined, params.dateTo || undefined))
        .slice()
        .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id.localeCompare(b.id)));

      const runningBalance = new Map<string, number>();
      return filtered.map((m) => {
        const positionKey = `${m.itemId}|${m.warehouseId}`;
        const signed = Number(signedQty(m).toString());
        const balance = (runningBalance.get(positionKey) ?? 0) + signed;
        runningBalance.set(positionKey, balance);
        return {
          movementId: m.id,
          event: `${m.occurredAt.slice(0, 10)} — ${STOCK_SOURCE_DOC_TYPE_LABELS_AR[m.sourceDocType]} ${m.sourceDocNumber ?? m.sourceDocId}`,
          itemNameAr: itemNames.get(m.itemId) ?? m.itemId,
          warehouseName: warehouseNames.get(m.warehouseId) ?? m.warehouseId,
          movementQty: signed,
          unitCost: Number(m.unitCost.toString()),
          balance,
        };
      });
    },
  };
}
