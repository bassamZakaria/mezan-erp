/**
 * Sales-quote totals — the pure, exact arithmetic behind every amount on a
 * quote (docs/catalog/01-sales.md §"عروض الأسعار").
 *
 * Byte-identical in behavior to sales-invoices/totals.ts, retyped for the
 * simpler `SalesQuoteLine` shape: no `isStock` / GL-account fields to carry.
 * This is deliberate — a quote that gets accepted and converted to an invoice
 * must land on EXACTLY the totals the customer was quoted, so the money/tax/
 * discount math here must never drift from the invoice module's.
 *
 * All money is scaled-int `Money` at 1e-6; every cross-type / percentage step
 * rounds HALF_UP to the currency minor unit (2 dp) at a NAMED boundary
 * (LINE_EXTENSION, DISCOUNT_ALLOCATION, TAX_COMPUTATION — docs/plan.md §2.3),
 * never a float. The quote-level discount is spread across lines by the
 * largest-remainder method (`allocateScaled`) so the parts reconcile to the
 * total to the cent, and per-line tax is computed on the post-discount
 * taxable base.
 *
 * This is a pure function of the quote — it drives the live totals in the UI
 * and the tests identically.
 */

import { Money, Qty } from "../money/index.js";
import { allocateScaled } from "../money/rounding.js";
import type { SalesQuoteDiscount, SalesQuoteLine } from "./sales-quote.js";

/** Currency minor-unit precision quote amounts round to (piastres/halalas). */
export const QUOTE_ROUNDING_DECIMALS = 2;

const SCALE = 1_000_000n; // Money/Qty scale 1e-6
const MINOR_STEP = 10_000n; // 1e-6 → 1e-2 quantisation step (drop 4 trailing scaled digits)

/** HALF_UP division on magnitudes (0.5 rounds away from zero) — mirrors wac-math. */
function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Quantise a scaled bigint to 2 decimals, HALF_UP, keeping the 1e-6 scale. */
function roundMinor(scaled: bigint): bigint {
  return divHalfUp(scaled, MINOR_STEP) * MINOR_STEP;
}

/** Line extension qty × unitPrice, rounded to the minor unit (LINE_EXTENSION). */
function extendLine(qty: Qty, unitPrice: Money): Money {
  const product = qty.scaled * unitPrice.scaled; // scale 1e12
  return Money.fromScaled(roundMinor(divHalfUp(product, SCALE)));
}

/** amount × percent / 100, rounded to the minor unit. `percent` may be fractional. */
function percentOf(amount: Money, percent: number): Money {
  if (percent === 0) return Money.zero();
  const pctScaled = BigInt(Math.round(percent * 1_000_000)); // percent at 1e-6
  // amount.scaled * (pctScaled/1e6) / 100 = amount.scaled * pctScaled / 1e8
  const raw = divHalfUp(amount.scaled * pctScaled, 100_000_000n);
  return Money.fromScaled(roundMinor(raw));
}

export interface SalesQuoteLineTotals {
  readonly lineId: string;
  /** qty × unitPrice, before any discount. */
  readonly gross: Money;
  /** Line-level discount amount. */
  readonly lineDiscount: Money;
  /** This line's share of the quote-level discount. */
  readonly invoiceDiscount: Money;
  /** gross − lineDiscount − invoiceDiscount — the VAT base. */
  readonly taxableBase: Money;
  readonly tax: Money;
  /** taxableBase + tax. */
  readonly total: Money;
}

export interface SalesQuoteTotals {
  readonly lines: readonly SalesQuoteLineTotals[];
  /** Σ gross. */
  readonly grossTotal: Money;
  /** Σ line-level discounts. */
  readonly lineDiscountTotal: Money;
  /** The quote-level discount amount actually applied. */
  readonly invoiceDiscountTotal: Money;
  /** grossTotal − lineDiscountTotal (المجموع الفرعي شامل خصومات البنود). */
  readonly subtotal: Money;
  /** Σ taxable bases (subtotal − invoiceDiscountTotal). */
  readonly taxableTotal: Money;
  readonly taxTotal: Money;
  /** taxableTotal + taxTotal — الإجمالي الكلي. */
  readonly grandTotal: Money;
}

function resolveQuoteDiscount(discount: SalesQuoteDiscount, subtotal: Money): Money {
  if (discount.type === "amount") {
    // Quantise to the minor unit (so the largest-remainder split reconciles) and
    // never discount more than the subtotal.
    const amount = Money.fromScaled(roundMinor(discount.amount.scaled));
    return amount.scaled > subtotal.scaled ? subtotal : amount;
  }
  return percentOf(subtotal, discount.percent);
}

/**
 * Compute every amount on a quote from its lines + header discount. Tax is
 * forced to zero on every line when the customer is tax-exempt.
 */
export function computeQuoteTotals(
  lines: readonly SalesQuoteLine[],
  discount: SalesQuoteDiscount,
  options: { readonly taxExempt?: boolean } = {},
): SalesQuoteTotals {
  const taxExempt = options.taxExempt ?? false;

  const gross = lines.map((l) => extendLine(l.qty, l.unitPrice));
  const lineDiscount = lines.map((l, i) => percentOf(gross[i] as Money, l.discountPercent));
  const net = lines.map((l, i) => (gross[i] as Money).add((lineDiscount[i] as Money).negate()));

  const subtotal = Money.sum(net);
  const invoiceDiscountTotal = resolveQuoteDiscount(discount, subtotal);

  // Spread the quote discount across lines by their net weight (largest
  // remainder), in whole MINOR units so per-line amounts stay at 2 dp and the
  // parts reconcile exactly to the (2 dp) quote discount total.
  const weights = net.map((n) => (n.scaled < 0n ? 0n : n.scaled));
  const hasWeight = weights.some((w) => w > 0n);
  const allocatedDiscount =
    invoiceDiscountTotal.scaled === 0n || !hasWeight
      ? net.map(() => Money.zero())
      : allocateScaled(invoiceDiscountTotal.scaled / MINOR_STEP, weights).map((minor) =>
          Money.fromScaled(minor * MINOR_STEP),
        );

  const lineTotals: SalesQuoteLineTotals[] = lines.map((line, i) => {
    const taxableBase = (net[i] as Money).add((allocatedDiscount[i] as Money).negate());
    const tax = taxExempt ? Money.zero() : percentOf(taxableBase, line.taxRatePercent);
    return {
      lineId: line.lineId,
      gross: gross[i] as Money,
      lineDiscount: lineDiscount[i] as Money,
      invoiceDiscount: allocatedDiscount[i] as Money,
      taxableBase,
      tax,
      total: taxableBase.add(tax),
    };
  });

  const taxableTotal = Money.sum(lineTotals.map((l) => l.taxableBase));
  const taxTotal = Money.sum(lineTotals.map((l) => l.tax));

  return {
    lines: lineTotals,
    grossTotal: Money.sum(gross),
    lineDiscountTotal: Money.sum(lineDiscount),
    invoiceDiscountTotal,
    subtotal,
    taxableTotal,
    taxTotal,
    grandTotal: taxableTotal.add(taxTotal),
  };
}
