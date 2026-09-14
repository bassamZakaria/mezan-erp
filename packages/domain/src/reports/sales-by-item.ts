import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import type { SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { aggregateItemSales } from "./sales-item-aggregation.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * المبيعات حسب الصنف — Sales by Item (docs/archive/catalog/08-reports.md): top
 * revenue-generating items in a period, with each item's share of total
 * revenue (نسبة المساهمة).
 */

export interface SalesByItemContext {
  readonly invoices: readonly SalesInvoice[];
  /**
   * The item catalogue, for the English name only. An invoice LINE stores just
   * the Arabic name it was written with, so without this the report cannot be
   * read in English (D57). Optional: omit it and the Arabic name stands.
   */
  readonly items?: readonly { readonly id: string; readonly nameEn: string | null }[];
  /**
   * Revenue posted to the GL over the same period (A7). Optional: without it
   * the report still runs, it simply cannot claim to tie to the ledger —
   * which is more honest than a reconciliation panel comparing a figure to
   * itself.
   */
  readonly postedRevenue?: (params: { dateFrom: string; dateTo: string }) => number;
  /**
   * Whether a line's revenue account is one the chart KNOWS is not revenue —
   * a contract BILLING rather than a sale (see `aggregateItemSales`).
   * Optional: omit it and every line counts, which is right for a tenant with
   * no contracting documents.
   */
  readonly isContractBilling?: (accountId: string) => boolean;
}

export interface SalesByItemParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
}

export interface SalesByItemRow {
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
  branchId: branchIdParamSchema,
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
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.itemId,
    columns: [
      { key: "itemNameAr", header: "الصنف", format: "text", value: (row) => row.itemNameAr, entity: { kind: "item", id: (row) => row.itemId } },
      { key: "qty", header: "إجمالي الكمية المباعة", format: "qty", align: "end", total: true, value: (row) => row.qty },
      { key: "revenue", header: "الإيرادات", format: "money", align: "end", total: true, value: (row) => row.revenue },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    /**
     * The report sums invoice lines; the GL holds what those invoices posted
     * to revenue. They are two independent paths to the same number, so a
     * difference means one of them is wrong — which is the only reason to
     * show a reconciliation at all. Both sides read the SAME fact: what a
     * sales invoice credited to the revenue accounts its counted lines named.
     * A contract billing line is absent from both.
     */
    reconciliation: {
      labelAr: "إيرادات التقرير مقابل المرحَّل في دفتر الأستاذ",
      computeReportTotal: (rows) => sumRows(rows, (row) => row.revenue),
      computeReferenceTotal: (_rows, ctx, params) => ctx.postedRevenue?.(params) ?? 0,
      available: (ctx) => ctx.postedRevenue !== undefined,
      toleranceMoney: 0.01,
    },
    chart: {
      labelColumn: "itemNameAr",
      valueColumn: "revenue",
      maxPoints: 8,
      captionAr: "الأصناف مرتبة من الأعلى إيراداً — طول العمود هو حصة الصنف من أعلى صنف، لا من الإجمالي.",
    },
    kpis: [
      { key: "revenue", labelAr: "إجمالي الإيرادات", format: "money", value: (rows) => sumRows(rows, (r) => r.revenue) },
      { key: "qty", labelAr: "الكمية المباعة", format: "qty", value: (rows) => sumRows(rows, (r) => r.qty) },
      { key: "itemCount", labelAr: "عدد الأصناف", format: "qty", value: (rows) => rows.length },
      { key: "topShare", labelAr: "حصة أعلى صنف", format: "percent", value: (rows) => rows[0]?.contributionPercent ?? 0 },
    ],
    run: (params, ctx) => {
      const inBranch = ctx.invoices.filter((invoice) => matchesBranch(invoice.branchId, params.branchId));
      const aggregates = aggregateItemSales(inBranch, params.dateFrom, params.dateTo, "exc", ctx.isContractBilling);
      const namesEn = new Map((ctx.items ?? []).map((i) => [i.id, i.nameEn ?? null]));
      const totalRevenue = sumRows(aggregates, (a) => a.revenue);
      return aggregates
        .map((a) => ({ ...a, itemNameEn: namesEn.get(a.itemId) ?? null, contributionPercent: totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0 }))
        .sort((a, b) => b.revenue - a.revenue);
    },
  };
}
