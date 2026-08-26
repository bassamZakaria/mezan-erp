import { z } from "zod";
import type { SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { aggregateItemSales } from "./sales-item-aggregation.js";

/**
 * أفضل المنتجات — Top Products (docs/catalog/08-reports.md): a ranked/
 * limited variant of المبيعات حسب الصنف, sortable by revenue or quantity,
 * capped at `limit` rows instead of paginated.
 */

export interface TopProductsContext {
  readonly invoices: readonly SalesInvoice[];
}

export interface TopProductsParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly limit: number;
  readonly rankBy: "revenue" | "qty";
}

export interface TopProductsRow {
  readonly rank: number;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: number;
  readonly revenue: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  limit: z.coerce.number().int().positive().max(500),
  rankBy: z.enum(["revenue", "qty"]),
});

export function createTopProductsReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<TopProductsParams, TopProductsRow, TopProductsContext> {
  return {
    id: "sales.top-products",
    titleAr: "أفضل المنتجات",
    descriptionAr: "أكثر المنتجات مبيعاً وكيف تتوزع الإيرادات بينها.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, limit: 20, rankBy: "revenue" },
    paramFields: [
      { kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      { kind: "text", key: "limit", label: "الحد الأقصى" },
      {
        kind: "select",
        key: "rankBy",
        label: "الترتيب حسب",
        options: [
          { value: "revenue", label: "إيرادات" },
          { value: "qty", label: "كمية" },
        ],
      },
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "rank", header: "#", format: "qty", align: "end", value: (row) => row.rank },
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr },
      { key: "qty", header: "إجمالي الكمية المباعة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "revenue", header: "الإيرادات", format: "money", align: "end", total: true, value: (row) => row.revenue },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    run: (params, ctx) => {
      const aggregates = aggregateItemSales(ctx.invoices, params.dateFrom, params.dateTo);
      const totalRevenue = aggregates.reduce((sum, a) => sum + a.revenue, 0);
      const ranked = aggregates
        .sort((a, b) => (params.rankBy === "revenue" ? b.revenue - a.revenue : b.qty - a.qty))
        .slice(0, params.limit);
      return ranked.map((a, i) => ({
        rank: i + 1,
        ...a,
        contributionPercent: totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0,
      }));
    },
  };
}
