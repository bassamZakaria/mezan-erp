import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { purchaseInvoiceBaseTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * المشتريات حسب المورد — Purchases by Supplier (docs/archive/catalog/08-reports.md):
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
  readonly branchId: string;
}

export interface PurchasesBySupplierRow {
  readonly supplierId: string;
  readonly supplierNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly supplierNameEn: string | null;
  readonly count: number;
  readonly total: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
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
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.supplierId,
    columns: [
      { key: "supplierNameAr", header: "اسم المورد", format: "text", value: (row) => row.supplierNameAr, entity: { kind: "supplier", id: (row) => row.supplierId } },
      { key: "count", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "outstanding", header: "المستحق", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    chart: {
      labelColumn: "supplierNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "المورّدون مرتبون حسب حجم الإنفاق في الفترة.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المشتريات", format: "money", value: (rows) => sumRows(rows, (r) => r.total) },
      { key: "outstanding", labelAr: "المستحق للموردين", format: "money", value: (rows) => sumRows(rows, (r) => r.outstanding), tone: (value) => (value > 0 ? "danger" : "default") },
      { key: "supplierCount", labelAr: "عدد الموردين", format: "qty", value: (rows) => rows.length },
      { key: "topShare", labelAr: "حصة أكبر مورد", format: "percent", value: (rows) => rows[0]?.contributionPercent ?? 0 },
    ],
    run: (params, ctx) => {
      const supplierNames = new Map(ctx.suppliers.map((s) => [s.id, s.nameAr]));
      const supplierNamesEn = new Map(ctx.suppliers.map((s) => [s.id, s.nameEn ?? null]));
      const bySupplier = new Map<string, { count: number; total: Money }>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        const total = purchaseInvoiceBaseTotal(invoice);
        const existing = bySupplier.get(invoice.supplierId) ?? { count: 0, total: Money.zero() };
        bySupplier.set(invoice.supplierId, { count: existing.count + 1, total: existing.total.add(total) });
      }
      const rows = [...bySupplier.entries()].map(([supplierId, agg]) => ({
        supplierId,
        supplierNameAr: supplierNames.get(supplierId) ?? supplierId,
          supplierNameEn: supplierNamesEn.get(supplierId) ?? null,
        count: agg.count,
        total: Number(agg.total.toString()),
        outstanding: Number(agg.total.toString()),
      }));
      const totalAll = sumRows(rows, (r) => r.total);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalAll > 0 ? (r.total / totalAll) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
    },
  };
}
