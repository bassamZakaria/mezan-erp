import { Money, Qty } from "../money/index.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import { withinDateRange } from "./period-bucket.js";

/**
 * Shared per-item revenue aggregation behind المبيعات حسب الصنف and أفضل
 * المنتجات (docs/catalog/08-reports.md) — both are the same underlying
 * "revenue by item" rollup, one paginated/sorted-by-revenue, the other
 * ranked/limited. Revenue per line is its post-discount taxable base (or +tax
 * when `taxMode: "inc"`), matching `computeInvoiceTotals`'s per-line split.
 */

export interface ItemSalesAggregate {
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: number;
  readonly revenue: number;
}

export function aggregateItemSales(
  invoices: readonly SalesInvoice[],
  dateFrom: string | undefined,
  dateTo: string | undefined,
  taxMode: "inc" | "exc" = "exc",
): ItemSalesAggregate[] {
  const byItem = new Map<string, { itemNameAr: string; qty: Qty; revenue: Money }>();
  for (const invoice of invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (!withinDateRange(invoice.date, dateFrom, dateTo)) continue;
    const totals = computeInvoiceTotals(invoice.lines, invoice.discount, { taxExempt: invoice.customerTaxExempt });
    invoice.lines.forEach((line, i) => {
      const lineTotals = totals.lines[i];
      if (!lineTotals) return;
      const revenue = taxMode === "inc" ? lineTotals.total : lineTotals.taxableBase;
      const existing = byItem.get(line.itemId) ?? { itemNameAr: line.itemNameAr, qty: Qty.zero(), revenue: Money.zero() };
      byItem.set(line.itemId, {
        itemNameAr: line.itemNameAr,
        qty: existing.qty.add(line.qty),
        revenue: existing.revenue.add(revenue),
      });
    });
  }
  return [...byItem.entries()].map(([itemId, agg]) => ({
    itemId,
    itemNameAr: agg.itemNameAr,
    qty: Number(agg.qty.toString()),
    revenue: Number(agg.revenue.toString()),
  }));
}
