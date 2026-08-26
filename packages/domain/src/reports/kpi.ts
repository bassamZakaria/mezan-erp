/**
 * The arithmetic behind a report's summary strip (R21.2).
 *
 * A KPI and the grand-total row beneath it are the same claim about the same
 * rows, so they must be the same addition: `sumRows` is what the engine's
 * column totals use, and every report's money KPI calls it on the same field
 * its column reads. Two adders would be two answers.
 */

/**
 * Adds a numeric row field in SCALED INTEGERS at 1e-6, never as floats.
 *
 * A money column's values are exact to the piastre; adding a few hundred of
 * them as IEEE-754 doubles compounds the representation error, which is how a
 * balanced trial balance once reported 681,214.3999999999 against 681,214.4.
 */
export function sumRows<Row>(rows: readonly Row[], pick: (row: Row) => number | null | undefined): number {
  let scaled = 0n;
  for (const row of rows) {
    const raw = pick(row);
    if (typeof raw === "number" && Number.isFinite(raw)) scaled += BigInt(Math.round(raw * 1e6));
  }
  return Number(scaled) / 1e6;
}

/**
 * `a − b` at 1e-6. Subtracting two piastre-exact doubles is as lossy as adding
 * them: output VAT 6,455.40 less input VAT 18,527.60 came out of the subtraction
 * as −12,072.199999999999, and that figure is the headline of a tax return.
 */
export function diffOf(a: number, b: number): number {
  return Number(BigInt(Math.round(a * 1e6)) - BigInt(Math.round(b * 1e6))) / 1e6;
}

/** Rows matching a predicate — the count KPIs ("how many are overdue"). */
export function countRows<Row>(rows: readonly Row[], match: (row: Row) => boolean): number {
  let count = 0;
  for (const row of rows) if (match(row)) count += 1;
  return count;
}

/** Distinct non-empty values of a row field — "how many customers", not "how many lines". */
export function countDistinct<Row>(rows: readonly Row[], pick: (row: Row) => string | null | undefined): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = pick(row);
    if (typeof value === "string" && value !== "") seen.add(value);
  }
  return seen.size;
}

/** The largest value of a row field, or 0 over no rows. */
export function maxOf<Row>(rows: readonly Row[], pick: (row: Row) => number | null | undefined): number {
  let max = 0;
  let seen = false;
  for (const row of rows) {
    const value = pick(row);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!seen || value > max) {
      max = value;
      seen = true;
    }
  }
  return max;
}

/**
 * `part / whole` as a percentage, quantised to two decimals. Zero when the
 * denominator is zero — a share of nothing is not infinity, it is nothing.
 */
export function percentOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10_000) / 100;
}

/**
 * `total / count` at money precision — both sides scaled to 1e-6 first, so a
 * fractional denominator (an average unit cost over 12.5 kg) divides exactly
 * rather than through a double.
 */
export function averageOf(total: number, count: number): number {
  const divisor = BigInt(Math.round(count * 1e6));
  if (divisor === 0n) return 0;
  return Number((BigInt(Math.round(total * 1e6)) * 1_000_000n) / divisor) / 1e6;
}
