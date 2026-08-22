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
 * numbers have no gaps under concurrency (docs/plan.md §2.3 rule 5, §3 rule 5).
 * The domain depends on this interface only — no SQL, no driver (docs/plan.md
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
  /** Run `fn` inside one atomic transaction (BEGIN IMMEDIATE on SQLite). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Optional filters for {@link LedgerRepository.list}. */
export interface JournalListFilter {
  readonly status?: JournalEntryStatus;
  readonly source?: JournalEntrySource;
  /** ISO date (YYYY-MM-DD), inclusive lower bound on entry date. */
  readonly fromDate?: string;
  /** ISO date (YYYY-MM-DD), inclusive upper bound on entry date. */
  readonly toDate?: string;
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
