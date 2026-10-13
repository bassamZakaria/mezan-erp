import { z } from "zod";

/**
 * The one money-on-the-wire schema (D126).
 *
 * Money crosses the wire as an exact decimal string, never a float — the
 * boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/archive/plan.md §2.3). Around seventy fields declared that as a bare
 * `z.string()`, so `"1e3"`, `"0x10"`, `"NaN"` and `" 12 "` all passed
 * validation and were handed to `Money.fromMajor`, which threw a `RangeError`
 * the routes never caught: a malformed REQUEST was answered 500, as though the
 * server had faulted. Nothing was ever persisted, so the books were never at
 * risk — this is a robustness and support-cost defect, not a correctness one,
 * and the fix is to refuse it at the edge with a 400 that names the field.
 *
 * The rules below are `Money.fromMajor`'s own, stated once:
 *
 * - an optional leading `-`, digits, optionally a `.` and more digits;
 * - **at most six fraction digits** (`MONEY_SCALE_DECIMALS`), because a
 *   seventh is silently unrepresentable and `fromMajor` throws on it;
 * - no leading/trailing whitespace. `fromMajor` trims before it validates, so
 *   `" 100 "` used to be accepted quietly — a padded literal on the wire is a
 *   client bug worth hearing about, not worth absorbing;
 * - no exponent, hex, `Infinity` or `NaN` — none of which is an amount.
 *
 * An upper bound is enforced too. `Money` is a bigint and has no natural
 * ceiling, but a 40-digit amount in a request is never a real one, and every
 * downstream report that sums it has to render it somewhere.
 */

/** `MONEY_SCALE_DECIMALS` in @mezan/domain. Duplicated: contracts must not depend on the domain. */
const MONEY_SCALE_DECIMALS = 6;

/** Enough for any real amount, small enough that a corrupt literal cannot become a headline figure. */
const MAX_INTEGER_DIGITS = 18;

const SIGNED = new RegExp(`^-?\\d{1,${MAX_INTEGER_DIGITS}}(\\.\\d{1,${MONEY_SCALE_DECIMALS}})?$`);
const UNSIGNED = new RegExp(`^\\d{1,${MAX_INTEGER_DIGITS}}(\\.\\d{1,${MONEY_SCALE_DECIMALS}})?$`);

const RULE_AR = `حتى ${MAX_INTEGER_DIGITS} خانة و${MONEY_SCALE_DECIMALS} خانات عشرية، بأرقام لاتينية، بلا أُس ولا مسافات ولا فواصل`;
const RULE_EN = `up to ${MAX_INTEGER_DIGITS} digits and ${MONEY_SCALE_DECIMALS} decimal places, no exponent, no spaces`;

const SIGNED_MESSAGE = `القيمة يجب أن تكون رقماً عشرياً صحيح الصيغة — ${RULE_AR}. (must be an exact decimal amount — ${RULE_EN})`;
const UNSIGNED_MESSAGE = `القيمة يجب أن تكون رقماً عشرياً غير سالب صحيح الصيغة — ${RULE_AR}. (must be a non-negative exact decimal amount — ${RULE_EN})`;

/** An amount that may be negative. */
export const moneyString = z.string().regex(SIGNED, SIGNED_MESSAGE);

/** An amount that may not be negative — a price, a quantity's value, a total. */
export const nonNegativeMoneyString = z.string().regex(UNSIGNED, UNSIGNED_MESSAGE);

/**
 * A rate or a multiplier rather than an amount: an FX rate, a cost-allocation
 * weight. Same literal rules; kept as its own name so a reader can tell at the
 * field what kind of number it is.
 */
export const decimalRateString = nonNegativeMoneyString;

/** A quantity: the same literal, at the same six-decimal scale `Qty` keeps. */
export const quantityString = moneyString;
export const nonNegativeQuantityString = nonNegativeMoneyString;

export const MONEY_STRING_RULES = {
  maxIntegerDigits: MAX_INTEGER_DIGITS,
  maxFractionDigits: MONEY_SCALE_DECIMALS,
} as const;
