import { z } from "zod";
import { Money, Qty } from "../money/index.js";
import { purchaseInvoiceLineBase, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Item } from "../items/item.js";
import type { ReportDefinition } from "./types.js";
import { withinDateRange } from "./period-bucket.js";

/**
 * المشتريات حسب الصنف — Purchases by Item (docs/catalog/08-reports.md):
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
}

export interface PurchasesByItemRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: number;
  readonly cost: number;
  readonly costPercent: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
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
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
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
      computeReportTotal: (rows) => rows.reduce((sum, row) => sum + row.cost, 0),
      computeReferenceTotal: (_rows, ctx, params) => ctx.postedInventory?.(params) ?? 0,
      toleranceMoney: 0.01,
    },
    run: (params, ctx) => {
      const itemNames = new Map(ctx.items.map((i) => [i.id, i.nameAr]));
      const byItem = new Map<string, { qty: Qty; cost: Money }>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        for (const line of invoice.lines) {
          if (line.kind !== "inventory" || line.itemId === null) continue;
          const existing = byItem.get(line.itemId) ?? { qty: Qty.zero(), cost: Money.zero() };
          byItem.set(line.itemId, {
            qty: existing.qty.add(line.qty),
            cost: existing.cost.add(purchaseInvoiceLineBase(line)),
          });
        }
      }
      const rows = [...byItem.entries()].map(([itemId, agg]) => ({
        itemId,
        itemNameAr: itemNames.get(itemId) ?? itemId,
        qty: Number(agg.qty.toString()),
        cost: Number(agg.cost.toString()),
      }));
      const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
      return rows
        .map((r) => ({ ...r, costPercent: totalCost > 0 ? (r.cost / totalCost) * 100 : 0 }))
        .sort((a, b) => b.cost - a.cost);
    },
  };
}
