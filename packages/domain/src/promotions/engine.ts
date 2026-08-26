/**
 * Promotion discount engine — pure arithmetic (no I/O) deciding which
 * promotion applies to a cart and computing its discount. Mirrors the
 * scaled-int / HALF_UP-at-the-minor-unit discipline in
 * sales-invoices/totals.ts (this is the DISCOUNT_ALLOCATION boundary, see
 * money/rounding.ts). Only ONE promotion applies per checkout — the catalog
 * documents a single "الأولوية" priority field with no stacking UI.
 */

import { Money, Qty } from "../money/index.js";
import { allocateScaled } from "../money/rounding.js";
import type { Promotion, PromotionBundleComponent } from "./promotion.js";

const SCALE = 1_000_000n; // Money/Qty scale 1e-6
const MINOR_STEP = 10_000n; // 1e-6 → 1e-2 quantisation step

/** HALF_UP division on magnitudes — mirrors sales-invoices/totals.ts's divHalfUp. */
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

/**
 * qty × unitPrice, rounded to the minor unit — mirrors totals.ts's
 * `extendLine`. Exported so callers building a `PromotionLineInput` (e.g. the
 * `/evaluate` API route) compute `lineTotal` with the exact same rounding.
 */
export function extendLine(qty: Qty, unitPrice: Money): Money {
  const product = qty.scaled * unitPrice.scaled; // scale 1e12
  return Money.fromScaled(roundMinor(divHalfUp(product, SCALE)));
}

/** amount × percent / 100, rounded to the minor unit — mirrors totals.ts's percentOf. */
function percentOf(amount: Money, percent: number): Money {
  if (percent === 0) return Money.zero();
  const pctScaled = BigInt(Math.round(percent * 1_000_000)); // percent at 1e-6
  const raw = divHalfUp(amount.scaled * pctScaled, 100_000_000n);
  return Money.fromScaled(roundMinor(raw));
}

export interface PromotionLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly categoryId: string | null;
  readonly qty: Qty;
  readonly unitPrice: Money;
  /** qty * unitPrice, pre-discount (computed the same way sales-invoices/totals.ts's `extendLine` does). */
  readonly lineTotal: Money;
}

export interface EvaluatePromotionsInput {
  readonly promotions: readonly Promotion[];
  readonly lines: readonly PromotionLineInput[];
  readonly subtotal: Money; // sum of lineTotal
  readonly date: string; // ISO YYYY-MM-DD
  readonly dayOfWeek: number; // 0..6
  readonly hour: number; // 0..23
  readonly couponCode?: string | null;
}

export interface AppliedLineDiscount {
  readonly lineId: string;
  readonly amount: Money;
}
export interface FreeGoodsLine {
  readonly itemId: string;
  readonly qty: Qty;
}
export interface PromotionApplicationResult {
  readonly promotion: Promotion;
  readonly discountTotal: Money;
  readonly lineDiscounts: readonly AppliedLineDiscount[];
  readonly freeGoods: readonly FreeGoodsLine[]; // non-empty only for buy_x_get_y
}

function isInScope(promotion: Promotion, line: PromotionLineInput): boolean {
  const { scope } = promotion;
  if (scope.type === "all") return true;
  if (scope.type === "item") return scope.ids.includes(line.itemId);
  return line.categoryId !== null && scope.ids.includes(line.categoryId);
}

function scopedLines(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionLineInput[] {
  return lines.filter((l) => isInScope(promotion, l));
}

function matchesCoupon(promotion: Promotion, couponCode: string | null | undefined): boolean {
  if (!promotion.requiresCoupon) return true;
  if (!couponCode) return false;
  return couponCode.trim().toLowerCase() === promotion.code.trim().toLowerCase();
}

function withinDateWindow(promotion: Promotion, date: string): boolean {
  return date >= promotion.startDate && date <= promotion.endDate;
}

function withinDayHourWindow(promotion: Promotion, dayOfWeek: number, hour: number): boolean {
  const restriction = promotion.dayHourRestriction;
  if (!restriction) return true;
  if (!restriction.days.includes(dayOfWeek)) return false;
  const { startHour, endHour } = restriction;
  if (startHour <= endHour) return hour >= startHour && hour <= endHour;
  return hour >= startHour || hour <= endHour; // overnight window, e.g. 22 -> 3
}

function meetsMinInvoiceValue(promotion: Promotion, subtotal: Money): boolean {
  if (!promotion.minInvoiceValue) return true;
  return subtotal.scaled >= promotion.minInvoiceValue.scaled;
}

/**
 * "حد أدنى للكمية" — measured across the lines IN SCOPE, so a promotion scoped
 * to one category is not let through by quantity bought outside it.
 */
function meetsMinQty(promotion: Promotion, lines: readonly PromotionLineInput[]): boolean {
  if (!promotion.minQty) return true;
  const scopedQty = scopedLines(promotion, lines).reduce((sum, l) => sum + l.qty.scaled, 0n);
  return scopedQty >= promotion.minQty.scaled;
}

function findFirstLineForItem(lines: readonly PromotionLineInput[], itemId: string): PromotionLineInput | undefined {
  return lines.find((l) => l.itemId === itemId);
}

/**
 * Max whole number of complete bundles purchasable, 0 when any component is
 * missing or short. Qty is compared in major-unit (decimal string) terms —
 * bundle components are whole-unit quantities in practice.
 */
function maxBundleCount(promotion: Promotion, lines: readonly PromotionLineInput[]): number {
  if (promotion.bundleComponents.length === 0) return 0;
  let count = Number.POSITIVE_INFINITY;
  for (const component of promotion.bundleComponents) {
    const line = findFirstLineForItem(lines, component.itemId);
    if (!line) return 0;
    const componentQtyMajor = Number(component.qty.toString());
    if (componentQtyMajor <= 0) return 0;
    const lineQtyMajor = Number(line.qty.toString());
    const possible = Math.floor(lineQtyMajor / componentQtyMajor);
    if (possible < count) count = possible;
  }
  return Number.isFinite(count) ? count : 0;
}

function isBundleEligible(promotion: Promotion, lines: readonly PromotionLineInput[]): boolean {
  return maxBundleCount(promotion, lines) >= 1;
}

/**
 * Active, in date range, day/hour-window match, min-invoice-value met,
 * min-quantity met across the lines in scope, and (coupon required =>
 * couponCode matches this promo's code). Bundle-type promotions additionally
 * require at least one complete bundle purchasable; every other type requires
 * at least one line in scope.
 */
export function findEligiblePromotions(input: EvaluatePromotionsInput): readonly Promotion[] {
  return input.promotions.filter((p) => {
    if (!p.active) return false;
    if (!withinDateWindow(p, input.date)) return false;
    if (!withinDayHourWindow(p, input.dayOfWeek, input.hour)) return false;
    if (!matchesCoupon(p, input.couponCode)) return false;
    if (!meetsMinInvoiceValue(p, input.subtotal)) return false;
    if (!meetsMinQty(p, input.lines)) return false;
    if (p.type === "bundle") return isBundleEligible(p, input.lines);
    return scopedLines(p, input.lines).length > 0;
  });
}

/** Spread `discountTotal` (already minor-quantised) across `scoped` lines proportional to `lineTotal`, largest-remainder. */
function distributeByLineTotal(discountTotal: Money, scoped: readonly PromotionLineInput[]): AppliedLineDiscount[] {
  if (scoped.length === 0 || discountTotal.scaled === 0n) {
    return scoped.map((l) => ({ lineId: l.lineId, amount: Money.zero() }));
  }
  const weights = scoped.map((l) => (l.lineTotal.scaled < 0n ? 0n : l.lineTotal.scaled));
  if (!weights.some((w) => w > 0n)) {
    return scoped.map((l) => ({ lineId: l.lineId, amount: Money.zero() }));
  }
  const parts = allocateScaled(discountTotal.scaled / MINOR_STEP, weights);
  return scoped.map((l, i) => ({ lineId: l.lineId, amount: Money.fromScaled((parts[i] as bigint) * MINOR_STEP) }));
}

function computePercentage(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  const scoped = scopedLines(promotion, lines);
  const scopedSubtotal = Money.sum(scoped.map((l) => l.lineTotal));
  const discountTotal = percentOf(scopedSubtotal, promotion.percentValue ?? 0);
  return { promotion, discountTotal, lineDiscounts: distributeByLineTotal(discountTotal, scoped), freeGoods: [] };
}

function computeFixedAmount(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  const scoped = scopedLines(promotion, lines);
  const scopedSubtotal = Money.sum(scoped.map((l) => l.lineTotal));
  const amount = Money.fromScaled(roundMinor(promotion.amountValue?.scaled ?? 0n));
  const discountTotal = amount.scaled > scopedSubtotal.scaled ? scopedSubtotal : amount;
  return { promotion, discountTotal, lineDiscounts: distributeByLineTotal(discountTotal, scoped), freeGoods: [] };
}

function computeSpecialPrice(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  const scoped = scopedLines(promotion, lines);
  const specialUnitPrice = promotion.amountValue ?? Money.zero();
  const lineDiscounts: AppliedLineDiscount[] = [];
  let discountTotal = Money.zero();
  for (const line of scoped) {
    const specialLineTotal = extendLine(line.qty, specialUnitPrice);
    const diff = line.lineTotal.scaled - specialLineTotal.scaled;
    const perLineDiscount = diff > 0n ? Money.fromScaled(diff) : Money.zero();
    lineDiscounts.push({ lineId: line.lineId, amount: perLineDiscount });
    discountTotal = discountTotal.add(perLineDiscount);
  }
  return { promotion, discountTotal, lineDiscounts, freeGoods: [] };
}

/**
 * Whole-unit simplification: qty is assumed to be a whole number of units for
 * this promotion type (no fractional buy-X-get-Y is in scope), so `qty`'s
 * decimal-string major value is floored to an integer before grouping.
 */
function computeBuyXGetY(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  const scoped = scopedLines(promotion, lines);
  const buyQty = promotion.buyQty ?? 0;
  const getQty = promotion.getQty ?? 0;
  const groupSize = buyQty + getQty;

  const lineDiscounts: AppliedLineDiscount[] = [];
  const freeGoods: FreeGoodsLine[] = [];
  let discountTotal = Money.zero();

  if (groupSize <= 0) {
    return { promotion, discountTotal, lineDiscounts: scoped.map((l) => ({ lineId: l.lineId, amount: Money.zero() })), freeGoods: [] };
  }

  for (const line of scoped) {
    const wholeUnits = Math.floor(Number(line.qty.toString()));
    const groups = Math.floor(wholeUnits / groupSize);
    const freeUnits = groups * getQty;
    if (freeUnits <= 0) {
      lineDiscounts.push({ lineId: line.lineId, amount: Money.zero() });
      continue;
    }
    const freeQty = Qty.fromMajor(String(freeUnits));
    const perLineDiscount = extendLine(freeQty, line.unitPrice);
    lineDiscounts.push({ lineId: line.lineId, amount: perLineDiscount });
    discountTotal = discountTotal.add(perLineDiscount);
    freeGoods.push({ itemId: line.itemId, qty: freeQty });
  }

  return { promotion, discountTotal, lineDiscounts, freeGoods };
}

function computeBundle(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  const bundleCount = maxBundleCount(promotion, lines);
  if (bundleCount < 1) {
    return { promotion, discountTotal: Money.zero(), lineDiscounts: [], freeGoods: [] };
  }

  const componentLines: { component: PromotionBundleComponent; line: PromotionLineInput; regularCost: Money }[] = [];
  let regularCostTotal = Money.zero();
  for (const component of promotion.bundleComponents) {
    const line = findFirstLineForItem(lines, component.itemId);
    if (!line) continue; // maxBundleCount already guarantees every component has a matching line
    const componentQtyMajor = Number(component.qty.toString());
    const purchasedQty = Qty.fromMajor(String(componentQtyMajor * bundleCount));
    const cost = extendLine(purchasedQty, line.unitPrice);
    componentLines.push({ component, line, regularCost: cost });
    regularCostTotal = regularCostTotal.add(cost);
  }

  const bundlePrice = promotion.amountValue ?? Money.zero();
  const totalBundlePrice = extendLine(Qty.fromMajor(String(bundleCount)), bundlePrice);
  const rawDiscount = regularCostTotal.scaled - totalBundlePrice.scaled;
  const discountTotal = rawDiscount > 0n ? Money.fromScaled(rawDiscount) : Money.zero();

  const weights = componentLines.map((c) => (c.regularCost.scaled < 0n ? 0n : c.regularCost.scaled));
  const lineDiscounts: AppliedLineDiscount[] =
    discountTotal.scaled === 0n || !weights.some((w) => w > 0n)
      ? componentLines.map((c) => ({ lineId: c.line.lineId, amount: Money.zero() }))
      : allocateScaled(discountTotal.scaled / MINOR_STEP, weights).map((minor, i) => ({
          lineId: (componentLines[i] as (typeof componentLines)[number]).line.lineId,
          amount: Money.fromScaled(minor * MINOR_STEP),
        }));

  return { promotion, discountTotal, lineDiscounts, freeGoods: [] };
}

/**
 * "الحد الأقصى للخصم" — trims a computed application down to the campaign's
 * cap and re-spreads the capped total over the SAME lines by largest
 * remainder, so the per-line parts still sum exactly to what the document
 * gives away. `buy_x_get_y` never reaches here: its discount is free units,
 * and the validator refuses a cap on that type.
 */
function applyCap(result: PromotionApplicationResult): PromotionApplicationResult {
  const cap = result.promotion.maxDiscountAmount;
  if (!cap || result.discountTotal.scaled <= cap.scaled) return result;
  const capped = Money.fromScaled(roundMinor(cap.scaled));
  const weights = result.lineDiscounts.map((d) => (d.amount.scaled < 0n ? 0n : d.amount.scaled));
  if (!weights.some((w) => w > 0n)) {
    return { ...result, discountTotal: Money.zero() };
  }
  const parts = allocateScaled(capped.scaled / MINOR_STEP, weights);
  const lineDiscounts = result.lineDiscounts.map((d, i) => ({
    lineId: d.lineId,
    amount: Money.fromScaled((parts[i] as bigint) * MINOR_STEP),
  }));
  return { ...result, discountTotal: Money.sum(lineDiscounts.map((d) => d.amount)), lineDiscounts };
}

function computeApplication(promotion: Promotion, lines: readonly PromotionLineInput[]): PromotionApplicationResult {
  switch (promotion.type) {
    case "percentage":
      return computePercentage(promotion, lines);
    case "fixed_amount":
      return computeFixedAmount(promotion, lines);
    case "special_price":
      return computeSpecialPrice(promotion, lines);
    case "buy_x_get_y":
      return computeBuyXGetY(promotion, lines);
    case "bundle":
      return computeBundle(promotion, lines);
    default: {
      const exhaustive: never = promotion.type;
      throw new RangeError(`Unknown promotion type: ${String(exhaustive)}`);
    }
  }
}

/** Highest-priority eligible promotion (ties broken by earliest `createdAt`), with its computed discount — or null if none eligible. */
export function evaluateBestPromotion(input: EvaluatePromotionsInput): PromotionApplicationResult | null {
  const eligible = findEligiblePromotions(input);
  if (eligible.length === 0) return null;

  const best = [...eligible].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return 0;
  })[0] as Promotion;

  return applyCap(computeApplication(best, input.lines));
}
