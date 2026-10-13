const SCALE_DIGITS = 6;

/**
 * The API's money strings are decimals at scale 1e-6 ("13953.600000"). Parsing
 * one with Number() and adding it to another is how a KPI strip drifts: ten
 * list screens each defined their own `toMajor(): number` and summed hundreds
 * of rows in binary floating point. Sum in bigint and convert once, at the
 * point of display.
 */
export function scaledOf(value: string | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = digits.split(".");
  const padded = (fraction + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  const scaled = BigInt(whole || "0") * 10n ** BigInt(SCALE_DIGITS) + BigInt(padded || "0");
  return negative ? -scaled : scaled;
}

export function sumScaled(values: Iterable<string | null | undefined>): bigint {
  let total = 0n;
  for (const value of values) total += scaledOf(value);
  return total;
}

/**
 * The display boundary. `Money` renders a number, so one conversion per figure
 * is unavoidable — what matters is that it happens after the addition, not
 * before each term.
 */
export function toMajorNumber(scaled: bigint): number {
  return Number(scaled) / 10 ** SCALE_DIGITS;
}

/**
 * Sum a column of API decimal strings straight to a display number. Quantities
 * use the same scale-1e-6 string form as money, so they belong here too.
 */
export function sumMajor(values: Iterable<string | null | undefined>): number {
  return toMajorNumber(sumScaled(values));
}

export function majorOf(value: string | null | undefined): number {
  return toMajorNumber(scaledOf(value));
}

export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
