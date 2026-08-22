import { z } from "zod";
import { Money } from "../money/index.js";
import { purchaseInvoiceTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";
import type { ReportDefinition } from "./types.js";
import { withinDateRange } from "./period-bucket.js";

/**
 * المشتريات حسب المورد — Purchases by Supplier (docs/catalog/08-reports.md):
 * supplier concentration and outstanding payables. Purchase invoices don't
 * yet track payments made against them (no `amountPaid`, unlike
 * `SalesInvoice` — supplier settlement lands in a later treasury phase), so
 * المستحق is every confirmed invoice's full total: an honest "nothing has
 * been recorded as paid yet" rather than a guessed partial figure.
 */

export interface PurchasesBySupplierContext {
  readonly invoices: readonly PurchaseInvoice[];
  readonly suppliers: readonly Supplier[];
}

export interface PurchasesBySupplierParams {
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface PurchasesBySupplierRow {
  readonly supplierId: string;
  readonly supplierNameAr: string;
  readonly count: number;
  readonly total: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
});

export function createPurchasesBySupplierReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<PurchasesBySupplierParams, PurchasesBySupplierRow, PurchasesBySupplierContext> {
  return {
    id: "purchases.by-supplier",
    titleAr: "المشتريات حسب المورد",
    descriptionAr: "على من نعتمد أكثر في مشترياتنا وما هي المستحقات المتبقية (لا يشمل السداد — لا تتبع فواتير المشتريات حالياً دفعات).",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }],
    rowKey: (row) => row.supplierId,
    columns: [
      { key: "supplierNameAr", header: "اسم المورد", format: "text", value: (row) => row.supplierNameAr },
      { key: "count", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "outstanding", header: "المستحق", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "percent", align: "end", value: (row) => row.contributionPercent },
    ],
    run: (params, ctx) => {
      const supplierNames = new Map(ctx.suppliers.map((s) => [s.id, s.nameAr]));
      const bySupplier = new Map<string, { count: number; total: Money }>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        const total = purchaseInvoiceTotal(invoice);
        const existing = bySupplier.get(invoice.supplierId) ?? { count: 0, total: Money.zero() };
        bySupplier.set(invoice.supplierId, { count: existing.count + 1, total: existing.total.add(total) });
      }
      const rows = [...bySupplier.entries()].map(([supplierId, agg]) => ({
        supplierId,
        supplierNameAr: supplierNames.get(supplierId) ?? supplierId,
        count: agg.count,
        total: Number(agg.total.toString()),
        outstanding: Number(agg.total.toString()),
      }));
      const totalAll = rows.reduce((sum, r) => sum + r.total, 0);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalAll > 0 ? (r.total / totalAll) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
    },
  };
}
