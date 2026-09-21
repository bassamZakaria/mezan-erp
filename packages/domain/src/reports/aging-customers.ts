import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { salesInvoiceBaseGrandTotal, salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumMoneyStrings, percentOfMoneyStrings } from "./kpi.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import type { AgingOpenItem } from "./aging-open-items.js";

/**
 * أعمار ديون العملاء — Customer Debt Aging (docs/archive/catalog/08-reports.md): the
 * standard 5-bucket AR aging ladder (جاري / 31-60 / 61-90 / 91-120 / أكثر من
 * 120 يوم) as of a snapshot date, from every live (confirmed/partially-paid/
 * paid) `SalesInvoice`'s own `dueDate` and outstanding balance (its BASE
 * grand total less what the allocation sub-ledger or `amountPaid` settled,
 * less its confirmed returns — see {@link customerAgingBalances}).
 * "جاري" absorbs
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
  readonly customers?: readonly { readonly id: string; readonly nameAr?: string; readonly nameEn: string | null }[];
  /**
   * Amount already settled per invoice id, from the allocation sub-ledger. A
   * collection can be recorded either as `amountPaid` on the invoice or as a
   * voucher allocation, so the outstanding balance nets whichever is larger —
   * summing them would double-count an invoice settled through both paths.
   */
  readonly allocatedByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * The part of each invoice's settlement applied from a collection or cheque
   * dated after `asOfDate` (D220). The control balance as of that day has not
   * been credited with it, so an as-of ladder must not net it either.
   */
  readonly settledAfterAsOfByInvoiceId?: ReadonlyMap<string, Money>;
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
  /** Opening balances and manual journal lines on the customer (D204, D205). */
  readonly openItems?: readonly AgingOpenItem[];
  /**
   * Balance of the AR CONTROL account in the GL as of `asOfDate` (D112).
   *
   * The ladder walks invoices; the control account holds what those invoices,
   * their collections and their returns actually posted. They are two
   * independent paths to one number, so a difference means one of them is
   * wrong — and without this the first report an accountant opens agreed only
   * with itself. Optional: omit it and the report still runs, it simply makes
   * no claim to tie to the ledger.
   */
  readonly receivablesControlBalance?: (params: AgingCustomersParams) => Money;
  /**
   * What FX revaluation has posted to the control account and not yet
   * reversed as of `asOfDate`. The ladder ages every invoice at the rate it
   * was booked at, so this is the one amount 1105 holds that no invoice does;
   * `receivablesControlBalance` is already net of it.
   */
  readonly fxRevaluationOnControl?: (params: AgingCustomersParams) => Money;
}

export interface AgingCustomersParams {
  readonly asOfDate: string;
  readonly branchId: string;
}

export interface AgingCustomersRow {
  readonly customerId: string;
  readonly customerNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly customerNameEn: string | null;
  readonly current: string;
  readonly d31to60: string;
  readonly d61to90: string;
  readonly d91to120: string;
  readonly over120: string;
  readonly total: string;
}

const paramsSchema = z.object({
  asOfDate: isoDateParamSchema,
  branchId: branchIdParamSchema,
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

/** Draw an unallocated customer credit down the ladder, oldest debt first; what is left over is a negative «جاري». */
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
  if (remaining > 0n) next = { ...next, current: Money.fromScaled(next.current.scaled - remaining) };
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
    defaultParams: { asOfDate: defaultAsOfDate, branchId: "" },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }, BRANCH_PARAM_FIELD],
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
    reconciliation: {
      labelAr: "إجمالي أعمار الديون مقابل حساب العملاء في دفتر الأستاذ",
      computeExactTotals: (rows, ctx, params) => ({
        report: Money.fromMajor(sumMoneyStrings(rows, (row) => [row.total])),
        reference: ctx.receivablesControlBalance?.(params) ?? Money.zero(),
      }),
      available: (ctx) => ctx.receivablesControlBalance !== undefined,
      toleranceMoney: 0.01,
      reconcilingItems: (ctx, params) => {
        const revalued = ctx.fxRevaluationOnControl?.(params) ?? Money.zero();
        return [{ key: "fxRevaluation", labelAr: "إعادة تقييم العملات المرحّلة على الحساب (مستبعدة من المطابقة)", amount: revalued.toString() }];
      },
    },
    chart: {
      labelColumn: "customerNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "العملاء مرتبون حسب إجمالي المتأخر عليهم.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المديونية", format: "money", value: (rows) => sumMoneyStrings(rows, (r) => [r.total]) },
      { key: "over90", labelAr: "متأخر أكثر من 90 يوم", format: "money", value: (rows) => sumMoneyStrings(rows, (r) => [r.d91to120, r.over120]), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "over90Percent", labelAr: "نسبة المتأخر", format: "percent", value: (rows) => percentOfMoneyStrings(sumMoneyStrings(rows, (r) => [r.d91to120, r.over120]), sumMoneyStrings(rows, (r) => [r.total])) },
      { key: "customerCount", labelAr: "عدد العملاء المدينين", format: "qty", value: (rows) => rows.length },
    ],
    run: (params, ctx) =>
      [...customerAgingBalances(params, ctx)].map(([customerId, agg]) => ({
        customerId,
        customerNameAr: agg.customerNameAr,
        customerNameEn: agg.customerNameEn,
        current: agg.current.toString(),
        d31to60: agg.d31to60.toString(),
        d61to90: agg.d61to90.toString(),
        d91to120: agg.d91to120.toString(),
        over120: agg.over120.toString(),
        total: agingBucketsTotal(agg).toString(),
      })),
  };
}

export type CustomerAgingBalance = AgingBucketTotals;

/** A customer's whole ladder row as one figure. */
export function agingBucketsTotal(totals: Omit<AgingBucketTotals, "customerNameAr" | "customerNameEn">): Money {
  return Money.fromScaled(
    totals.current.scaled + totals.d31to60.scaled + totals.d61to90.scaled + totals.d91to120.scaled + totals.over120.scaled,
  );
}

/**
 * The ladder per customer, in `Money`; the customers screen's «المستحق» reads
 * it too (D195). Invoices age at their BASE total, the amount 1105 was debited
 * with (D194), and a credit beyond the debt stays as a negative «جاري» because
 * 1105 still carries it.
 */
export function customerAgingBalances(
  params: AgingCustomersParams,
  ctx: AgingCustomersContext,
): Map<string, CustomerAgingBalance> {
  const namesEn = new Map((ctx.customers ?? []).map((c) => [c.id, c.nameEn ?? null]));
  const namesAr = new Map((ctx.customers ?? []).map((c) => [c.id, c.nameAr]));
  const byCustomer = new Map<string, AgingBucketTotals>();
  const credits = new Map<string, bigint>();
  const addCredit = (customerId: string, scaled: bigint) => credits.set(customerId, (credits.get(customerId) ?? 0n) + scaled);
  for (const invoice of ctx.invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (invoice.date > params.asOfDate) continue;
    if (!matchesBranch(invoice.branchId, params.branchId)) continue;
    const total = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
    const allocated = ctx.allocatedByInvoiceId?.get(invoice.id) ?? Money.zero();
    const settledNow = allocated.scaled > invoice.amountPaid.scaled ? allocated : invoice.amountPaid;
    const later = ctx.settledAfterAsOfByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const settled = Money.fromScaled(settledNow.scaled > later ? settledNow.scaled - later : 0n);
    const returned = ctx.returnsByInvoiceId?.get(invoice.id) ?? Money.zero();
    const balance = Money.fromScaled(total.scaled - settled.scaled - returned.scaled);
    // A return beyond what is still open leaves the customer in credit, and
    // 1105 carries that credit until it is refunded.
    if (balance.scaled < 0n) addCredit(invoice.customerId, -balance.scaled);
    if (balance.scaled <= 0n) continue;
    const existing = byCustomer.get(invoice.customerId) ?? emptyBucketTotals(invoice.customerNameAr, namesEn.get(invoice.customerId) ?? null);
    const days = daysPastDue(invoice.dueDate, params.asOfDate);
    byCustomer.set(invoice.customerId, addToBucket(existing, days, balance));
  }
  for (const [customerId, credit] of ctx.unappliedCreditsByCustomerId ?? []) {
    if (credit.scaled > 0n) addCredit(customerId, credit.scaled);
  }
  for (const item of ctx.openItems ?? []) {
    if (item.date > params.asOfDate) continue;
    if (!matchesBranch(item.branchId, params.branchId)) continue;
    if (item.amount.scaled < 0n) {
      addCredit(item.partyId, -item.amount.scaled);
      continue;
    }
    if (item.amount.scaled === 0n) continue;
    const existing =
      byCustomer.get(item.partyId) ??
      emptyBucketTotals(namesAr.get(item.partyId) ?? item.partyId, namesEn.get(item.partyId) ?? null);
    byCustomer.set(item.partyId, addToBucket(existing, daysPastDue(item.dueDate ?? item.date, params.asOfDate), item.amount));
  }
  for (const [customerId, scaled] of credits) {
    const credit = Money.fromScaled(scaled);
    const existing = byCustomer.get(customerId);
    // A branch-narrowed ladder cannot say which branch an unapplied credit
    // belongs to, so it only nets one against a row the branch already has.
    if (!existing && params.branchId !== "") continue;
    const start = existing ?? emptyBucketTotals(namesAr.get(customerId) ?? customerId, namesEn.get(customerId) ?? null);
    byCustomer.set(customerId, applyCredit(start, credit));
  }
  return byCustomer;
}
