/**
 * Rounding policy and allocation.
 *
 * docs/plan.md §2.3: domain arithmetic uses exact scaled integers and applies
 * **explicit rounding at documented boundaries only**. Those boundaries are:
 *
 *   - LINE_EXTENSION     — qty × unit price → a line amount
 *   - TAX_COMPUTATION    — taxable base × rate → a tax amount
 *   - DISCOUNT_ALLOCATION — an invoice-level discount spread across lines
 *   - LANDED_COST_DISTRIBUTION — freight/duty distributed by value or by qty
 *
 * Everywhere else money and quantities stay exact at scale 1e-6. Rounding
 * residue from an allocation is assigned deterministically to the largest
 * part(s) (largest-remainder method) so the parts always reconcile to the
 * total to the cent — no float drift, ever.
 */

import { Money, MONEY_SCALE_DECIMALS } from "./money.js";

/** The named boundaries at which rounding is permitted. Documentation as data. */
export const ROUNDING_BOUNDARIES = [
  "LINE_EXTENSION",
  "TAX_COMPUTATION",
  "DISCOUNT_ALLOCATION",
  "LANDED_COST_DISTRIBUTION",
] as const;
export type RoundingBoundary = (typeof ROUNDING_BOUNDARIES)[number];

export type RoundingMode =
  | "HALF_UP" // 0.5 rounds away from zero (default, matches invoice arithmetic)
  | "HALF_EVEN" // banker's rounding
  | "DOWN" // truncate toward zero
  | "UP" // away from zero
  | "FLOOR" // toward -inf
  | "CEIL"; // toward +inf

const SCALE_DECIMALS = MONEY_SCALE_DECIMALS;

function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= 10n;
  return r;
}

/**
 * Quantize a scaled-integer value to `decimals` fractional places using `mode`,
 * returning a value still at the canonical scale (1e-6).
 */
function quantizeScaled(
  scaled: bigint,
  decimals: number,
  mode: RoundingMode,
): bigint {
  if (decimals < 0 || decimals > SCALE_DECIMALS) {
    throw new RangeError(
      `decimals must be within [0, ${SCALE_DECIMALS}], got ${decimals}`,
    );
  }
  const step = pow10(SCALE_DECIMALS - decimals);
  if (step === 1n) return scaled;

  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const q = abs / step;
  const r = abs % step;
  if (r === 0n) return scaled;

  const twice = r * 2n;
  let roundedAbs: bigint;
  switch (mode) {
    case "DOWN":
      roundedAbs = q;
      break;
    case "UP":
      roundedAbs = q + 1n;
      break;
    case "FLOOR":
      roundedAbs = negative ? q + 1n : q;
      break;
    case "CEIL":
      roundedAbs = negative ? q : q + 1n;
      break;
    case "HALF_UP":
      roundedAbs = twice >= step ? q + 1n : q;
      break;
    case "HALF_EVEN":
      if (twice > step) roundedAbs = q + 1n;
      else if (twice < step) roundedAbs = q;
      else roundedAbs = q % 2n === 0n ? q : q + 1n;
      break;
    default: {
      const _exhaustive: never = mode;
      throw new RangeError(`Unknown rounding mode: ${String(_exhaustive)}`);
    }
  }
  const result = roundedAbs * step;
  return negative ? -result : result;
}

/** Round a Money to `decimals` fractional places at a named boundary. */
export function roundMoney(
  amount: Money,
  decimals: number,
  mode: RoundingMode = "HALF_UP",
): Money {
  return Money.fromScaled(quantizeScaled(amount.scaled, decimals, mode));
}

/**
 * Largest-remainder allocation over raw scaled integers.
 *
 * Splits `total` across `weights` so the parts sum EXACTLY to `total`. Each
 * part gets floor(total·wᵢ/Σw); the leftover units (always < number of weights)
 * are handed one-by-one to the parts with the largest fractional remainder,
 * ties broken by lowest index — fully deterministic. Works for negative totals
 * (allocated on the magnitude, sign reapplied) so reversing entries reconcile
 * too.
 */
export function allocateScaled(
  total: bigint,
  weights: readonly (number | bigint)[],
): bigint[] {
  if (weights.length === 0) {
    throw new RangeError("allocate requires at least one weight");
  }
  const w = weights.map((x) => {
    const b = typeof x === "number" ? BigInt(Math.trunc(x)) : x;
    if (b < 0n) throw new RangeError("weights must be non-negative");
    return b;
  });
  const totalWeight = w.reduce((a, b) => a + b, 0n);
  if (totalWeight <= 0n) {
    throw new RangeError("total weight must be positive");
  }

  const sign = total < 0n ? -1n : 1n;
  const abs = sign * total;

  const base = new Array<bigint>(w.length);
  const remainder = new Array<bigint>(w.length);
  let allocated = 0n;
  for (let i = 0; i < w.length; i++) {
    const numerator = abs * (w[i] as bigint);
    base[i] = numerator / totalWeight;
    remainder[i] = numerator % totalWeight;
    allocated += base[i] as bigint;
  }

  let leftover = abs - allocated; // in [0, w.length)
  const order = w
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainder[a] as bigint;
      const rb = remainder[b] as bigint;
      if (ra < rb) return 1;
      if (ra > rb) return -1;
      return a - b; // stable tie-break: lowest index first
    });
  for (let k = 0; leftover > 0n; k++, leftover--) {
    const idx = order[k] as number;
    base[idx] = (base[idx] as bigint) + 1n;
  }

  return base.map((b) => sign * b);
}

/**
 * Allocate a Money `total` across `weights` so the returned parts sum exactly to
 * `total` (largest-remainder). Use at DISCOUNT_ALLOCATION / LANDED_COST_
 * DISTRIBUTION boundaries.
 */
export function allocate(
  total: Money,
  weights: readonly (number | bigint)[],
): Money[] {
  return allocateScaled(total.scaled, weights).map((s) => Money.fromScaled(s));
}
