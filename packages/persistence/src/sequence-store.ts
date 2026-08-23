import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SequenceStore } from "@mezan/domain";

/**
 * SQLite-backed SequenceStore.
 *
 * Atomicity contract (docs/plan.md §2.3 rule 5): each `increment` runs inside a
 * `BEGIN IMMEDIATE` transaction, which acquires SQLite's RESERVED write lock at
 * the START of the statement rather than lazily on first write. That closes the
 * read-modify-write race entirely — a second caller blocks until the first
 * COMMITs, so two callers can never observe the same counter value. The counter
 * lives in a single row per (code, period); there is no SELECT ... FOR UPDATE in
 * SQLite, so the immediate write lock is the equivalent guarantee.
 *
 * better-sqlite3 is fully synchronous, so the whole read-modify-write completes
 * between BEGIN IMMEDIATE and COMMIT with no interleaving.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sequence_counter (
  code   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  INTEGER NOT NULL,
  PRIMARY KEY (code, period)
);
`;

class SqliteSequenceStore implements SequenceStore {
  private readonly upsert: Database.Statement;
  private readonly read: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
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
    return withSqliteTransaction(
      this.sqlite,
      async () => {
        this.upsert.run(code, p);
        const row = this.read.get(code, p) as { value: number };
        return row.value;
      },
      "BEGIN IMMEDIATE",
    );
  }
}

export interface SqliteSequenceStoreHandle extends SequenceStore {
  close(): void;
}

/** Open a SQLite-backed SequenceStore. ":memory:" for tests, a path for real. */
export function createSqliteSequenceStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSequenceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteSequenceStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSequenceStoreHandle;
}
