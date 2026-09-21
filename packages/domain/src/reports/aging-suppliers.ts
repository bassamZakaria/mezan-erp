import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { purchaseInvoiceBaseTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";
import type { ReportDefinition } from "./types.js";
import { sumMoneyStrings, percentOfMoneyStrings } from "./kpi.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import type { AgingOpenItem } from "./aging-open-items.js";

/**
 * أعمار ديون الموردين — Supplier Debt Aging (docs/archive/catalog/08-reports.md): the
 * AP mirror of أعمار ديون العملاء. Purchase invoices don't track payments
 * outstanding — each invoice's BASE total less whatever the allocation
 * sub-ledger has settled against it, bucketed by days past
 * `dueDate` (falls back to the invoice `date` when no due date was set).
 */

export interface AgingSuppliersContext {
  readonly invoices: readonly PurchaseInvoice[];
  readonly suppliers: readonly Supplier[];
  /**
   * Amount already settled per invoice id, from the allocation sub-ledger.
   * Omit it and every confirmed invoice ages at its full total — which is what
   * this report did before payments could be recorded against a supplier.
   */
  readonly allocatedByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * The part of each invoice's settlement applied from a payment or cheque
   * dated after `asOfDate` (D220) — the twin of the customer ladder's term.
   */
  readonly settledAfterAsOfByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * Confirmed purchase returns per SOURCE invoice. A return debits AP in the
   * GL, so a ladder that ignores it reports a debt the ledger has cancelled —
   * the twin of the customer ladder's `returnsByInvoiceId`.
   */
  readonly returnsByInvoiceId?: ReadonlyMap<string, Money>;
  /**
   * Supplier debits that settle no invoice — a live outgoing cheque's
   * unallocated remainder, a payment nobody allocated. They debit AP the
   * moment they are recorded, so the ladder absorbs them oldest bucket first,
   * the twin of the customer ladder's `unappliedCreditsByCustomerId`.
   */
  readonly unappliedDebitsBySupplierId?: ReadonlyMap<string, Money>;
  /** Opening balances and manual journal lines on the supplier (D204, D205). */
  readonly openItems?: readonly AgingOpenItem[];
  /**
   * Balance of the AP CONTROL account in the GL as of `asOfDate` (D112). Same
   * reason as the customer ladder: the report walks invoices, the control
   * account holds what they posted, and a difference means one of the two is
   * wrong. Optional — omit it and the report makes no claim to tie.
   */
  readonly payablesControlBalance?: (params: AgingSuppliersParams) => Money;
  /**
   * What FX revaluation has posted to the control account and not yet
   * reversed as of `asOfDate` — the twin of the customer ladder's term.
   * `payablesControlBalance` is already net of it.
   */
  readonly fxRevaluationOnControl?: (params: AgingSuppliersParams) => Money;
}

export interface AgingSuppliersParams {
  readonly asOfDate: string;
  readonly branchId: string;
}

export interface AgingSuppliersRow {
  readonly supplierId: string;
  readonly supplierNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly supplierNameEn: string | null;
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

const BUCKETS = ["over120", "d91to120", "d61to90", "d31to60", "current"] as const;

function applyDebit(totals: AgingBucketTotals, debit: Money): AgingBucketTotals {
  let remaining = debit.scaled;
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

export function createAgingSuppliersReport(
  defaultAsOfDate: string,
): ReportDefinition<AgingSuppliersParams, AgingSuppliersRow, AgingSuppliersContext> {
  return {
    id: "aging.suppliers",
    titleAr: "أعمار ديون الموردين",
    descriptionAr: "الموردون المتأخرون أكثر من 60 يوماً يستحقون أولوية التسديد.",
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate, branchId: "" },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.supplierId,
    columns: [
      { key: "supplierNameAr", header: "اسم المورد", format: "text", value: (row) => row.supplierNameAr, entity: { kind: "supplier", id: (row) => row.supplierId } },
      { key: "current", header: "جاري", format: "money", align: "end", total: true, value: (row) => row.current },
      { key: "d31to60", header: "31-60 يوم", format: "money", align: "end", total: true, value: (row) => row.d31to60 },
      { key: "d61to90", header: "61-90 يوم", format: "money", align: "end", total: true, value: (row) => row.d61to90 },
      { key: "d91to120", header: "91-120 يوم", format: "money", align: "end", total: true, value: (row) => row.d91to120 },
      { key: "over120", header: "أكثر من 120 يوم", format: "money", align: "end", total: true, value: (row) => row.over120 },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
    ],
    reconciliation: {
      labelAr: "إجمالي أعمار الديون مقابل حساب الموردين في دفتر الأستاذ",
      computeExactTotals: (rows, ctx, params) => ({
        report: Money.fromMajor(sumMoneyStrings(rows, (row) => [row.total])),
        reference: ctx.payablesControlBalance?.(params) ?? Money.zero(),
      }),
      available: (ctx) => ctx.payablesControlBalance !== undefined,
      toleranceMoney: 0.01,
      reconcilingItems: (ctx, params) => {
        const revalued = ctx.fxRevaluationOnControl?.(params) ?? Money.zero();
        return [{ key: "fxRevaluation", labelAr: "إعادة تقييم العملات المرحّلة على الحساب (مستبعدة من المطابقة)", amount: revalued.toString() }];
      },
    },
    chart: {
      labelColumn: "supplierNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "الموردون مرتبون حسب إجمالي المستحق لهم.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المستحق", format: "money", value: (rows) => sumMoneyStrings(rows, (r) => [r.total]) },
      { key: "over60", labelAr: "متأخر أكثر من 60 يوم", format: "money", value: (rows) => sumMoneyStrings(rows, (r) => [r.d61to90, r.d91to120, r.over120]), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "over60Percent", labelAr: "نسبة المتأخر", format: "percent", value: (rows) => percentOfMoneyStrings(sumMoneyStrings(rows, (r) => [r.d61to90, r.d91to120, r.over120]), sumMoneyStrings(rows, (r) => [r.total])) },
      { key: "supplierCount", labelAr: "عدد الموردين", format: "qty", value: (rows) => rows.length },
    ],
    run: (params, ctx) => {
      const supplierNames = new Map(ctx.suppliers.map((s) => [s.id, s.nameAr]));
      const supplierNamesEn = new Map(ctx.suppliers.map((s) => [s.id, s.nameEn ?? null]));
      return [...supplierAgingBalances(params, ctx)].map(([supplierId, agg]) => ({
        supplierId,
        supplierNameAr: supplierNames.get(supplierId) ?? supplierId,
        supplierNameEn: supplierNamesEn.get(supplierId) ?? null,
        current: agg.current.toString(),
        d31to60: agg.d31to60.toString(),
        d61to90: agg.d61to90.toString(),
        d91to120: agg.d91to120.toString(),
        over120: agg.over120.toString(),
        total: supplierAgingTotal(agg).toString(),
      }));
    },
  };
}

export type SupplierAgingBalance = AgingBucketTotals;

/** A supplier's whole ladder row as one figure. */
export function supplierAgingTotal(totals: AgingBucketTotals): Money {
  return Money.fromScaled(
    totals.current.scaled + totals.d31to60.scaled + totals.d61to90.scaled + totals.d91to120.scaled + totals.over120.scaled,
  );
}

/**
 * The ladder per supplier, in `Money`; the suppliers screen's payable reads it
 * too, so the screen and the report cannot disagree (the D195 rule, D201).
 */
export function supplierAgingBalances(
  params: AgingSuppliersParams,
  ctx: Omit<AgingSuppliersContext, "suppliers" | "payablesControlBalance" | "fxRevaluationOnControl">,
): Map<string, SupplierAgingBalance> {
  const byBucketTotals = new Map<string, AgingBucketTotals>();
  const debits = new Map<string, bigint>();
  const addDebit = (supplierId: string, scaled: bigint) => debits.set(supplierId, (debits.get(supplierId) ?? 0n) + scaled);
  for (const invoice of ctx.invoices) {
    if (invoice.status !== "confirmed") continue;
    if (invoice.date > params.asOfDate) continue;
    if (!matchesBranch(invoice.branchId, params.branchId)) continue;
    const allocatedNow = ctx.allocatedByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const later = ctx.settledAfterAsOfByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const allocated = Money.fromScaled(allocatedNow > later ? allocatedNow - later : 0n);
    const returned = ctx.returnsByInvoiceId?.get(invoice.id) ?? Money.zero();
    // The BASE total — what the posting credited 2100 with (D194).
    const outstanding = Money.fromScaled(purchaseInvoiceBaseTotal(invoice).scaled - allocated.scaled - returned.scaled);
    if (outstanding.scaled < 0n) addDebit(invoice.supplierId, -outstanding.scaled);
    if (outstanding.scaled <= 0n) continue;
    const dueDate = invoice.dueDate ?? invoice.date;
    const existing = byBucketTotals.get(invoice.supplierId) ?? emptyBucketTotals();
    const days = daysPastDue(dueDate, params.asOfDate);
    byBucketTotals.set(invoice.supplierId, addToBucket(existing, days, outstanding));
  }
  for (const [supplierId, debit] of ctx.unappliedDebitsBySupplierId ?? []) {
    if (debit.scaled > 0n) addDebit(supplierId, debit.scaled);
  }
  for (const item of ctx.openItems ?? []) {
    if (item.date > params.asOfDate) continue;
    if (!matchesBranch(item.branchId, params.branchId)) continue;
    if (item.amount.scaled < 0n) {
      addDebit(item.partyId, -item.amount.scaled);
      continue;
    }
    if (item.amount.scaled === 0n) continue;
    const existing = byBucketTotals.get(item.partyId) ?? emptyBucketTotals();
    byBucketTotals.set(item.partyId, addToBucket(existing, daysPastDue(item.dueDate ?? item.date, params.asOfDate), item.amount));
  }
  for (const [supplierId, scaled] of debits) {
    const existing = byBucketTotals.get(supplierId);
    if (!existing && params.branchId !== "") continue;
    byBucketTotals.set(supplierId, applyDebit(existing ?? emptyBucketTotals(), Money.fromScaled(scaled)));
  }
  return byBucketTotals;
}
