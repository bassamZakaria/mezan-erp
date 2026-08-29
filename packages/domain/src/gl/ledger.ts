import type { Money } from "../money/index.js";
import type { JournalEntry, JournalEntrySource, JournalEntryStatus } from "../journal.js";

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
  findById(id: string): Promise<JournalEntry | null>;
  findByEntryNo(entryNo: string): Promise<JournalEntry | null>;
  list(filter?: JournalListFilter): Promise<readonly JournalEntry[]>;
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
  /** Run `fn` inside one atomic transaction (BEGIN IMMEDIATE on SQLite). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
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
}

/** One posted journal line with its full dimensional context. */
export interface PostedLine {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly source: JournalEntrySource;
  readonly accountId: string;
  readonly costCenterId: string | null;
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
