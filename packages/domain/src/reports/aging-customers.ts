import { z } from "zod";
import { Money } from "../money/index.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";

/**
 * أعمار ديون العملاء — Customer Debt Aging (docs/catalog/08-reports.md): the
 * standard 5-bucket AR aging ladder (جاري / 31-60 / 61-90 / 91-120 / أكثر من
 * 120 يوم) as of a snapshot date, from every live (confirmed/partially-paid/
 * paid) `SalesInvoice`'s own `dueDate` and outstanding balance
 * (`grandTotal − amountPaid`, using the SAME `computeInvoiceTotals` and
 * `amountPaid` the invoice screen and `recordPayment` use). "جاري" absorbs
 * both not-yet-due invoices and the first 30 days past due — the
 * conventional AR aging convention.
 */

export interface AgingCustomersContext {
  readonly invoices: readonly SalesInvoice[];
  /**
   * Amount already settled per invoice id, from the allocation sub-ledger. A
   * collection can be recorded either as `amountPaid` on the invoice or as a
   * voucher allocation, so the outstanding balance nets whichever is larger —
   * summing them would double-count an invoice settled through both paths.
   */
  readonly allocatedByInvoiceId?: ReadonlyMap<string, Money>;
}

export interface AgingCustomersParams {
  readonly asOfDate: string;
}

export interface AgingCustomersRow {
  readonly customerId: string;
  readonly customerNameAr: string;
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
  readonly customerNameAr: string;
  readonly current: Money;
  readonly d31to60: Money;
  readonly d61to90: Money;
  readonly d91to120: Money;
  readonly over120: Money;
}

function emptyBucketTotals(customerNameAr: string): AgingBucketTotals {
  return { customerNameAr, current: Money.zero(), d31to60: Money.zero(), d61to90: Money.zero(), d91to120: Money.zero(), over120: Money.zero() };
}

function addToBucket(totals: AgingBucketTotals, days: number, amount: Money): AgingBucketTotals {
  if (days <= 30) return { ...totals, current: totals.current.add(amount) };
  if (days <= 60) return { ...totals, d31to60: totals.d31to60.add(amount) };
  if (days <= 90) return { ...totals, d61to90: totals.d61to90.add(amount) };
  if (days <= 120) return { ...totals, d91to120: totals.d91to120.add(amount) };
  return { ...totals, over120: totals.over120.add(amount) };
}

export function createAgingCustomersReport(
  defaultAsOfDate: string,
): ReportDefinition<AgingCustomersParams, AgingCustomersRow, AgingCustomersContext> {
  return {
    id: "aging.customers",
    titleAr: "أعمار ديون العملاء",
    descriptionAr: "العملاء المتأخرون 90 يوماً أو أكثر يحتاجون تدخلاً فورياً.",
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }],
    rowKey: (row) => row.customerId,
    columns: [
      { key: "customerNameAr", header: "اسم العميل", format: "text", value: (row) => row.customerNameAr },
      { key: "current", header: "جاري", format: "money", align: "end", total: true, value: (row) => row.current },
      { key: "d31to60", header: "31-60 يوم", format: "money", align: "end", total: true, value: (row) => row.d31to60 },
      { key: "d61to90", header: "61-90 يوم", format: "money", align: "end", total: true, value: (row) => row.d61to90 },
      { key: "d91to120", header: "91-120 يوم", format: "money", align: "end", total: true, value: (row) => row.d91to120 },
      { key: "over120", header: "أكثر من 120 يوم", format: "money", align: "end", total: true, value: (row) => row.over120 },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
    ],
    run: (params, ctx) => {
      const byCustomer = new Map<string, AgingBucketTotals>();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (invoice.date > params.asOfDate) continue;
        const totals = computeInvoiceTotals(invoice.lines, invoice.discount, { taxExempt: invoice.customerTaxExempt });
        const allocated = ctx.allocatedByInvoiceId?.get(invoice.id) ?? Money.zero();
        const settled = allocated.scaled > invoice.amountPaid.scaled ? allocated : invoice.amountPaid;
        const balance = Money.fromScaled(totals.grandTotal.scaled - settled.scaled);
        if (balance.scaled <= 0n) continue;
        const existing = byCustomer.get(invoice.customerId) ?? emptyBucketTotals(invoice.customerNameAr);
        const days = daysPastDue(invoice.dueDate, params.asOfDate);
        byCustomer.set(invoice.customerId, addToBucket(existing, days, balance));
      }
      return [...byCustomer.entries()].map(([customerId, agg]) => ({
        customerId,
        customerNameAr: agg.customerNameAr,
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
