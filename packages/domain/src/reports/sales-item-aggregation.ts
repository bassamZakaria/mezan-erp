import { Money, Qty } from "../money/index.js";
import { salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import { withinDateRange } from "./period-bucket.js";
import { convertToBase } from "../exchange-rates/convert.js";

/**
 * Shared per-item revenue aggregation behind المبيعات حسب الصنف and أفضل
 * المنتجات (docs/archive/catalog/08-reports.md) — both are the same underlying
 * "revenue by item" rollup, one paginated/sorted-by-revenue, the other
 * ranked/limited. Revenue per line is its post-discount taxable base (or +tax
 * when `taxMode: "inc"`), matching `computeInvoiceTotals`'s per-line split.
 *
 * A line whose `revenueAccountId` is a NON-revenue account is a BILLING, not a
 * sale: the contracting certificate invoices credit مستخلصات تحت التنفيذ (a
 * liability) and the retention release credits the retention receivable, so
 * neither adds a millieme of revenue to the ledger. Counting them here would
 * make these reports claim revenue the GL never recognised — they are reported
 * by the certificate screens instead. `isContractBilling` is how the caller,
 * which is the only layer holding the chart of accounts, says which is which;
 * it answers true only for an account the chart KNOWS is not revenue, so an
 * account the chart has never heard of is still counted as the sale it looks
 * like rather than silently vanishing from the report.
 */

export interface ItemSalesAggregate {
  readonly itemId: string;
  readonly itemNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly itemNameEn: string | null;
  readonly qty: number;
  readonly revenue: number;
}

export function aggregateItemSales(
  invoices: readonly SalesInvoice[],
  dateFrom: string | undefined,
  dateTo: string | undefined,
  taxMode: "inc" | "exc" = "exc",
  isContractBilling?: (accountId: string) => boolean,
): ItemSalesAggregate[] {
  const byItem = new Map<string, { itemNameAr: string; qty: Qty; revenue: Money }>();
  for (const invoice of invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (!withinDateRange(invoice.date, dateFrom, dateTo)) continue;
    const totals = salesInvoiceTotals(invoice);
    invoice.lines.forEach((line, i) => {
      const lineTotals = totals.lines[i];
      if (!lineTotals) return;
      if (isContractBilling?.(line.revenueAccountId)) return;
      const stated = taxMode === "inc" ? lineTotals.total : lineTotals.taxableBase;
      // In BASE currency, per line — what the posting credited revenue with
      // (D194's twin); a foreign line's own figure is not an EGP amount.
      const revenue = invoice.fxRate ? convertToBase(stated, invoice.fxRate) : stated;
      const existing = byItem.get(line.itemId) ?? { itemNameAr: line.itemNameAr, qty: Qty.zero(), revenue: Money.zero() };
      byItem.set(line.itemId, {
        itemNameAr: line.itemNameAr,
        qty: existing.qty.add(line.baseQty),
        revenue: existing.revenue.add(revenue),
      });
    });
  }
  // The English name is left null here on purpose: this aggregates INVOICE
  // LINES, and a line stores only the Arabic name it was written with. The
  // report that calls this fills it from the item catalogue, which is the only
  // place an English name lives (D57).
  return [...byItem.entries()].map(([itemId, agg]) => ({
    itemId,
    itemNameAr: agg.itemNameAr,
    itemNameEn: null,
    qty: Number(agg.qty.toString()),
    revenue: Number(agg.revenue.toString()),
  }));
}

/**
 * The revenue accounts the SALE lines of these invoices actually credited.
 *
 * This is the account set the GL side of the sales-by-item reconciliation must
 * sum, so that both halves read one fact instead of two: the report counts a
 * line, the ledger counts what that line credited. A hardcoded control account
 * was the same fact only while nothing but a sale could reach a sales invoice.
 */
export function creditedRevenueAccountIds(
  invoices: readonly SalesInvoice[],
  dateFrom: string | undefined,
  dateTo: string | undefined,
  isContractBilling?: (accountId: string) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const invoice of invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (!withinDateRange(invoice.date, dateFrom, dateTo)) continue;
    for (const line of invoice.lines) {
      if (isContractBilling?.(line.revenueAccountId)) continue;
      ids.add(line.revenueAccountId);
    }
  }
  return [...ids];
}
