import type { Money } from "../money/index.js";
import type { StatementLine } from "./bank-statement.js";

/**
 * One candidate treasury-side movement a statement line can match against —
 * a treasury account's GL ledger line, converted to the same signed
 * convention as `StatementLine.amount` (positive = money IN).
 */
export interface TreasuryLedgerCandidate {
  readonly entryId: string;
  readonly date: string;
  readonly amount: Money;
  readonly description: string | null;
}

/** Reads the candidate treasury-side movements for one treasury account over a period. */
export interface TreasuryLedgerReader {
  entriesForTreasuryAccount(
    treasuryAccountId: string,
    fromDate: string,
    toDate: string,
  ): Promise<readonly TreasuryLedgerCandidate[]>;
}

export interface MatchSuggestion {
  readonly lineId: string;
  readonly entryId: string;
  /** Absolute days between the line's date and the candidate's date. */
  readonly dateDeltaDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / MS_PER_DAY);
}

/**
 * Suggest 1:1 matches between UNMATCHED statement lines and candidate
 * treasury ledger movements: exact amount match within `dateToleranceDays`
 * (default 5, generous enough for bank clearing lag), greedily picking the
 * closest-date candidate for each line, each candidate used at most once.
 * Pure — callers decide whether/how to apply the suggestions.
 */
export function suggestMatches(
  lines: readonly StatementLine[],
  candidates: readonly TreasuryLedgerCandidate[],
  opts: { dateToleranceDays?: number } = {},
): readonly MatchSuggestion[] {
  const tolerance = opts.dateToleranceDays ?? 5;
  const usedEntryIds = new Set<string>();
  const suggestions: MatchSuggestion[] = [];

  for (const line of lines) {
    if (line.status === "matched") continue;
    let best: { candidate: TreasuryLedgerCandidate; delta: number } | null = null;
    for (const candidate of candidates) {
      if (usedEntryIds.has(candidate.entryId)) continue;
      if (!candidate.amount.equals(line.amount)) continue;
      const delta = daysBetween(line.date, candidate.date);
      if (delta > tolerance) continue;
      if (!best || delta < best.delta) best = { candidate, delta };
    }
    if (best) {
      usedEntryIds.add(best.candidate.entryId);
      suggestions.push({ lineId: line.id, entryId: best.candidate.entryId, dateDeltaDays: best.delta });
    }
  }
  return suggestions;
}
