import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { Warehouse } from "../settings/warehouse.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * بضاعة قيد التحويل — Goods in Transit (DEC-19). Stock standing in a
 * `TRANSIT`-type warehouse: it has left the sending store and has not been
 * received at the destination.
 *
 * A stock transfer posts both legs on one confirm and is valuation-neutral by
 * construction, so there is no `in_transit` document state to report on and
 * there deliberately is not going to be one. The in-transit leg is modelled
 * instead as a real transfer into a TRANSIT warehouse, and a short arrival is a
 * SHORTAGE adjustment on it — a loss with a cause, an approver and a GL entry,
 * rather than a silent delta inside a document that posts nothing. This report
 * is what makes that leg visible: stock sitting here for a long time is either
 * still on the lorry or already gone.
 */

export interface GoodsInTransitContext {
  readonly items: readonly Item[];
  readonly snapshots: readonly WacSnapshot[];
  /**
   * The warehouse register. Unlike every other stock report this one is not
   * optional: a WAC snapshot carries a warehouse id and no type, so without the
   * register there is no way to tell a TRANSIT position from any other and the
   * report would show the whole tenant's stock as in transit.
   */
  readonly warehouses: readonly Warehouse[];
}

export interface GoodsInTransitParams {
  readonly warehouseId: string;
  readonly search: string;
  readonly branchId: string;
}

export interface GoodsInTransitRow {
  readonly key: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly sku: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly onHand: number;
  readonly value: number;
}

const paramsSchema = z.object({
  warehouseId: z.string(),
  search: z.string(),
  branchId: branchIdParamSchema,
});

export function createGoodsInTransitReport(): ReportDefinition<GoodsInTransitParams, GoodsInTransitRow, GoodsInTransitContext> {
  return {
    id: "inventory.goods-in-transit",
    titleAr: "بضاعة قيد التحويل",
    descriptionAr: "البضاعة التي غادرت المستودع المُرسِل ولم تُستلم بعد — أي ما يقف الآن في مستودع وسيط.",
    paramsSchema,
    defaultParams: { warehouseId: "", search: "", branchId: "" },
    paramFields: [
      { kind: ReportParamKind.Text, key: "warehouseId", label: "المستودع الوسيط", placeholder: "معرف المستودع (اتركه فارغاً لكل المستودعات الوسيطة)" },
      { kind: ReportParamKind.Text, key: "search", label: "الصنف", placeholder: "ابحث بالاسم أو الكود" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.key,
    costlessOrder: (a, b) => a.itemNameAr.localeCompare(b.itemNameAr) || a.key.localeCompare(b.key),
    columns: [
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "sku", header: "الكود", format: "text", value: (row) => row.sku },
      { key: "warehouseName", header: "المستودع الوسيط", format: "text", value: (row) => row.warehouseName },
      { key: "onHand", header: "الكمية", format: "qty", align: "end", total: true, value: (row) => row.onHand },
      { key: "value", cost: true, header: "القيمة", format: "money", align: "end", total: true, value: (row) => row.value },
    ],
    kpis: [
      { key: "value", cost: true, labelAr: "قيمة البضاعة قيد التحويل", format: "money", value: (rows) => sumRows(rows, (r) => r.value), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "onHand", labelAr: "إجمالي الكميات", format: "qty", value: (rows) => sumRows(rows, (r) => r.onHand) },
      { key: "lineCount", labelAr: "عدد المراكز", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "value",
      maxPoints: 8,
      captionAr: "الأصناف الأعلى قيمة بين المستودعات — ما الذي يقف على الطريق.",
    },
    run: (params, ctx) => {
      const transitIds = new Set(ctx.warehouses.filter((w) => w.type === "TRANSIT").map((w) => w.id));
      if (transitIds.size === 0) return [];

      const nameOf = new Map(ctx.warehouses.map((w) => [w.id, w.name]));
      const itemOf = new Map(ctx.items.map((i) => [i.id, i]));
      const branchOf = branchOfWarehouse(ctx.warehouses);
      const search = params.search.trim().toLowerCase();

      const rows: GoodsInTransitRow[] = [];
      for (const snapshot of ctx.snapshots) {
        if (!transitIds.has(snapshot.warehouseId)) continue;
        if (params.warehouseId !== "" && snapshot.warehouseId !== params.warehouseId) continue;
        if (!matchesBranch(branchOf(snapshot.warehouseId), params.branchId)) continue;

        const item = itemOf.get(snapshot.itemId);
        if (!item) continue;
        if (search && !item.nameAr.toLowerCase().includes(search) && !item.code.toLowerCase().includes(search)) continue;

        const onHand = Number(Qty.sum([snapshot.onHand]).toString());
        // A transit position that has netted to zero has arrived. Reporting it
        // would bury the ones that have not among rows that need no action.
        if (onHand === 0) continue;

        rows.push({
          key: `${snapshot.warehouseId}:${snapshot.itemId}`,
          itemId: item.id,
          itemNameAr: item.nameAr,
          itemNameEn: item.nameEn ?? null,
          sku: item.code,
          warehouseId: snapshot.warehouseId,
          warehouseName: nameOf.get(snapshot.warehouseId) ?? snapshot.warehouseId,
          onHand,
          value: Number(Money.sum([snapshot.totalValue]).toString()),
        });
      }
      return rows.sort((a, b) => b.value - a.value || a.itemNameAr.localeCompare(b.itemNameAr));
    },
  };
}
