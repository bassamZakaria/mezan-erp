import { Money } from "../money/index.js";
import { BASE_CURRENCY } from "./exchange-rate.js";

const SCALE = 1_000_000n; // 10^6, the Money scale

/**
 * Raised when a multi-currency amount must be converted (or an open FX balance
 * revalued) but no exchange rate is available for the currency/date — the
 * "strict fx-rate-missing policy" (docs/archive/catalog/04 §FX Revaluation): rather than
 * silently posting at 1:1 or skipping, the operation fails loudly.
 */
export class FxRateMissingError extends Error {
  readonly code = "FX_RATE_MISSING";
  readonly messageEn: string;
  constructor(
    readonly currency: string,
    readonly asOfDate: string,
  ) {
    super(`لا يوجد سعر صرف للعملة ${currency} في ${asOfDate} أو قبله.`);
    this.messageEn = `No exchange rate for ${currency} on/before ${asOfDate}.`;
    this.name = "FxRateMissingError";
  }
}

/** Round a scaled bigint quotient half-away-from-zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Convert a foreign-currency {@link Money} amount to the base currency at
 * `rate` (base units per one foreign unit, exact decimal string). Pure bigint
 * math with half-away-from-zero rounding at the 1e-6 money scale — never a
 * float. A base-currency (or empty) `currency` passes through unchanged.
 */
export function convertToBase(foreign: Money, rate: string): Money {
  const rateScaled = Money.fromMajor(rate).scaled;
  // foreign.scaled (1e-6) * rateScaled (1e-6) = product at 1e-12; ÷1e6 → 1e-6.
  return Money.fromScaled(divRound(foreign.scaled * rateScaled, SCALE));
}

/**
 * Convert a base-currency amount back to its foreign currency at `rate` — the
 * inverse of {@link convertToBase}. Used to recover the foreign balance that a
 * posted base amount + its booking rate represent.
 */
export function convertFromBase(base: Money, rate: string): Money {
  const rateScaled = Money.fromMajor(rate).scaled;
  if (rateScaled === 0n) return Money.zero();
  // base.scaled (1e-6) ÷ rate → multiply by 1e6 first to keep the 1e-6 scale.
  return Money.fromScaled(divRound(base.scaled * SCALE, rateScaled));
}

/** INVARIANT: an outflow that takes all the foreign money takes all the base, so a position with no foreign money left has no base left either; this is the one place a carrying amount is rounded. */
export function carryingBaseOf(position: { readonly foreign: Money; readonly base: Money }, foreignOut: Money): { readonly covered: Money; readonly base: Money } {
  if (position.foreign.scaled <= 0n || foreignOut.scaled <= 0n) return { covered: Money.zero(), base: Money.zero() };
  if (foreignOut.scaled >= position.foreign.scaled) return { covered: position.foreign, base: position.base };
  return { covered: foreignOut, base: Money.fromScaled(divRound(position.base.scaled * foreignOut.scaled, position.foreign.scaled)) };
}

export function shareOfBase(amount: Money, part: Money, whole: Money): Money {
  if (whole.scaled === 0n || part.scaled === whole.scaled) return amount;
  return Money.fromScaled(divRound(amount.scaled * part.scaled, whole.scaled));
}

/** True when a currency code represents the base currency (or is unset). */
export function isBaseCurrency(currency: string | null | undefined): boolean {
  return currency == null || currency === "" || currency === BASE_CURRENCY;
}
