import { z } from "zod";
import { Money } from "../money/index.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { periodBucketKey, withinDateRange, type PeriodGroupBy } from "./period-bucket.js";

/**
 * المبيعات حسب الفترة — Sales by Period (docs/catalog/08-reports.md): day/
 * week/month sales trend for a period, net of discounts, with tax. Computed
 * from real confirmed/partially-paid/paid `SalesInvoice`s — each invoice's
 * totals come from the SAME `computeInvoiceTotals` the invoice screen and GL
 * posting use, so this report can never disagree with the invoice itself.
 */

export interface SalesByPeriodContext {
  readonly invoices: readonly SalesInvoice[];
}

export interface SalesByPeriodParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly groupBy: PeriodGroupBy;
}

export interface SalesByPeriodRow {
  readonly bucket: string;
  readonly count: number;
  readonly gross: number;
  readonly discount: number;
  readonly tax: number;
  readonly net: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  groupBy: z.enum(["day", "week", "month"]),
});

export function createSalesByPeriodReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<SalesByPeriodParams, SalesByPeriodRow, SalesByPeriodContext> {
  return {
    id: "sales.by-period",
    titleAr: "المبيعات حسب الفترة",
    descriptionAr: "كيف كانت حركة المبيعات في الفترة المحددة، صافية من الخصومات ومع الضريبة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, groupBy: "day" },
    paramFields: [
      { kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      {
        kind: "select",
        key: "groupBy",
        label: "التجميع",
        options: [
          { value: "day", label: "يومي" },
          { value: "week", label: "أسبوعي" },
          { value: "month", label: "شهري" },
        ],
      },
    ],
    rowKey: (row) => row.bucket,
    columns: [
      { key: "bucket", header: "التاريخ", format: "text", value: (row) => row.bucket },
      { key: "count", header: "عدد المبيعات", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "gross", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.gross },
      { key: "discount", header: "الخصم", format: "money", align: "end", total: true, value: (row) => row.discount },
      { key: "tax", header: "الضريبة", format: "money", align: "end", total: true, value: (row) => row.tax },
      { key: "net", header: "الصافي", format: "money", align: "end", total: true, value: (row) => row.net },
    ],
    run: (params, ctx) => {
      const buckets = new Map<string, SalesByPeriodRow>();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        const totals = computeInvoiceTotals(invoice.lines, invoice.discount, { taxExempt: invoice.customerTaxExempt });
        const discount = Money.fromScaled(totals.lineDiscountTotal.scaled + totals.invoiceDiscountTotal.scaled);
        const key = periodBucketKey(invoice.date, params.groupBy);
        const existing = buckets.get(key) ?? { bucket: key, count: 0, gross: 0, discount: 0, tax: 0, net: 0 };
        buckets.set(key, {
          bucket: key,
          count: existing.count + 1,
          gross: existing.gross + Number(totals.grossTotal.toString()),
          discount: existing.discount + Number(discount.toString()),
          tax: existing.tax + Number(totals.taxTotal.toString()),
          net: existing.net + Number(totals.grandTotal.toString()),
        });
      }
      return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    },
  };
}
