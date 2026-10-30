import { z } from "zod";
import type { Item } from "../items/item.js";
import type { Warehouse } from "../settings/warehouse.js";
import { signedQty, type StockMovement } from "../inventory/movement.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countDistinct } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * سجل المخزون — Stock Ledger (docs/archive/catalog/08-reports.md): the full
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
  readonly branchId: string;
}

export interface InventoryLedgerRow {
  readonly movementId: string;
  readonly event: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
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
  branchId: branchIdParamSchema,
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
    defaultParams: { dateFrom: "", dateTo: "", itemId: "", warehouseId: "", branchId: "" },
    paramFields: [
      { kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      { kind: ReportParamKind.Text, key: "itemId", label: "الصنف", placeholder: "معرف الصنف" },
      { kind: ReportParamKind.Text, key: "warehouseId", label: "المستودع", placeholder: "معرف المستودع" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.movementId,
    columns: [
      { key: "event", header: "الحدث", format: "text", value: (row) => row.event },
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "warehouseName", header: "المستودع", format: "text", value: (row) => row.warehouseName },
      { key: "movementQty", header: "الحركة", format: "qty", align: "end", value: (row) => row.movementQty },
      { key: "unitCost", cost: true, header: "التكلفة", format: "money", align: "end", value: (row) => row.unitCost },
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
      const itemNamesEn = new Map(ctx.items.map((i) => [i.id, i.nameEn ?? null]));
      const warehouseNames = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const branchOf = branchOfWarehouse(ctx.warehouses);

      const filtered = ctx.movements
        .filter((m) => params.itemId === "" || m.itemId === params.itemId)
        .filter((m) => params.warehouseId === "" || m.warehouseId === params.warehouseId)
        .filter((m) => matchesBranch(branchOf(m.warehouseId), params.branchId))
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
          itemNameEn: itemNamesEn.get(m.itemId) ?? null,
          warehouseName: warehouseNames.get(m.warehouseId) ?? m.warehouseId,
          movementQty: signed,
          unitCost: Number(m.unitCost.toString()),
          balance,
        };
      });
    },
  };
}
