import Database from "better-sqlite3";
import {
  Money,
  NextNumberService,
  type JournalEntry,
  type JournalEntrySource,
  type JournalEntryStatus,
  type JournalLine,
  type SequenceStore,
  type AccountBalance,
  type AccountLedgerLine,
  type JournalListFilter,
  type LedgerRepository,
} from "@mezan/domain";

/**
 * SQLite-backed {@link LedgerRepository} — the real GL ledger store.
 *
 * One connection owns `journal_entry`, `journal_line` and `sequence_counter`
 * together, because number allocation and the entry insert must be atomic:
 * `transaction()` opens `BEGIN IMMEDIATE` (SQLite's write lock at statement
 * start), and the numbering `increment` runs plain SQL *inside* that lock, so
 * two concurrent posts can never share or skip a JE number (docs/plan.md §2.3
 * rule 5 / §3 rule 5). Money is stored as INTEGER at scale 1e-6 and read back
 * with `safeIntegers()` so a large ledger's sums never touch IEEE-754.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS journal_entry (
  id                   TEXT PRIMARY KEY,
  entry_no             TEXT UNIQUE,
  date                 TEXT NOT NULL,
  memo                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  source               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  posted_at            TEXT,
  reverses_entry_id    TEXT REFERENCES journal_entry(id),
  reversed_by_entry_id TEXT REFERENCES journal_entry(id)
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_date ON journal_entry(date);
CREATE INDEX IF NOT EXISTS idx_journal_entry_status ON journal_entry(status);
CREATE TABLE IF NOT EXISTS journal_line (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   TEXT NOT NULL REFERENCES journal_entry(id),
  line_no    INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  debit      INTEGER NOT NULL,
  credit     INTEGER NOT NULL,
  memo       TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_line_entry ON journal_line(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_line_account ON journal_line(account_id);
CREATE TABLE IF NOT EXISTS sequence_counter (
  code   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  INTEGER NOT NULL,
  PRIMARY KEY (code, period)
);
`;

interface EntryRow {
  id: string;
  entry_no: string | null;
  date: string;
  memo: string;
  status: string;
  source: string;
  created_at: string;
  posted_at: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
}

interface LineRow {
  line_no: bigint;
  account_id: string;
  debit: bigint;
  credit: bigint;
  memo: string | null;
}

/**
 * A {@link SequenceStore} bound to a shared connection that does NOT open its
 * own transaction — it runs inside the ledger `transaction()`'s BEGIN IMMEDIATE.
 */
class SharedSequenceStore implements SequenceStore {
  private readonly upsert: Database.Statement;
  private readonly read: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, 1)
       ON CONFLICT(code, period) DO UPDATE SET value = value + 1`,
    );
    this.read = sqlite.prepare(
      `SELECT value FROM sequence_counter WHERE code = ? AND period = ?`,
    );
  }

  async increment(code: string, period: number | null): Promise<number> {
    const p = period === null ? "" : String(period);
    this.upsert.run(code, p);
    const row = this.read.get(code, p) as { value: number };
    return row.value;
  }
}

class SqliteLedgerRepository implements LedgerRepository {
  private readonly insertEntry: Database.Statement;
  private readonly updateEntry: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly selectEntryById: Database.Statement;
  private readonly selectEntryByNo: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertEntry = sqlite.prepare(`
      INSERT INTO journal_entry
        (id, entry_no, date, memo, status, source, created_at, posted_at, reverses_entry_id, reversed_by_entry_id)
      VALUES
        (@id, @entry_no, @date, @memo, @status, @source, @created_at, @posted_at, @reverses_entry_id, @reversed_by_entry_id)
    `);
    this.updateEntry = sqlite.prepare(`
      UPDATE journal_entry SET
        entry_no = @entry_no,
        status = @status,
        posted_at = @posted_at,
        reversed_by_entry_id = @reversed_by_entry_id
      WHERE id = @id
    `);
    this.insertLine = sqlite.prepare(`
      INSERT INTO journal_line (entry_id, line_no, account_id, debit, credit, memo)
      VALUES (@entry_id, @line_no, @account_id, @debit, @credit, @memo)
    `);
    this.selectEntryById = sqlite.prepare(`SELECT * FROM journal_entry WHERE id = ?`);
    this.selectEntryByNo = sqlite.prepare(`SELECT * FROM journal_entry WHERE entry_no = ?`);
    this.selectLines = sqlite
      .prepare(
        `SELECT line_no, account_id, debit, credit, memo FROM journal_line WHERE entry_id = ? ORDER BY line_no`,
      )
      .safeIntegers();
  }

  async save(entry: JournalEntry): Promise<void> {
    this.insertEntry.run(entryParams(entry));
    entry.lines.forEach((line, index) => {
      this.insertLine.run({
        entry_id: entry.id,
        line_no: index,
        account_id: line.accountId,
        debit: line.debit.toScaledNumber(),
        credit: line.credit.toScaledNumber(),
        memo: line.memo ?? null,
      });
    });
  }

  async update(entry: JournalEntry): Promise<void> {
    this.updateEntry.run({
      id: entry.id,
      entry_no: entry.entryNo ?? null,
      status: entry.status,
      posted_at: entry.postedAt ?? null,
      reversed_by_entry_id: entry.reversedByEntryId ?? null,
    });
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const row = this.selectEntryById.get(id) as EntryRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async findByEntryNo(entryNo: string): Promise<JournalEntry | null> {
    const row = this.selectEntryByNo.get(entryNo) as EntryRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter: JournalListFilter = {}): Promise<readonly JournalEntry[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.source) {
      clauses.push("source = ?");
      params.push(filter.source);
    }
    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM journal_entry ${where} ORDER BY date, id`)
      .all(...params) as EntryRow[];
    return rows.map((row) => this.hydrate(row));
  }

  async accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance> {
    const params: unknown[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    const row = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.account_id = ?
            AND je.status IN ('posted', 'reversed')
            ${dateClause}`,
      )
      .safeIntegers()
      .get(...params) as { debit: bigint; credit: bigint };
    return {
      accountId,
      debit: Money.fromScaled(row.debit),
      credit: Money.fromScaled(row.credit),
      balance: Money.fromScaled(row.debit - row.credit),
    };
  }

  async accountLedger(accountId: string, asOfDate?: string): Promise<readonly AccountLedgerLine[]> {
    const params: unknown[] = [accountId];
    let dateClause = "";
    if (asOfDate) {
      dateClause = "AND je.date <= ?";
      params.push(asOfDate);
    }
    const rows = this.sqlite
      .prepare(
        `SELECT je.id AS entry_id, je.entry_no AS entry_no, je.date AS date,
                jl.memo AS memo, jl.debit AS debit, jl.credit AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.account_id = ?
            AND je.status IN ('posted', 'reversed')
            ${dateClause}
          ORDER BY je.date, je.id, jl.line_no`,
      )
      .safeIntegers()
      .all(...params) as Array<{
      entry_id: string;
      entry_no: string | null;
      date: string;
      memo: string | null;
      debit: bigint;
      credit: bigint;
    }>;
    return rows.map((r) => ({
      entryId: r.entry_id,
      entryNo: r.entry_no,
      date: r.date,
      memo: r.memo,
      debit: Money.fromScaled(r.debit),
      credit: Money.fromScaled(r.credit),
    }));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  private hydrate(row: EntryRow): JournalEntry {
    const lineRows = this.selectLines.all(row.id) as LineRow[];
    const lines: JournalLine[] = lineRows.map((l) => ({
      accountId: l.account_id,
      debit: Money.fromScaled(l.debit),
      credit: Money.fromScaled(l.credit),
      memo: l.memo,
    }));
    return {
      id: row.id,
      entryNo: row.entry_no,
      date: row.date,
      memo: row.memo,
      status: row.status as JournalEntryStatus,
      source: row.source as JournalEntrySource,
      lines,
      createdAt: row.created_at,
      postedAt: row.posted_at,
      reversesEntryId: row.reverses_entry_id,
      reversedByEntryId: row.reversed_by_entry_id,
    };
  }
}

function entryParams(entry: JournalEntry) {
  return {
    id: entry.id,
    entry_no: entry.entryNo ?? null,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    source: entry.source ?? "manual",
    created_at: entry.createdAt ?? new Date().toISOString(),
    posted_at: entry.postedAt ?? null,
    reverses_entry_id: entry.reversesEntryId ?? null,
    reversed_by_entry_id: entry.reversedByEntryId ?? null,
  };
}

export interface SqliteLedgerStoreHandle extends LedgerRepository {
  /** JE numbering engine bound to the SAME connection — pass as `deps.numbering`. */
  readonly numbering: NextNumberService;
  close(): void;
}

/**
 * Open a SQLite-backed ledger store. ":memory:" for tests, a file path for a
 * real (WAL) desktop database. The returned handle is both the
 * {@link LedgerRepository} and the connection-bound numbering engine, so the
 * GL engine's `deps.ledger` and `deps.numbering` share one transaction.
 */
export function createSqliteLedgerStore(path = ":memory:"): SqliteLedgerStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const repo = new SqliteLedgerRepository(sqlite);
  const numbering = new NextNumberService(new SharedSequenceStore(sqlite));
  return Object.assign(repo, {
    numbering,
    close: () => sqlite.close(),
  }) as SqliteLedgerStoreHandle;
}
