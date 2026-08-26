/**
 * Unit-of-measure conversion — turning a quantity ENTERED in an alternate unit
 * into the BASE quantity the stock ledger moves (docs/catalog/03 §"وحدات
 * القياس", e.g. "كرتونة = 12 قطعة").
 *
 * An item's alternate units carry a `factor` as a plain JS number because that
 * is what the item master stores. It is lifted to a scaled bigint here and
 * never used as a float again: the conversion itself is exact integer
 * arithmetic at `Qty`'s 1e-6 scale, HALF_UP, the same discipline the money
 * path follows. A line sold in cartons therefore issues an exact piece count,
 * and the COGS leg of the journal entry is computed from that same count.
 */

import { Qty } from "../money/index.js";

/** Conversion factors are held at 1e-6, like every other scaled value. */
export const UNIT_FACTOR_SCALE = 1_000_000n;

/** An item's unit setup as the conversion needs to see it. */
export interface UnitSetup {
  readonly baseUnitCode: string;
  readonly alternateUnits: readonly { readonly code: string; readonly factor: number }[];
}

export class UnknownUnitError extends Error {
  readonly code = "UNKNOWN_UNIT";
  constructor(
    readonly unitCode: string,
    readonly baseUnitCode: string,
  ) {
    super(`Unit "${unitCode}" is not the base unit "${baseUnitCode}" nor one of its alternates.`);
    this.name = "UnknownUnitError";
  }
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Lift an item-master factor to the 1e-6 scale. Factors beyond six decimals
 * are refused rather than silently truncated — a conversion nobody can state
 * exactly is not one the stock ledger should replay.
 */
export function unitFactorToScaled(factor: number): bigint {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`Unit conversion factor must be positive and finite, got ${factor}`);
  }
  const scaled = Math.round(factor * 1_000_000);
  if (Math.abs(factor * 1_000_000 - scaled) > 1e-6) {
    throw new RangeError(`Unit conversion factor supports at most 6 decimal places, got ${factor}`);
  }
  return BigInt(scaled);
}

/**
 * Base units per one of `unitCode`. The base unit itself — and an empty code,
 * which is what a document raised before units existed carries — is 1.
 */
export function resolveUnitFactor(setup: UnitSetup, unitCode: string | null | undefined): number {
  const code = (unitCode ?? "").trim();
  if (code === "" || code === setup.baseUnitCode) return 1;
  const alternate = setup.alternateUnits.find((u) => u.code === code);
  if (!alternate) throw new UnknownUnitError(code, setup.baseUnitCode);
  return alternate.factor;
}

/** qty (in the entered unit) × factor = the base quantity, exactly. */
export function toBaseQty(qty: Qty, factor: number): Qty {
  const factorScaled = unitFactorToScaled(factor);
  if (factorScaled === UNIT_FACTOR_SCALE) return qty;
  return Qty.fromScaled(divHalfUp(qty.scaled * factorScaled, UNIT_FACTOR_SCALE));
}

/** The inverse of {@link toBaseQty} — a base quantity expressed in `unitCode`. */
export function fromBaseQty(baseQty: Qty, factor: number): Qty {
  const factorScaled = unitFactorToScaled(factor);
  if (factorScaled === UNIT_FACTOR_SCALE) return baseQty;
  return Qty.fromScaled(divHalfUp(baseQty.scaled * UNIT_FACTOR_SCALE, factorScaled));
}
