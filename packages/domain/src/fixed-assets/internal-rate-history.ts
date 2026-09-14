import type { Money } from "../money/index.js";

/**
 * تاريخ سعر الساعة الداخلي — the effective-dated rate سجل تشغيل المعدات charges
 * a project at.
 *
 * A single scalar on the asset restates history: a log entered today for work
 * done last month is priced at the rate somebody changed yesterday, and the WIP
 * it produced — then the cost, then the percentage of completion, then the
 * recognised revenue — moves for a month that was already reported. The rate is
 * therefore a series, and a log resolves the row effective on ITS OWN date.
 */
export interface AssetInternalRateRow {
  readonly assetId: string;
  /** `YYYY-MM-DD`. The rate applies to every log dated on or after this day, until the next row. */
  readonly effectiveFrom: string;
  readonly hourlyRate: Money;
  /** WHO set it. Null only on rows written before the column existed. */
  readonly setBy: string | null;
  /** The instant the row was appended — never the date it takes effect from. */
  readonly setAt: string;
}

/** Persistence port. Append-only: a rate is superseded by a later row, never edited. */
export interface AssetInternalRateHistoryRepository {
  list(assetId: string): Promise<readonly AssetInternalRateRow[]>;
  listAll(): Promise<readonly AssetInternalRateRow[]>;
  append(row: AssetInternalRateRow): Promise<void>;
}

/** Oldest first, so a reader and the resolver below agree on what "latest" means. */
export function sortInternalRateHistory(
  history: readonly AssetInternalRateRow[],
): readonly AssetInternalRateRow[] {
  return [...history].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom ? a.setAt.localeCompare(b.setAt) : a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}

/**
 * The rate in force on `onDate`: the latest row whose `effectiveFrom` is on or
 * before it. Null when the series starts after that date — a log before the
 * first rate has no price, and inventing one is exactly the restatement this
 * series exists to stop.
 */
export function resolveInternalHourlyRate(
  history: readonly AssetInternalRateRow[],
  onDate: string,
): Money | null {
  const applicable = sortInternalRateHistory(history).filter((r) => r.effectiveFrom <= onDate);
  return applicable.length === 0 ? null : (applicable[applicable.length - 1] as AssetInternalRateRow).hourlyRate;
}
