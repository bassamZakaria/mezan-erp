import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, asc } from "drizzle-orm";
import {
  Money,
  type JournalEntry,
  type JournalRepository,
  type UnitOfWork,
} from "@mezan/domain";
import { schema, journalEntry, journalLine } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS journal_entry (
  id      TEXT PRIMARY KEY,
  date    TEXT NOT NULL,
  memo    TEXT NOT NULL,
  status  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_line (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   TEXT NOT NULL REFERENCES journal_entry(id),
  line_no    INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  debit      INTEGER NOT NULL,
  credit     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_line_entry ON journal_line(entry_id);
`;

class DrizzleJournalRepository implements JournalRepository {
  constructor(private readonly db: Db) {}

  async save(entry: JournalEntry): Promise<void> {
    this.db
      .insert(journalEntry)
      .values({
        id: entry.id,
        date: entry.date,
        memo: entry.memo,
        status: entry.status,
      })
      .run();

    entry.lines.forEach((line, index) => {
      this.db
        .insert(journalLine)
        .values({
          entryId: entry.id,
          lineNo: index,
          accountId: line.accountId,
          debit: line.debit.toScaledNumber(),
          credit: line.credit.toScaledNumber(),
        })
        .run();
    });
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const header = this.db
      .select()
      .from(journalEntry)
      .where(eq(journalEntry.id, id))
      .get();
    if (!header) return null;

    const lineRows = this.db
      .select()
      .from(journalLine)
      .where(eq(journalLine.entryId, id))
      .orderBy(asc(journalLine.lineNo))
      .all();

    return {
      id: header.id,
      date: header.date,
      memo: header.memo,
      status: header.status as "posted",
      lines: lineRows.map((row) => ({
        accountId: row.accountId,
        debit: Money.fromScaled(row.debit),
        credit: Money.fromScaled(row.credit),
      })),
    };
  }
}

/**
 * SQLite-backed UnitOfWork. better-sqlite3 is fully synchronous, so a manual
 * BEGIN/COMMIT/ROLLBACK is exact even behind the async port: the writes inside
 * `fn` execute synchronously between BEGIN and COMMIT.
 */
class SqliteUnitOfWork implements UnitOfWork {
  readonly journal: JournalRepository;

  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {
    this.journal = new DrizzleJournalRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN");
    try {
      const result = await fn(this);
      this.sqlite.exec("COMMIT");
      return result;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

export interface SqliteUnitOfWorkHandle extends UnitOfWork {
  close(): void;
}

/**
 * Create a SQLite-backed UnitOfWork. Pass ":memory:" for tests, or a file path
 * for a real (WAL) database — the desktop-edition shape.
 */
export function createSqliteUnitOfWork(
  path = ":memory:",
): SqliteUnitOfWorkHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);

  const db = drizzle(sqlite, { schema });
  const uow = new SqliteUnitOfWork(db, sqlite);

  return Object.assign(uow, {
    close: () => sqlite.close(),
  }) as SqliteUnitOfWorkHandle;
}
