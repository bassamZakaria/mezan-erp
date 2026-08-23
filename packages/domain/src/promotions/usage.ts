/**
 * Promotion usage aggregation (docs/catalog/01 §"العروض" — تقرير استخدام
 * العروض): how much discount each campaign actually granted, and how much of
 * that a sales return has since taken back.
 *
 * Every figure comes from what a CONFIRMED invoice recorded at confirm — the
 * value snapshot it stamped on itself — so a promotion edited, deactivated or
 * deleted afterwards cannot change a historical number. This module therefore
 * takes deliberately neutral input shapes rather than the sales-invoice /
 * sales-return aggregates: it reads only what those documents recorded, and
 * the promotions module stays free of a dependency on either of them.
 */

import { Money, Qty } from "../money/index.js";

const MINOR_STEP = 10_000n;

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function roundMinor(scaled: bigint): bigint {
  return divHalfUp(scaled, MINOR_STEP) * MINOR_STEP;
}

export interface PromotionUsageInvoiceLine {
  readonly itemId: string;
  readonly qty: Qty;
}

/** One line's share of a promotion's discount, exactly as the invoice recorded it. */
export interface PromotionUsageLineDiscount {
  readonly itemId: string;
  readonly amount: Money;
}

export interface PromotionUsageInvoice {
  readonly id: string;
  readonly date: string;
  /** Only live invoices count — a cancelled or reversed one granted nothing. */
  readonly live: boolean;
  readonly lines: readonly PromotionUsageInvoiceLine[];
  readonly promotion: {
    readonly promotionId: string;
    readonly code: string;
    readonly nameAr: string;
    readonly discountTotal: Money;
    readonly lineDiscounts: readonly PromotionUsageLineDiscount[];
  } | null;
}

export interface PromotionUsageReturnLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export interface PromotionUsageReturn {
  readonly sourceInvoiceId: string;
  readonly date: string;
  readonly live: boolean;
  readonly lines: readonly PromotionUsageReturnLine[];
}

export interface PromotionUsageCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface PromotionUsageRow {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly usageCount: number;
  readonly discountGranted: Money;
  readonly reversedDiscount: Money;
  readonly netDiscount: Money;
}

export interface AggregatePromotionUsageInput {
  readonly catalog: readonly PromotionUsageCatalogEntry[];
  readonly invoices: readonly PromotionUsageInvoice[];
  readonly returns: readonly PromotionUsageReturn[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

interface Accumulator {
  code: string;
  nameAr: string;
  usageCount: number;
  granted: bigint;
  reversed: bigint;
}

/**
 * Share of an item's recorded promotion discount that a return takes back,
 * pro-rata on the returned quantity. `buy_x_get_y` grants its discount in
 * whole groups rather than linearly, so this is a stated convention, not a
 * re-run of the engine: returning half the units reverses half the discount.
 */
function reversedForItem(lineDiscount: bigint, returnedQty: Qty, invoicedQty: Qty): bigint {
  if (lineDiscount <= 0n || invoicedQty.scaled <= 0n || returnedQty.scaled <= 0n) return 0n;
  if (returnedQty.scaled >= invoicedQty.scaled) return lineDiscount;
  return roundMinor(divHalfUp(lineDiscount * returnedQty.scaled, invoicedQty.scaled));
}

export function aggregatePromotionUsage(input: AggregatePromotionUsageInput): PromotionUsageRow[] {
  const inRange = (date: string): boolean => {
    if (input.dateFrom && date < input.dateFrom) return false;
    if (input.dateTo && date > input.dateTo) return false;
    return true;
  };

  const promotedInvoices = new Map<string, PromotionUsageInvoice>();
  const totals = new Map<string, Accumulator>();

  const ensure = (id: string, code: string, nameAr: string): Accumulator => {
    const existing = totals.get(id);
    if (existing) return existing;
    const fresh: Accumulator = { code, nameAr, usageCount: 0, granted: 0n, reversed: 0n };
    totals.set(id, fresh);
    return fresh;
  };

  for (const entry of input.catalog) {
    if (input.dateFrom && entry.endDate < input.dateFrom) continue;
    if (input.dateTo && entry.startDate > input.dateTo) continue;
    ensure(entry.id, entry.code, entry.nameAr);
  }

  for (const invoice of input.invoices) {
    if (!invoice.promotion || !invoice.live || !inRange(invoice.date)) continue;
    promotedInvoices.set(invoice.id, invoice);
    // The snapshot's own code/name win: a promotion renamed after the fact
    // must not relabel the invoices that ran under the old name.
    const acc = ensure(invoice.promotion.promotionId, invoice.promotion.code, invoice.promotion.nameAr);
    acc.code = invoice.promotion.code;
    acc.nameAr = invoice.promotion.nameAr;
    acc.usageCount += 1;
    acc.granted += invoice.promotion.discountTotal.scaled;
  }

  for (const ret of input.returns) {
    if (!ret.live || !inRange(ret.date)) continue;
    const invoice = promotedInvoices.get(ret.sourceInvoiceId);
    const promotion = invoice?.promotion;
    if (!invoice || !promotion) continue;

    const discountByItem = new Map<string, bigint>();
    for (const d of promotion.lineDiscounts) {
      discountByItem.set(d.itemId, (discountByItem.get(d.itemId) ?? 0n) + d.amount.scaled);
    }
    const invoicedByItem = new Map<string, bigint>();
    for (const l of invoice.lines) {
      invoicedByItem.set(l.itemId, (invoicedByItem.get(l.itemId) ?? 0n) + l.qty.scaled);
    }
    const returnedByItem = new Map<string, bigint>();
    for (const l of ret.lines) {
      returnedByItem.set(l.itemId, (returnedByItem.get(l.itemId) ?? 0n) + l.qty.scaled);
    }

    const acc = totals.get(promotion.promotionId);
    if (!acc) continue;
    for (const [itemId, returnedScaled] of returnedByItem) {
      acc.reversed += reversedForItem(
        discountByItem.get(itemId) ?? 0n,
        Qty.fromScaled(returnedScaled),
        Qty.fromScaled(invoicedByItem.get(itemId) ?? 0n),
      );
    }
  }

  return [...totals.entries()]
    .map(([id, acc]) => {
      const reversed = acc.reversed > acc.granted ? acc.granted : acc.reversed;
      return {
        id,
        code: acc.code,
        nameAr: acc.nameAr,
        usageCount: acc.usageCount,
        discountGranted: Money.fromScaled(acc.granted),
        reversedDiscount: Money.fromScaled(reversed),
        netDiscount: Money.fromScaled(acc.granted - reversed),
      };
    })
    .sort((a, b) => {
      const diff = b.netDiscount.scaled - a.netDiscount.scaled;
      if (diff !== 0n) return diff > 0n ? 1 : -1;
      return a.code.localeCompare(b.code);
    });
}
