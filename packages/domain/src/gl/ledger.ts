import type { Money } from "../money/index.js";
import type { JournalEntry, JournalEntrySource, JournalEntryStatus } from "../journal.js";
import type { CostCategory } from "../contracting/cost-category.js";

/**
 * Ledger persistence port for the GL posting engine.
 *
 * This is the richer sibling of the spike's `JournalRepository` (journal.ts):
 * it owns the full journal-entry lifecycle (draft → posted → reversed),
 * exposes the read paths the ledger needs (list, lookup by number), and answers
 * account-balance / account-ledger queries by summing posted journal lines.
 *
 * `transaction` is the atomic boundary the engine posts inside: number
 * allocation and the entry insert MUST share one transaction so document
 * numbers have no gaps under concurrency (docs/archive/plan.md §2.3 rule 5, §3 rule 5).
 * The domain depends on this interface only — no SQL, no driver (docs/archive/plan.md
 * §3.2).
 */
export interface LedgerRepository {
  /** Insert a new entry (and its lines). Posted entries are append-only thereafter. */
  save(entry: JournalEntry): Promise<void>;
  /**
   * Persist a *status/linkage* transition of an existing entry (draft→posted,
   * posted→reversed, reversedByEntryId link). Line content is never mutated —
   * corrections are reversing entries.
   */
  update(entry: JournalEntry): Promise<void>;
  /**
   * Overwrite a مسودة (draft) entry's date, memo, source and lines in place,
   * keeping its id. Every line is replaced — unlike `update`, this is the one
   * port method allowed to touch `journal_line` content, and only because
   * nothing has posted from these lines yet. Callers MUST verify
   * `status === "draft"` first (D226); this method does not re-check.
   */
  replaceDraft(entry: JournalEntry): Promise<void>;
  /**
   * Permanently remove a مسودة (draft) entry and its lines — the only delete
   * this port exposes, because nothing downstream has ever read a draft's
   * lines as fact. Callers MUST verify `status === "draft"` first (D226).
   */
  deleteDraft(entryId: string): Promise<void>;
  findById(id: string): Promise<JournalEntry | null>;
  findByEntryNo(entryNo: string): Promise<JournalEntry | null>;
  /** The date each of these entries carries, in one read; an id with no entry is absent. Optional on the port. */
  entryDates?(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  list(filter?: JournalListFilter): Promise<readonly JournalEntry[]>;
  /** How many entries the same filter matches, ignoring `limit`/`offset`. Optional on the port. */
  count?(filter?: JournalListFilter): Promise<number>;
  /** Net debit/credit for one account, counting posted+reversed lines dated on/before `asOfDate` (inclusive). */
  accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance>;
  /** The individual posted movements for one account, oldest-first, dated on/before `asOfDate`. */
  accountLedger(accountId: string, asOfDate?: string): Promise<readonly AccountLedgerLine[]>;
  /**
   * The individual posted journal lines matching `filter`, oldest-first. Backs
   * dimensional reporting (Cost Center P&L groups these by costCenterId +
   * account) and the reconciliation "unlinked entries" scan. Optional on the
   * port so lightweight in-memory ledgers need not implement it.
   */
  listLines?(filter?: PostedLineFilter): Promise<readonly PostedLine[]>;
  /**
   * Net (debit − credit) per account over the entries matching `filter`, as ONE
   * aggregate rather than every entry and line read into JS (Q-6). Positive is
   * a net debit. An account with no matching line is absent from the map.
   *
   * Must answer exactly what `netBalancesByAccount` computes over the same
   * slice — the trial balance and the seven financial statements read one or
   * the other and may never disagree. Optional on the port, so a lightweight
   * in-memory ledger keeps folding its own entries.
   */
  accountBalances?(filter?: LedgerAggregateFilter): Promise<ReadonlyMap<string, Money>>;
  /**
   * Σ debit and Σ credit over the lines matching `filter` — GROSS, not net, so
   * a report that sums what documents recorded has a ledger figure of the same
   * question to reconcile against. One aggregate, not a fold over every entry.
   */
  sumLines?(filter?: LedgerAggregateFilter): Promise<{ readonly debit: Money; readonly credit: Money }>;
  /** Run `fn` inside one atomic transaction (BEGIN IMMEDIATE on SQLite). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Filter for the SQL-side aggregates {@link LedgerRepository.accountBalances} / {@link LedgerRepository.sumLines}. */
export interface LedgerAggregateFilter {
  /** ISO date (YYYY-MM-DD), inclusive bounds on the entry date. */
  readonly fromDate?: string;
  readonly toDate?: string;
  /**
   * Entry statuses to count. Defaults to `["posted", "reversed"]` — the slice
   * `isLedgerEffective` defines. Reversal posts a MIRROR entry and marks the
   * original `reversed`, so counting only `posted` keeps the mirror and drops
   * what it offsets; narrow this only when the caller means gross activity.
   */
  readonly statuses?: readonly JournalEntryStatus[];
  /** Restrict to lines carrying one of these account ids. */
  readonly accountIds?: readonly string[];
  /** Restrict to entries produced by one of these document types. */
  readonly sourceDocTypes?: readonly string[];
  /** Drops the year-end closing entry, which no performance statement counts as activity. */
  readonly excludeSourceDocTypes?: readonly string[];
}

/** Filter for {@link LedgerRepository.listLines}. */
export interface PostedLineFilter {
  /** ISO date (YYYY-MM-DD), inclusive lower bound on the entry date. */
  readonly fromDate?: string;
  /** ISO date (YYYY-MM-DD), inclusive upper bound on the entry date. */
  readonly toDate?: string;
  /** Restrict to lines carrying one of these account ids. */
  readonly accountIds?: readonly string[];
  /** Restrict to lines carrying this cost-center dimension. */
  readonly costCenterId?: string;
  /** Restrict to lines carrying this project dimension (D-01). */
  readonly projectId?: string;
  /** Restrict to lines carrying this branch dimension (DEC-20). */
  readonly branchId?: string;
}

/** One posted journal line with its full dimensional context. */
export interface PostedLine {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly source: JournalEntrySource;
  readonly accountId: string;
  readonly costCenterId: string | null;
  readonly projectId: string | null;
  readonly costCategory: CostCategory | null;
  /** بُعد الفرع (DEC-20). Null on every line no path has filled yet — the statements report those as «غير مخصص». */
  readonly branchId: string | null;
  /** The customer/supplier a manual line on a party control account names (D205). */
  readonly partyId?: string | null;
  /** The document that posted the entry (R6.3), so a sub-ledger can find its own postings. */
  readonly sourceDocType?: string | null;
  readonly sourceDocId?: string | null;
  readonly currency: string | null;
  readonly fxRate: string | null;
  readonly memo: string | null;
  readonly debit: Money;
  readonly credit: Money;
}

/** Optional filters for {@link LedgerRepository.list}. */
export interface JournalListFilter {
  readonly status?: JournalEntryStatus;
  readonly source?: JournalEntrySource;
  /** ISO date (YYYY-MM-DD), inclusive lower bound on entry date. */
  readonly fromDate?: string;
  /** ISO date (YYYY-MM-DD), inclusive upper bound on entry date. */
  readonly toDate?: string;
  /** Every entry one source document posted — its own GL trail. */
  readonly sourceDocId?: string;
  /**
   * Substring of the entry number, the memo, or the source document's number.
   * In SQL, so a searched register is still a page rather than the whole
   * ledger read into memory and filtered (Q-8).
   */
  readonly search?: string;
  /** Restrict to entries produced by one of these document types. An empty array matches nothing. */
  readonly sourceDocTypes?: readonly string[];
  /**
   * One page of the register. ABSENT MEANS EVERYTHING, which is what
   * `GET /gl/journal-entries` used to serve unconditionally — every entry ever
   * posted. A route must supply a page.
   */
  readonly limit?: number;
  readonly offset?: number;
}

/** Aggregated debit/credit and net balance (debit − credit) for one account. */
export interface AccountBalance {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  /** debit − credit. Sign is convention-neutral; the caller applies naturalBalance. */
  readonly balance: Money;
}

/** One posted movement in an account's ledger. */
export interface AccountLedgerLine {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly memo: string | null;
  readonly debit: Money;
  readonly credit: Money;
}
