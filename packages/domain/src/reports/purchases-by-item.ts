import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money, Qty } from "../money/index.js";
import { purchaseInvoiceLineBase, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import { convertToBase } from "../exchange-rates/convert.js";
import type { Item } from "../items/item.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, averageOf } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * المشتريات حسب الصنف — Purchases by Item (docs/archive/catalog/08-reports.md):
 * highest-cost purchased items in a period. Only مخزني (inventory) lines
 * count — مصروف شحن (freight/expense) lines never carry an `itemId`.
 */

export interface PurchasesByItemContext {
  readonly invoices: readonly PurchaseInvoice[];
  readonly items: readonly Item[];
  /**
   * What the same period posted to inventory in the GL (A7). Optional: absent,
   * the report runs without claiming to tie to the ledger, which is more
   * honest than comparing a figure to itself.
   */
  readonly postedInventory?: (params: { dateFrom: string; dateTo: string }) => number;
}

export interface PurchasesByItemParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
}

export interface PurchasesByItemRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly qty: number;
  readonly cost: number;
  readonly costPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
});

export function createPurchasesByItemReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<PurchasesByItemParams, PurchasesByItemRow, PurchasesByItemContext> {
  return {
    id: "purchases.by-item",
    titleAr: "المشتريات حسب الصنف",
    descriptionAr: "ما هي الأصناف الأكثر تكلفة في الشراء خلال الفترة المحددة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "qty", header: "الكمية المشتراة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "cost", header: "التكلفة", format: "money", align: "end", total: true, value: (row) => row.cost },
      { key: "costPercent", header: "نسبة التكلفة", format: "share", align: "end", value: (row) => row.costPercent },
    ],
    /**
     * The report sums invoice lines; the GL holds what those invoices posted
     * to inventory. Two independent paths to one number — a difference means
     * one of them is wrong.
     */
    reconciliation: {
      labelAr: "تكلفة التقرير مقابل المرحَّل للمخزون في دفتر الأستاذ",
      computeReportTotal: (rows) => sumRows(rows, (row) => row.cost),
      computeReferenceTotal: (_rows, ctx, params) => ctx.postedInventory?.(params) ?? 0,
      available: (ctx) => ctx.postedInventory !== undefined,
      toleranceMoney: 0.01,
    },
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "cost",
      maxPoints: 8,
      captionAr: "الأصناف مرتبة حسب ما أُنفق عليها.",
    },
    kpis: [
      { key: "cost", labelAr: "إجمالي التكلفة", format: "money", value: (rows) => sumRows(rows, (r) => r.cost) },
      { key: "qty", labelAr: "الكمية المشتراة", format: "qty", value: (rows) => sumRows(rows, (r) => r.qty) },
      { key: "itemCount", labelAr: "عدد الأصناف", format: "qty", value: (rows) => rows.length },
      { key: "avgUnitCost", labelAr: "متوسط تكلفة الوحدة", hintAr: "التكلفة ÷ الكمية", format: "money", value: (rows) => averageOf(sumRows(rows, (r) => r.cost), sumRows(rows, (r) => r.qty)) },
    ],
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const itemNamesEn = new Map(ctx.items.map((i) => [i.id, i.nameEn ?? null]));
      const byItem = new Map<string, { qty: Qty; cost: Money }>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        for (const line of invoice.lines) {
          if (line.kind !== "inventory" || line.itemId === null) continue;
          const existing = byItem.get(line.itemId) ?? { qty: Qty.zero(), cost: Money.zero() };
          const stated = purchaseInvoiceLineBase(line);
          byItem.set(line.itemId, {
            qty: existing.qty.add(line.qty),
            cost: existing.cost.add(invoice.fxRate ? convertToBase(stated, invoice.fxRate) : stated),
          });
        }
      }
      const rows = [...byItem.entries()].map(([itemId, agg]) => ({
        itemId,
        itemNameAr: itemNames.get(itemId) ?? itemId,
          itemNameEn: itemNamesEn.get(itemId) ?? null,
        qty: Number(agg.qty.toString()),
        cost: Number(agg.cost.toString()),
      }));
      const totalCost = sumRows(rows, (r) => r.cost);
      return rows
        .map((r) => ({ ...r, costPercent: totalCost > 0 ? (r.cost / totalCost) * 100 : 0 }))
        .sort((a, b) => b.cost - a.cost);
    },
  };
}
