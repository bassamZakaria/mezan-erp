import { z } from "zod";
import { Money } from "../money/index.js";
import { purchaseInvoiceTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";
import type { ReportDefinition } from "./types.js";

/**
 * أعمار ديون الموردين — Supplier Debt Aging (docs/catalog/08-reports.md): the
 * AP mirror of أعمار ديون العملاء. Purchase invoices don't track payments
 * made against them yet, so every `confirmed` invoice's full total is
 * outstanding (see purchases-by-supplier.ts's note) — bucketed by days past
 * `dueDate` (falls back to the invoice `date` when no due date was set).
 */

export interface AgingSuppliersContext {
  readonly invoices: readonly PurchaseInvoice[];
  readonly suppliers: readonly Supplier[];
}

export interface AgingSuppliersParams {
  readonly asOfDate: string;
}

export interface AgingSuppliersRow {
  readonly supplierId: string;
  readonly supplierNameAr: string;
  readonly current: number;
  readonly d31to60: number;
  readonly d61to90: number;
  readonly d91to120: number;
  readonly over120: number;
  readonly total: number;
}

const paramsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
});

function daysPastDue(dueDate: string, asOfDate: string): number {
  if (dueDate >= asOfDate) return 0;
  return Math.round((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

interface AgingBucketTotals {
  readonly current: Money;
  readonly d31to60: Money;
  readonly d61to90: Money;
  readonly d91to120: Money;
  readonly over120: Money;
}

function emptyBucketTotals(): AgingBucketTotals {
  return { current: Money.zero(), d31to60: Money.zero(), d61to90: Money.zero(), d91to120: Money.zero(), over120: Money.zero() };
}

function addToBucket(totals: AgingBucketTotals, days: number, amount: Money): AgingBucketTotals {
  if (days <= 30) return { ...totals, current: totals.current.add(amount) };
  if (days <= 60) return { ...totals, d31to60: totals.d31to60.add(amount) };
  if (days <= 90) return { ...totals, d61to90: totals.d61to90.add(amount) };
  if (days <= 120) return { ...totals, d91to120: totals.d91to120.add(amount) };
  return { ...totals, over120: totals.over120.add(amount) };
}

export function createAgingSuppliersReport(
  defaultAsOfDate: string,
): ReportDefinition<AgingSuppliersParams, AgingSuppliersRow, AgingSuppliersContext> {
  return {
    id: "aging.suppliers",
    titleAr: "أعمار ديون الموردين",
    descriptionAr: "الموردون المتأخرون أكثر من 60 يوماً يستحقون أولوية التسديد (لا يشمل السداد — لا تتبع فواتير المشتريات حالياً دفعات).",
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }],
    rowKey: (row) => row.supplierId,
    columns: [
      { key: "supplierNameAr", header: "اسم المورد", format: "text", value: (row) => row.supplierNameAr },
      { key: "current", header: "جاري", format: "money", align: "end", total: true, value: (row) => row.current },
      { key: "d31to60", header: "31-60 يوم", format: "money", align: "end", total: true, value: (row) => row.d31to60 },
      { key: "d61to90", header: "61-90 يوم", format: "money", align: "end", total: true, value: (row) => row.d61to90 },
      { key: "d91to120", header: "91-120 يوم", format: "money", align: "end", total: true, value: (row) => row.d91to120 },
      { key: "over120", header: "أكثر من 120 يوم", format: "money", align: "end", total: true, value: (row) => row.over120 },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
    ],
    run: (params, ctx) => {
      const supplierNames = new Map(ctx.suppliers.map((s) => [s.id, s.nameAr]));
      const byBucketTotals = new Map<string, AgingBucketTotals>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (invoice.date > params.asOfDate) continue;
        const outstanding = purchaseInvoiceTotal(invoice);
        if (outstanding.scaled <= 0n) continue;
        const dueDate = invoice.dueDate ?? invoice.date;
        const existing = byBucketTotals.get(invoice.supplierId) ?? emptyBucketTotals();
        const days = daysPastDue(dueDate, params.asOfDate);
        byBucketTotals.set(invoice.supplierId, addToBucket(existing, days, outstanding));
      }
      return [...byBucketTotals.entries()].map(([supplierId, agg]) => ({
        supplierId,
        supplierNameAr: supplierNames.get(supplierId) ?? supplierId,
        current: Number(agg.current.toString()),
        d31to60: Number(agg.d31to60.toString()),
        d61to90: Number(agg.d61to90.toString()),
        d91to120: Number(agg.d91to120.toString()),
        over120: Number(agg.over120.toString()),
        total: Number(
          Money.fromScaled(
            agg.current.scaled + agg.d31to60.scaled + agg.d61to90.scaled + agg.d91to120.scaled + agg.over120.scaled,
          ).toString(),
        ),
      }));
    },
  };
}
