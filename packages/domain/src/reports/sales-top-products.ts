import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import type { SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { aggregateItemSales } from "./sales-item-aggregation.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * أفضل المنتجات — Top Products (docs/archive/catalog/08-reports.md): a ranked/
 * limited variant of المبيعات حسب الصنف, sortable by revenue or quantity,
 * capped at `limit` rows instead of paginated.
 */

export interface TopProductsContext {
  readonly invoices: readonly SalesInvoice[];
  /**
   * The item catalogue, for the English name only. An invoice LINE stores just
   * the Arabic name it was written with, so without this the report cannot be
   * read in English (D57). Optional: omit it and the Arabic name stands.
   */
  readonly items?: readonly { readonly id: string; readonly nameEn: string | null }[];
}

export interface TopProductsParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly limit: number;
  readonly rankBy: "revenue" | "qty";
  readonly branchId: string;
}

export interface TopProductsRow {
  readonly rank: number;
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly qty: number;
  readonly revenue: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  limit: z.coerce.number().int().positive().max(500),
  rankBy: z.enum(["revenue", "qty"]),
  branchId: branchIdParamSchema,
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
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, limit: 20, rankBy: "revenue", branchId: "" },
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
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "rank", header: "#", format: "qty", align: "end", value: (row) => row.rank },
      { key: "itemNameAr", header: "اسم الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "qty", header: "إجمالي الكمية المباعة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "revenue", header: "الإيرادات", format: "money", align: "end", total: true, value: (row) => row.revenue },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "revenue",
      maxPoints: 8,
      captionAr: "أفضل المنتجات مبيعاً، مرتبة تنازلياً.",
    },
    kpis: [
      { key: "revenue", labelAr: "إيرادات المنتجات المعروضة", format: "money", value: (rows) => sumRows(rows, (r) => r.revenue) },
      { key: "qty", labelAr: "إجمالي الكمية", format: "qty", value: (rows) => sumRows(rows, (r) => r.qty) },
      { key: "productCount", labelAr: "عدد المنتجات", format: "qty", value: (rows) => rows.length },
      { key: "topShare", labelAr: "حصة المنتج الأول", format: "percent", value: (rows) => rows[0]?.contributionPercent ?? 0 },
    ],
    run: (params, ctx) => {
      const inBranch = ctx.invoices.filter((invoice) => matchesBranch(invoice.branchId, params.branchId));
      const aggregates = aggregateItemSales(inBranch, params.dateFrom, params.dateTo);
      const namesEn = new Map((ctx.items ?? []).map((i) => [i.id, i.nameEn ?? null]));
      const totalRevenue = sumRows(aggregates, (a) => a.revenue);
      const ranked = aggregates
        .sort((a, b) => (params.rankBy === "revenue" ? b.revenue - a.revenue : b.qty - a.qty))
        .slice(0, params.limit);
      return ranked.map((a, i) => ({
        rank: i + 1,
        ...a,
        itemNameEn: namesEn.get(a.itemId) ?? null,
        contributionPercent: totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0,
      }));
    },
  };
}
