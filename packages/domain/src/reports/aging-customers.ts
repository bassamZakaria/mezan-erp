import { z } from "zod";
import { Money } from "../money/index.js";
import { salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, percentOf } from "./kpi.js";

/**
 * أعمار ديون العملاء — Customer Debt Aging (docs/archive/catalog/08-reports.md): the
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
   * The customer list, for the English name only. An invoice stores just the
   * Arabic name it was written with, so without this the report cannot be read
   * in English (D57). Optional: omit it and the Arabic name stands.
   */
  readonly customers?: readonly { readonly id: string; readonly nameEn: string | null }[];
  /**
   * Amount already settled per invoice id, from the allocation sub-ledger. A
   * collection can be recorded either as `amountPaid` on the invoice or as a
   * voucher allocation, so the outstanding balance nets whichever is larger —
   * summing them would double-count an invoice settled through both paths.
   */
  readonly allocatedByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * Confirmed sales returns per SOURCE invoice. A return credits AR in the GL,
   * so an aging ladder that ignores it reports a debt the ledger has already
   * cancelled.
   */
  readonly returnsByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * Customer credits that name no invoice — an incoming cheque, a collection
   * nobody allocated. They credit AR in the GL the moment they are recorded, so
   * the ladder has to absorb them; applied oldest-bucket-first, because that is
   * the order a collector would actually clear a customer's debt in.
   */
  readonly unappliedCreditsByCustomerId?: ReadonlyMap<string, Money>;
}

export interface AgingCustomersParams {
  readonly asOfDate: string;
}

export interface AgingCustomersRow {
  readonly customerId: string;
  readonly customerNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly customerNameEn: string | null;
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
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly customerNameEn: string | null;
  readonly current: Money;
  readonly d31to60: Money;
  readonly d61to90: Money;
  readonly d91to120: Money;
  readonly over120: Money;
}

function emptyBucketTotals(customerNameAr: string, customerNameEn: string | null): AgingBucketTotals {
  return { customerNameAr, customerNameEn, current: Money.zero(), d31to60: Money.zero(), d61to90: Money.zero(), d91to120: Money.zero(), over120: Money.zero() };
}

function addToBucket(totals: AgingBucketTotals, days: number, amount: Money): AgingBucketTotals {
  if (days <= 30) return { ...totals, current: totals.current.add(amount) };
  if (days <= 60) return { ...totals, d31to60: totals.d31to60.add(amount) };
  if (days <= 90) return { ...totals, d61to90: totals.d61to90.add(amount) };
  if (days <= 120) return { ...totals, d91to120: totals.d91to120.add(amount) };
  return { ...totals, over120: totals.over120.add(amount) };
}

/** Oldest bucket first — the order a collector clears a customer's debt in. */
const BUCKETS = ["over120", "d91to120", "d61to90", "d31to60", "current"] as const;

/** Draw an unallocated customer credit down the ladder, oldest debt first. */
function applyCredit(totals: AgingBucketTotals, credit: Money): AgingBucketTotals {
  let remaining = credit.scaled;
  let next = totals;
  for (const bucket of BUCKETS) {
    if (remaining <= 0n) break;
    const held = next[bucket].scaled;
    if (held <= 0n) continue;
    const taken = held < remaining ? held : remaining;
    next = { ...next, [bucket]: Money.fromScaled(held - taken) };
    remaining -= taken;
  }
  return next;
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
      { key: "customerNameAr", header: "اسم العميل", format: "text", value: (row) => row.customerNameAr, entity: { kind: "customer", id: (row) => row.customerId } },
      { key: "current", header: "جاري", format: "money", align: "end", total: true, value: (row) => row.current },
      { key: "d31to60", header: "31-60 يوم", format: "money", align: "end", total: true, value: (row) => row.d31to60 },
      { key: "d61to90", header: "61-90 يوم", format: "money", align: "end", total: true, value: (row) => row.d61to90 },
      { key: "d91to120", header: "91-120 يوم", format: "money", align: "end", total: true, value: (row) => row.d91to120 },
      { key: "over120", header: "أكثر من 120 يوم", format: "money", align: "end", total: true, value: (row) => row.over120 },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
    ],
    chart: {
      labelColumn: "customerNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "العملاء مرتبون حسب إجمالي المتأخر عليهم.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المديونية", format: "money", value: (rows) => sumRows(rows, (r) => r.total) },
      { key: "over90", labelAr: "متأخر أكثر من 90 يوم", format: "money", value: (rows) => sumRows(rows, (r) => r.d91to120 + r.over120), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "over90Percent", labelAr: "نسبة المتأخر", format: "percent", value: (rows) => percentOf(sumRows(rows, (r) => r.d91to120 + r.over120), sumRows(rows, (r) => r.total)) },
      { key: "customerCount", labelAr: "عدد العملاء المدينين", format: "qty", value: (rows) => rows.length },
    ],
    run: (params, ctx) => {
      const namesEn = new Map((ctx.customers ?? []).map((c) => [c.id, c.nameEn ?? null]));
      const byCustomer = new Map<string, AgingBucketTotals>();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (invoice.date > params.asOfDate) continue;
        const totals = salesInvoiceTotals(invoice);
        const allocated = ctx.allocatedByInvoiceId?.get(invoice.id) ?? Money.zero();
        const settled = allocated.scaled > invoice.amountPaid.scaled ? allocated : invoice.amountPaid;
        const returned = ctx.returnsByInvoiceId?.get(invoice.id) ?? Money.zero();
        const balance = Money.fromScaled(totals.grandTotal.scaled - settled.scaled - returned.scaled);
        if (balance.scaled <= 0n) continue;
        const existing = byCustomer.get(invoice.customerId) ?? emptyBucketTotals(invoice.customerNameAr, namesEn.get(invoice.customerId) ?? null);
        const days = daysPastDue(invoice.dueDate, params.asOfDate);
        byCustomer.set(invoice.customerId, addToBucket(existing, days, balance));
      }
      for (const [customerId, credit] of ctx.unappliedCreditsByCustomerId ?? []) {
        const existing = byCustomer.get(customerId);
        if (!existing || credit.scaled <= 0n) continue;
        byCustomer.set(customerId, applyCredit(existing, credit));
      }
      return [...byCustomer.entries()].map(([customerId, agg]) => ({
        customerId,
        customerNameAr: agg.customerNameAr,
        customerNameEn: agg.customerNameEn,
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
