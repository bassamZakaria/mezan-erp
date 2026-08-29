/**
 * Exact scaled-integer arithmetic for the costing engine.
 *
 * Money and Qty are both held as signed bigints at scale 1e-6 (docs/archive/plan.md
 * §2.3). Two costing operations cross those types and therefore need an
 * EXPLICIT, documented rounding step — they are the only places the WAC engine
 * rounds, and both round HALF_UP on the magnitude (symmetric about zero) so a
 * reversing movement is the exact negative of the original:
 *
 *   - extend(qty, unitCost)       → a line/value amount   (LINE_EXTENSION)
 *   - unitCostOf(value, qty)      → a weighted-average unit cost
 *
 * Everything else (running on-hand qty, running total value) stays exact.
 * Because every step is integer-only, a fixed sequence of movements always
 * produces byte-identical results on SQLite and Postgres — the property the
 * golden fixtures lock down.
 */

import { Money, Qty } from "../money/index.js";

const SCALE = 1_000_000n; // 1e6

/** HALF_UP division of two bigints on their magnitudes (0.5 rounds away from zero). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("division by zero in costing arithmetic");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Line/extended value = qty × unitCost, rounded HALF_UP to scale 1e-6.
 *
 * Both operands are scale-1e6 integers, so the raw product is scale-1e12; we
 * divide by 1e6 (with rounding) to return to canonical Money scale.
 */
export function extend(qty: Qty, unitCost: Money): Money {
  const product = qty.scaled * unitCost.scaled; // scale 1e12
  return Money.fromScaled(divRoundHalfUp(product, SCALE));
}

/**
 * Weighted-average unit cost = totalValue / qty, rounded HALF_UP to scale
 * 1e-6. Returns Money.zero() for a zero quantity (an empty stock position has
 * no meaningful unit cost).
 */
export function unitCostOf(totalValue: Money, qty: Qty): Money {
  if (qty.scaled === 0n) return Money.zero();
  // value/qty in real units = (value_scaled/1e6)/(qty_scaled/1e6) = value_scaled/qty_scaled,
  // then re-scale to 1e6 → (value_scaled * 1e6)/qty_scaled.
  return Money.fromScaled(divRoundHalfUp(totalValue.scaled * SCALE, qty.scaled));
}
