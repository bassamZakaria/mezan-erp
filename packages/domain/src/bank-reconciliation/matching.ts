import { Money } from "../money/index.js";
import type { StatementLine } from "./bank-statement.js";

/**
 * One candidate treasury-side movement a statement line can match against —
 * a treasury account's GL ledger line, converted to the same signed
 * convention as `StatementLine.amount` (positive = money IN).
 */
export interface TreasuryLedgerCandidate {
  readonly entryId: string;
  /** The entry's human number, when it has been assigned one — what the picker shows beside the memo. */
  readonly entryNo: string | null;
  readonly date: string;
  readonly amount: Money;
  readonly description: string | null;
  readonly docNo?: string | null;
  readonly reference?: string | null;
  readonly counterparty?: string | null;
}

/** Reads the candidate treasury-side movements for one treasury account over a period. */
export interface TreasuryLedgerReader {
  entriesForTreasuryAccount(
    treasuryAccountId: string,
    fromDate: string,
    toDate: string,
  ): Promise<readonly TreasuryLedgerCandidate[]>;
  /**
   * The human entry NUMBER for each of `entryIds`, keyed by id; an id with no
   * entry, or an entry that never got a number, is simply absent.
   *
   * A matched line stores only `matchedEntryId`, so without this the screen
   * that shows the match has nothing but a UUID to print — and the candidate
   * list cannot supply the number either, because `matchCandidates` excludes
   * the entries that are already matched. The number has to be readable
   * independently of the picker.
   */
  entryNumbersByIds(entryIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /**
   * Each entry's net movement on the treasury account's GL account (money in
   * positive). An entry that does not touch the account is absent — that
   * absence is what refuses a match to an unrelated entry.
   */
  entryAmountsOnTreasuryAccount?(
    treasuryAccountId: string,
    entryIds: readonly string[],
  ): Promise<ReadonlyMap<string, TreasuryLedgerCandidate>>;
  /** The treasury account's GL balance (debit − credit) at the end of `asOfDate`. */
  bookBalance?(treasuryAccountId: string, asOfDate: string): Promise<Money>;
}

export const MATCH_WEIGHTS = { amount: 50, date: 25, reference: 15, counterparty: 10 } as const;
export const AUTO_APPLY_THRESHOLD = 90;
export const MATCH_WINDOW_DAYS = 10;
export const SPLIT_SCORE_CAP = 85;
const MAX_SPLIT_CANDIDATES = 40;
const MAX_SPLIT_PARTS = 3;

export interface MatchScore {
  readonly total: number;
  readonly amount: number;
  readonly date: number;
  readonly reference: number;
  readonly counterparty: number;
  readonly dateDeltaDays: number;
}

export interface ScoredCandidateSet {
  readonly lineId: string;
  readonly entryIds: readonly string[];
  readonly score: MatchScore;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / MS_PER_DAY));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase();
}

function compact(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9\u0600-\u06FF]/g, "");
}

function referenceTokens(values: readonly (string | null | undefined)[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const raw of normalizeText(value).split(/[^A-Z0-9]+/)) {
      if (raw.length < 3 || !/\d/.test(raw)) continue;
      tokens.add(raw);
      const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
      if (digits.length >= 3) tokens.add(`#${digits}`);
    }
  }
  return tokens;
}

const NAME_STOPWORDS = new Set([
  "من",
  "الي",
  "الى",
  "الى",
  "شركه",
  "مؤسسه",
  "تحويل",
  "ايداع",
  "سحب",
  "شيك",
  "COMPANY",
  "LTD",
  "LLC",
  "CO",
  "THE",
  "AND",
  "TRANSFER",
  "PAYMENT",
  "DEPOSIT",
]);

function nameTokens(value: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  if (!value) return tokens;
  for (const raw of normalizeText(value).split(/[^A-Z\u0600-\u06FF]+/)) {
    const token = raw.startsWith("ال") && raw.length > 4 ? raw.slice(2) : raw;
    if (token.length < 3 || NAME_STOPWORDS.has(raw) || NAME_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

export function dateScore(deltaDays: number): number {
  if (deltaDays > MATCH_WINDOW_DAYS) return 0;
  return Math.round((MATCH_WEIGHTS.date * (MATCH_WINDOW_DAYS + 1 - deltaDays)) / (MATCH_WINDOW_DAYS + 1));
}

export function referenceScore(line: Pick<StatementLine, "reference" | "description">, candidate: TreasuryLedgerCandidate): number {
  const candidateIds = [candidate.entryId, candidate.entryNo, candidate.docNo, candidate.reference];
  if (line.reference) {
    const lineRef = compact(line.reference);
    if (lineRef.length >= 3 && candidateIds.some((id) => id && compact(id) === lineRef)) return MATCH_WEIGHTS.reference;
  }
  const lineTokens = referenceTokens([line.reference, line.description]);
  const candidateTokens = referenceTokens([...candidateIds, candidate.description]);
  let best = 0;
  for (const token of lineTokens) {
    if (!candidateTokens.has(token)) continue;
    const strong = token.startsWith("#") ? token.length - 1 >= 4 : token.length >= 5;
    best = Math.max(best, strong ? MATCH_WEIGHTS.reference : Math.round(MATCH_WEIGHTS.reference / 2));
  }
  return best;
}

export function counterpartyScore(
  line: Pick<StatementLine, "description" | "counterparty">,
  candidate: TreasuryLedgerCandidate,
): number {
  const candidateNames = nameTokens(candidate.counterparty);
  if (candidateNames.size === 0) return 0;
  const lineNames = nameTokens(`${line.counterparty ?? ""} ${line.description}`);
  let shared = 0;
  for (const token of candidateNames) if (lineNames.has(token)) shared += 1;
  return Math.round((MATCH_WEIGHTS.counterparty * shared) / candidateNames.size);
}

/** Score one line against one candidate; null when the amounts differ, because amount equality is required. */
export function scoreCandidate(line: StatementLine, candidate: TreasuryLedgerCandidate): MatchScore | null {
  if (!candidate.amount.equals(line.amount)) return null;
  const dateDeltaDays = daysBetween(line.date, candidate.date);
  if (dateDeltaDays > MATCH_WINDOW_DAYS) return null;
  const parts = {
    amount: MATCH_WEIGHTS.amount,
    date: dateScore(dateDeltaDays),
    reference: referenceScore(line, candidate),
    counterparty: counterpartyScore(line, candidate),
  };
  return { ...parts, total: parts.amount + parts.date + parts.reference + parts.counterparty, dateDeltaDays };
}

function scoreSplit(line: StatementLine, parts: readonly TreasuryLedgerCandidate[]): MatchScore {
  const dateDeltaDays = Math.max(...parts.map((p) => daysBetween(line.date, p.date)));
  const pieces = {
    amount: MATCH_WEIGHTS.amount,
    date: dateScore(dateDeltaDays),
    reference: Math.max(...parts.map((p) => referenceScore(line, p))),
    counterparty: Math.max(...parts.map((p) => counterpartyScore(line, p))),
  };
  const raw = pieces.amount + pieces.date + pieces.reference + pieces.counterparty;
  return { ...pieces, total: Math.min(raw, SPLIT_SCORE_CAP), dateDeltaDays };
}

/**
 * Candidate sets of 2..3 entries whose amounts sum EXACTLY to the line. Only
 * same-direction entries inside the date window qualify, and the search is
 * bounded so a busy account cannot make it explode.
 */
export function splitCandidates(
  line: StatementLine,
  candidates: readonly TreasuryLedgerCandidate[],
  limit = 3,
): readonly ScoredCandidateSet[] {
  const sign = line.amount.scaled > 0n ? 1n : -1n;
  const target = line.amount.scaled * sign;
  const pool = candidates
    .filter((c) => {
      const magnitude = c.amount.scaled * sign;
      return magnitude > 0n && magnitude < target && daysBetween(line.date, c.date) <= MATCH_WINDOW_DAYS;
    })
    .sort((a, b) => daysBetween(line.date, a.date) - daysBetween(line.date, b.date))
    .slice(0, MAX_SPLIT_CANDIDATES);
  const found: ScoredCandidateSet[] = [];
  const walk = (start: number, chosen: TreasuryLedgerCandidate[], sum: bigint) => {
    if (found.length >= limit * 4) return;
    for (let i = start; i < pool.length; i += 1) {
      const candidate = pool[i]!;
      const next = sum + candidate.amount.scaled * sign;
      if (next > target) continue;
      const set = [...chosen, candidate];
      if (next === target && set.length >= 2) {
        found.push({ lineId: line.id, entryIds: set.map((c) => c.entryId), score: scoreSplit(line, set) });
      } else if (set.length < MAX_SPLIT_PARTS) {
        walk(i + 1, set, next);
      }
    }
  };
  if (line.amount.scaled !== 0n) walk(0, [], 0n);
  return found.sort((a, b) => b.score.total - a.score.total).slice(0, limit);
}

/** Every 1:1 candidate for the line, best first; ties go to the closer date, then the entry id. */
export function rankCandidates(
  line: StatementLine,
  candidates: readonly TreasuryLedgerCandidate[],
): readonly ScoredCandidateSet[] {
  const ranked: ScoredCandidateSet[] = [];
  for (const candidate of candidates) {
    const score = scoreCandidate(line, candidate);
    if (score) ranked.push({ lineId: line.id, entryIds: [candidate.entryId], score });
  }
  return ranked.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.score.dateDeltaDays - b.score.dateDeltaDays ||
      a.entryIds[0]!.localeCompare(b.entryIds[0]!),
  );
}

export interface LineSuggestions {
  readonly lineId: string;
  readonly options: readonly ScoredCandidateSet[];
  /** True when the best option may be applied without review: ≥ 90, uncontested and unambiguous. */
  readonly autoApply: boolean;
}

function setKey(lineId: string, entryIds: readonly string[]): string {
  return `${lineId}|${[...entryIds].sort().join(",")}`;
}

export function suggestionKey(lineId: string, entryIds: readonly string[]): string {
  return setKey(lineId, entryIds);
}

/**
 * Suggestions for every UNMATCHED line. Each line's options are ranked; the
 * best option per line is then assigned greedily across the statement so one
 * entry is never the first choice of two lines. A 1:1 option wins over a split
 * of the same line. Pure — the service decides what to store and what to apply.
 */
export function buildSuggestions(
  lines: readonly StatementLine[],
  candidates: readonly TreasuryLedgerCandidate[],
  opts: { excluded?: ReadonlySet<string>; perLine?: number } = {},
): readonly LineSuggestions[] {
  const excluded = opts.excluded ?? new Set<string>();
  const perLine = opts.perLine ?? 3;
  const open = lines.filter((l) => l.status !== "matched" && l.amount.scaled !== 0n);
  const ranked = new Map<string, ScoredCandidateSet[]>();
  for (const line of open) {
    let options = rankCandidates(line, candidates).filter((o) => !excluded.has(setKey(line.id, o.entryIds)));
    if (options.length === 0) {
      options = splitCandidates(line, candidates).filter((o) => !excluded.has(setKey(line.id, o.entryIds)));
    }
    if (options.length > 0) ranked.set(line.id, options);
  }

  const firstChoices = [...ranked.values()]
    .map((options) => options[0]!)
    .sort((a, b) => b.score.total - a.score.total || a.lineId.localeCompare(b.lineId));
  const claimed = new Set<string>();
  const assigned = new Map<string, ScoredCandidateSet>();
  for (const choice of firstChoices) {
    const options = ranked.get(choice.lineId)!;
    const free = options.find((o) => o.entryIds.every((id) => !claimed.has(id)));
    if (!free) continue;
    free.entryIds.forEach((id) => claimed.add(id));
    assigned.set(choice.lineId, free);
  }

  const highByEntry = new Map<string, number>();
  for (const options of ranked.values()) {
    for (const option of options) {
      if (option.score.total < AUTO_APPLY_THRESHOLD) continue;
      for (const id of option.entryIds) highByEntry.set(id, (highByEntry.get(id) ?? 0) + 1);
    }
  }

  const result: LineSuggestions[] = [];
  for (const line of open) {
    const options = ranked.get(line.id);
    if (!options) continue;
    const best = assigned.get(line.id);
    const ordered = best ? [best, ...options.filter((o) => o !== best)] : options;
    const runnerUp = ordered[1];
    const autoApply =
      best !== undefined &&
      best.entryIds.length === 1 &&
      best.score.total >= AUTO_APPLY_THRESHOLD &&
      (runnerUp === undefined || runnerUp.score.total < best.score.total) &&
      best.entryIds.every((id) => (highByEntry.get(id) ?? 0) === 1);
    result.push({ lineId: line.id, options: ordered.slice(0, perLine), autoApply });
  }
  return result;
}

export interface MatchSuggestion {
  readonly lineId: string;
  readonly entryId: string;
  /** Absolute days between the line's date and the candidate's date. */
  readonly dateDeltaDays: number;
}

/** The auto-applicable subset of {@link buildSuggestions}, kept for callers that only want the confident 1:1 matches. */
export function suggestMatches(
  lines: readonly StatementLine[],
  candidates: readonly TreasuryLedgerCandidate[],
  opts: { dateToleranceDays?: number } = {},
): readonly MatchSuggestion[] {
  const tolerance = opts.dateToleranceDays ?? MATCH_WINDOW_DAYS;
  return buildSuggestions(lines, candidates)
    .filter((s) => s.autoApply && s.options[0]!.score.dateDeltaDays <= tolerance)
    .map((s) => ({ lineId: s.lineId, entryId: s.options[0]!.entryIds[0]!, dateDeltaDays: s.options[0]!.score.dateDeltaDays }));
}

export function sumAmounts(items: readonly { amount: Money }[]): Money {
  return Money.sum(items.map((i) => i.amount));
}
