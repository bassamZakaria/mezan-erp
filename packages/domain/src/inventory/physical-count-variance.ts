/**
 * محرك فروقات الجرد (physical-count variance engine) — docs/catalog/03
 * §"الجرد الفعلي". `physical-count.ts` owns the SESSION (snapshot → record →
 * complete → generate adjustment); this module owns the READ side of that
 * session: the signed per-line variance, its value at the weighted-average
 * cost snapshotted when the count opened, and the over/short rollup the
 * screen and the printed count sheet both show.
 *
 * It is a pure function of a `PhysicalCount` — no repository, no ledger read —
 * precisely because the count already carries its own snapshot: valuing the
 * variance against the LIVE average cost would move the number every time an
 * unrelated purchase re-averages the item.
 *
 * All arithmetic goes through Money/Qty and the costing engine's `extend`
 * (qty × unitCost, HALF_UP at scale 1e-6) — never floats.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "./wac-math.js";
import { varianceOf, type PhysicalCount, type PhysicalCountLine } from "./physical-count.js";

export interface PhysicalCountLineVariance {
  readonly itemId: string;
  readonly systemQty: Qty;
  readonly countedQty: Qty | null;
  /** Weighted-average unit cost snapshotted when the count opened. */
  readonly unitCost: Money;
  /** counted − system. Null until the line is counted. */
  readonly varianceQty: Qty | null;
  /** varianceQty × unitCost. Null until the line is counted. */
  readonly varianceValue: Money | null;
}

export function lineVarianceOf(line: PhysicalCountLine): PhysicalCountLineVariance {
  const varianceQty = varianceOf(line);
  return {
    itemId: line.itemId,
    systemQty: line.systemQty,
    countedQty: line.countedQty,
    unitCost: line.unitCost,
    varianceQty,
    varianceValue: varianceQty ? extend(varianceQty, line.unitCost) : null,
  };
}

export function varianceLinesOf(count: PhysicalCount): readonly PhysicalCountLineVariance[] {
  return count.lines.map(lineVarianceOf);
}

/**
 * Over/short rollup. `over*` and `short*` are POSITIVE magnitudes (زيادة /
 * عجز); `net = over − short` is the signed figure the generated adjustment
 * posts, and `absValue` (over + short) is the total value at risk — the number
 * that does not cancel itself out when a surplus offsets a shortage.
 */
export interface PhysicalCountVarianceSummary {
  readonly totalLines: number;
  readonly countedLines: number;
  readonly uncountedLines: number;
  readonly matchedLines: number;
  readonly overLines: number;
  readonly shortLines: number;
  readonly overQty: Qty;
  readonly shortQty: Qty;
  readonly netQty: Qty;
  readonly overValue: Money;
  readonly shortValue: Money;
  readonly netValue: Money;
  readonly absValue: Money;
}

export function summarizePhysicalCountVariance(count: PhysicalCount): PhysicalCountVarianceSummary {
  let countedLines = 0;
  let matchedLines = 0;
  let overLines = 0;
  let shortLines = 0;
  let overQty = Qty.zero();
  let shortQty = Qty.zero();
  let overValue = Money.zero();
  let shortValue = Money.zero();

  for (const line of count.lines) {
    const variance = lineVarianceOf(line);
    if (!variance.varianceQty || !variance.varianceValue) continue;
    countedLines += 1;
    if (variance.varianceQty.isZero()) {
      matchedLines += 1;
      continue;
    }
    if (variance.varianceQty.isNegative()) {
      shortLines += 1;
      shortQty = shortQty.add(variance.varianceQty.negate());
      shortValue = shortValue.add(variance.varianceValue.negate());
    } else {
      overLines += 1;
      overQty = overQty.add(variance.varianceQty);
      overValue = overValue.add(variance.varianceValue);
    }
  }

  return {
    totalLines: count.lines.length,
    countedLines,
    uncountedLines: count.lines.length - countedLines,
    matchedLines,
    overLines,
    shortLines,
    overQty,
    shortQty,
    netQty: overQty.subtract(shortQty),
    overValue,
    shortValue,
    netValue: overValue.add(shortValue.negate()),
    absValue: overValue.add(shortValue),
  };
}
