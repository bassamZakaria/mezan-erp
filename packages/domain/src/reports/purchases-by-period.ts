import { z } from "zod";
import { purchaseInvoiceSubtotal, purchaseInvoiceTax, purchaseInvoiceTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, averageOf } from "./kpi.js";
import { periodBucketKey, withinDateRange, type PeriodGroupBy } from "./period-bucket.js";

/**
 * المشتريات حسب الفترة — Purchases by Period (docs/archive/catalog/08-reports.md):
 * day/week/month purchase-cost trend, structurally a mirror of المبيعات حسب
 * الفترة but with no discount column — purchase invoices don't carry a
 * document-level discount. Only `confirmed` invoices count (a draft invoice
 * has no GL effect yet).
 */

export interface PurchasesByPeriodContext {
  readonly invoices: readonly PurchaseInvoice[];
}

export interface PurchasesByPeriodParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly groupBy: PeriodGroupBy;
}

export interface PurchasesByPeriodRow {
  readonly bucket: string;
  readonly count: number;
  readonly gross: number;
  readonly tax: number;
  readonly net: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  groupBy: z.enum(["day", "week", "month"]),
});

export function createPurchasesByPeriodReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<PurchasesByPeriodParams, PurchasesByPeriodRow, PurchasesByPeriodContext> {
  return {
    id: "purchases.by-period",
    titleAr: "المشتريات حسب الفترة",
    descriptionAr: "كيف تغيرت تكلفة الشراء يوماً بيوم في الفترة المحددة.",
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
      { key: "count", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "gross", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.gross },
      { key: "tax", header: "الضريبة", format: "money", align: "end", total: true, value: (row) => row.tax },
      { key: "net", header: "الصافي", format: "money", align: "end", total: true, value: (row) => row.net },
    ],
    chart: {
      labelColumn: "bucket",
      valueColumn: "net",
      maxPoints: 8,
      captionAr: "صافي تكلفة الشراء في كل فترة.",
    },
    kpis: [
      { key: "net", labelAr: "صافي المشتريات", format: "money", value: (rows) => sumRows(rows, (r) => r.net) },
      { key: "tax", labelAr: "الضريبة المدفوعة", format: "money", value: (rows) => sumRows(rows, (r) => r.tax) },
      { key: "count", labelAr: "عدد الفواتير", format: "qty", value: (rows) => sumRows(rows, (r) => r.count) },
      { key: "avgInvoice", labelAr: "متوسط قيمة الفاتورة", hintAr: "الصافي ÷ عدد الفواتير", format: "money", value: (rows) => averageOf(sumRows(rows, (r) => r.net), sumRows(rows, (r) => r.count)) },
    ],
    run: (params, ctx) => {
      const buckets = new Map<string, PurchasesByPeriodRow>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        const key = periodBucketKey(invoice.date, params.groupBy);
        const existing = buckets.get(key) ?? { bucket: key, count: 0, gross: 0, tax: 0, net: 0 };
        buckets.set(key, {
          bucket: key,
          count: existing.count + 1,
          gross: existing.gross + Number(purchaseInvoiceSubtotal(invoice).toString()),
          tax: existing.tax + Number(purchaseInvoiceTax(invoice).toString()),
          net: existing.net + Number(purchaseInvoiceTotal(invoice).toString()),
        });
      }
      return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    },
  };
}
