import { z } from "zod";
import type { SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { aggregateItemSales } from "./sales-item-aggregation.js";

/**
 * المبيعات حسب الصنف — Sales by Item (docs/catalog/08-reports.md): top
 * revenue-generating items in a period, with each item's share of total
 * revenue (نسبة المساهمة).
 */

export interface SalesByItemContext {
  readonly invoices: readonly SalesInvoice[];
  /**
   * Revenue posted to the GL over the same period (A7). Optional: without it
   * the report still runs, it simply cannot claim to tie to the ledger —
   * which is more honest than a reconciliation panel comparing a figure to
   * itself.
   */
  readonly postedRevenue?: (params: { dateFrom: string; dateTo: string }) => number;
}

export interface SalesByItemParams {
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface SalesByItemRow {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: number;
  readonly revenue: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
});

export function createSalesByItemReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<SalesByItemParams, SalesByItemRow, SalesByItemContext> {
  return {
    id: "sales.by-item",
    titleAr: "المبيعات حسب الصنف",
    descriptionAr: "ما هي الأصناف الأعلى إيراداً في الفترة المحددة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "qty", header: "إجمالي الكمية المباعة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "revenue", header: "الإيرادات", format: "money", align: "end", total: true, value: (row) => row.revenue },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    /**
     * The report sums invoice lines; the GL holds what those invoices posted
     * to revenue. They are two independent paths to the same number, so a
     * difference means one of them is wrong — which is the only reason to
     * show a reconciliation at all.
     */
    reconciliation: {
      labelAr: "إيرادات التقرير مقابل المرحَّل في دفتر الأستاذ",
      computeReportTotal: (rows) => rows.reduce((sum, row) => sum + row.revenue, 0),
      computeReferenceTotal: (_rows, ctx, params) => ctx.postedRevenue?.(params) ?? 0,
      toleranceMoney: 0.01,
    },
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "revenue",
      maxPoints: 8,
      captionAr: "الأصناف مرتبة من الأعلى إيراداً — طول العمود هو حصة الصنف من أعلى صنف، لا من الإجمالي.",
    },
    run: (params, ctx) => {
      const aggregates = aggregateItemSales(ctx.invoices, params.dateFrom, params.dateTo);
      const totalRevenue = aggregates.reduce((sum, a) => sum + a.revenue, 0);
      return aggregates
        .map((a) => ({ ...a, contributionPercent: totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0 }))
        .sort((a, b) => b.revenue - a.revenue);
    },
  };
}
