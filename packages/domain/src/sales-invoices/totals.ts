/**
 * Sales-invoice totals — the pure, exact arithmetic behind every amount on an
 * invoice (docs/archive/catalog/01-sales.md §"بنود الفاتورة" / summary).
 *
 * All money is scaled-int `Money` at 1e-6; every cross-type / percentage step
 * rounds HALF_UP to the currency minor unit (2 dp) at a NAMED boundary
 * (LINE_EXTENSION, DISCOUNT_ALLOCATION, TAX_COMPUTATION — docs/archive/plan.md §2.3),
 * never a float. The invoice-level discount is spread across lines by the
 * largest-remainder method (`allocate`) so the parts reconcile to the total to
 * the cent, and per-line tax is computed on the post-discount taxable base.
 *
 * This is a pure function of the invoice — it drives the live totals in the UI,
 * the GL posting, and the tests identically.
 */

import { Money, Qty } from "../money/index.js";
import { allocateScaled } from "../money/rounding.js";
import { convertToBase } from "../exchange-rates/convert.js";
import type { AppliedPromotionLineDiscount, SalesInvoice, SalesInvoiceDiscount, SalesInvoiceLine } from "./sales-invoice.js";

/** Currency minor-unit precision invoice amounts round to (piastres/halalas). */
export const INVOICE_ROUNDING_DECIMALS = 2;

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

/**
 * The tax already inside a tax-inclusive amount: amount × rate / (100 + rate).
 * Subtracting it from the amount is what makes the invoice total come out at
 * exactly the price the customer was quoted — the whole point of inclusive
 * pricing — so this is deliberately NOT the same shape as `percentOf`.
 */
function taxWithin(amount: Money, percent: number): Money {
  if (percent === 0) return Money.zero();
  const pctScaled = BigInt(Math.round(percent * 1_000_000));
  const raw = divHalfUp(amount.scaled * pctScaled, 100_000_000n + pctScaled);
  return Money.fromScaled(roundMinor(raw));
}

export interface SalesInvoiceLineTotals {
  readonly lineId: string;
  /** qty × unitPrice, before any discount. */
  readonly gross: Money;
  /** Line-level discount amount. */
  readonly lineDiscount: Money;
  /** This line's share of the applied promotion's discount. */
  readonly promotionDiscount: Money;
  /** This line's share of the invoice-level discount. */
  readonly invoiceDiscount: Money;
  /**
   * The VAT base. Exclusive pricing: gross − every discount. Inclusive pricing:
   * that same net minus the tax already inside it.
   */
  readonly taxableBase: Money;
  readonly tax: Money;
  /** taxableBase + tax. */
  readonly total: Money;
}

export interface SalesInvoiceTotals {
  /**
   * Whether the prices these figures were built from already contained the tax
   * (settings §"الضريبة" → `taxCalculation`). When true, `grossTotal`,
   * `subtotal` and the discount totals are tax-INCLUSIVE and `grandTotal`
   * equals `subtotal − invoiceDiscountTotal`; a caller that prints
   * `subtotal + tax` would double-count.
   */
  readonly taxInclusive: boolean;
  readonly lines: readonly SalesInvoiceLineTotals[];
  /** Σ gross. */
  readonly grossTotal: Money;
  /** Σ line-level discounts. */
  readonly lineDiscountTotal: Money;
  /** Σ the applied promotion's per-line discounts, after capping each at its line's net. */
  readonly promotionDiscountTotal: Money;
  /** The invoice-level discount amount actually applied. */
  readonly invoiceDiscountTotal: Money;
  /** grossTotal − lineDiscountTotal − promotionDiscountTotal (المجموع الفرعي شامل خصومات البنود والعرض). */
  readonly subtotal: Money;
  /** Σ taxable bases (subtotal − invoiceDiscountTotal). */
  readonly taxableTotal: Money;
  readonly taxTotal: Money;
  /** taxableTotal + taxTotal — الإجمالي الكلي. */
  readonly grandTotal: Money;
}

/**
 * A line's own discount. A percentage runs through the same
 * `DISCOUNT_ALLOCATION` rounding as everything else; a fixed amount is
 * quantised to the minor unit and capped at the line's gross, so a line can
 * never be discounted into a negative net and the header discount's
 * largest-remainder split still has whole-piastre weights to work from.
 */
function resolveLineDiscount(line: SalesInvoiceLine, gross: Money): Money {
  if (line.discountType === "amount") {
    const amount = Money.fromScaled(roundMinor(line.discountAmount.scaled));
    if (amount.scaled <= 0n) return Money.zero();
    return amount.scaled > gross.scaled ? gross : amount;
  }
  return percentOf(gross, line.discountPercent);
}

function resolveInvoiceDiscount(discount: SalesInvoiceDiscount, subtotal: Money): Money {
  if (discount.type === "amount") {
    // Quantise to the minor unit (so the largest-remainder split reconciles) and
    // never discount more than the subtotal.
    const amount = Money.fromScaled(roundMinor(discount.amount.scaled));
    return amount.scaled > subtotal.scaled ? subtotal : amount;
  }
  return percentOf(subtotal, discount.percent);
}

/**
 * Compute every amount on an invoice from its lines + header discount. Tax is
 * forced to zero on every line when the customer is tax-exempt.
 */
export function computeInvoiceTotals(
  lines: readonly SalesInvoiceLine[],
  discount: SalesInvoiceDiscount,
  options: {
    readonly taxExempt?: boolean;
    /** The applied promotion's per-line split; each amount is capped at its line's post-line-discount net. */
    readonly promotionLineDiscounts?: readonly AppliedPromotionLineDiscount[];
    /** Unit prices already contain the tax (settings §"الضريبة" → `taxCalculation`). */
    readonly taxInclusive?: boolean;
  } = {},
): SalesInvoiceTotals {
  const taxExempt = options.taxExempt ?? false;
  const taxInclusive = options.taxInclusive ?? false;
  const promotionByLineId = new Map<string, bigint>();
  for (const d of options.promotionLineDiscounts ?? []) {
    promotionByLineId.set(d.lineId, (promotionByLineId.get(d.lineId) ?? 0n) + d.amount.scaled);
  }

  const gross = lines.map((l) => extendLine(l.qty, l.unitPrice));
  const lineDiscount = lines.map((l, i) => resolveLineDiscount(l, gross[i] as Money));
  const afterLineDiscount = lines.map((l, i) => (gross[i] as Money).add((lineDiscount[i] as Money).negate()));
  const promotionDiscount = lines.map((line, i) => {
    const requested = roundMinor(promotionByLineId.get(line.lineId) ?? 0n);
    const available = (afterLineDiscount[i] as Money).scaled;
    if (requested <= 0n) return Money.zero();
    return Money.fromScaled(requested > available ? (available > 0n ? available : 0n) : requested);
  });
  const net = afterLineDiscount.map((n, i) => n.add((promotionDiscount[i] as Money).negate()));

  const subtotal = Money.sum(net);
  const invoiceDiscountTotal = resolveInvoiceDiscount(discount, subtotal);

  // Spread the invoice discount across lines by their net weight (largest
  // remainder), in whole MINOR units so per-line amounts stay at 2 dp and the
  // parts reconcile exactly to the (2 dp) invoice discount total.
  const weights = net.map((n) => (n.scaled < 0n ? 0n : n.scaled));
  const hasWeight = weights.some((w) => w > 0n);
  const allocatedDiscount =
    invoiceDiscountTotal.scaled === 0n || !hasWeight
      ? net.map(() => Money.zero())
      : allocateScaled(invoiceDiscountTotal.scaled / MINOR_STEP, weights).map((minor) =>
          Money.fromScaled(minor * MINOR_STEP),
        );

  const lineTotals: SalesInvoiceLineTotals[] = lines.map((line, i) => {
    const lineNet = (net[i] as Money).add((allocatedDiscount[i] as Money).negate());
    const tax = taxExempt
      ? Money.zero()
      : taxInclusive
        ? taxWithin(lineNet, line.taxRatePercent)
        : percentOf(lineNet, line.taxRatePercent);
    const taxableBase = taxInclusive ? lineNet.add(tax.negate()) : lineNet;
    return {
      lineId: line.lineId,
      gross: gross[i] as Money,
      lineDiscount: lineDiscount[i] as Money,
      promotionDiscount: promotionDiscount[i] as Money,
      invoiceDiscount: allocatedDiscount[i] as Money,
      taxableBase,
      tax,
      total: taxableBase.add(tax),
    };
  });

  const taxableTotal = Money.sum(lineTotals.map((l) => l.taxableBase));
  const taxTotal = Money.sum(lineTotals.map((l) => l.tax));

  return {
    taxInclusive,
    lines: lineTotals,
    grossTotal: Money.sum(gross),
    lineDiscountTotal: Money.sum(lineDiscount),
    promotionDiscountTotal: Money.sum(promotionDiscount),
    invoiceDiscountTotal,
    subtotal,
    taxableTotal,
    taxTotal,
    grandTotal: taxableTotal.add(taxTotal),
  };
}

/**
 * Totals for a whole invoice — the single entry point everything reading a
 * persisted invoice should use, so the applied promotion's discount is never
 * accidentally left out of a figure the GL, AR or a report reconciles against.
 */
export function salesInvoiceTotals(invoice: SalesInvoice): SalesInvoiceTotals {
  return computeInvoiceTotals(invoice.lines, invoice.discount, {
    taxExempt: invoice.customerTaxExempt,
    promotionLineDiscounts: invoice.appliedPromotion?.lineDiscounts,
    taxInclusive: invoice.taxInclusive,
  });
}

/**
 * The invoice's total in the BASE currency — what GL 1105 was debited with.
 * `grandTotal` is the document's own figure, in the currency it was raised in;
 * for a foreign invoice the two differ by the rate it confirmed at (D24), and
 * a sub-ledger that compares the wrong one to the control account reads adrift
 * by the whole exchange rate.
 */
export function salesInvoiceBaseGrandTotal(totals: SalesInvoiceTotals, fxRate?: string | null): Money {
  return salesInvoiceBaseTotals(totals, fxRate).grandTotal;
}

export interface SalesInvoiceBaseTotals {
  readonly taxableTotal: Money;
  readonly taxTotal: Money;
  readonly grandTotal: Money;
}

/**
 * The invoice's taxable base, tax and grand total in the BASE currency.
 * Converts each line's taxable base and tax and adds — exactly the parts
 * `buildSalesInvoiceGlPosting` credits — so every figure agrees with the
 * ledger to the last unit rather than to within a rounding step.
 */
export function salesInvoiceBaseTotals(totals: SalesInvoiceTotals, fxRate?: string | null): SalesInvoiceBaseTotals {
  if (!fxRate) return { taxableTotal: totals.taxableTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal };
  let taxableTotal = Money.zero();
  let taxTotal = Money.zero();
  for (const line of totals.lines) {
    taxableTotal = taxableTotal.add(convertToBase(line.taxableBase, fxRate));
    taxTotal = taxTotal.add(convertToBase(line.tax, fxRate));
  }
  return { taxableTotal, taxTotal, grandTotal: taxableTotal.add(taxTotal) };
}
