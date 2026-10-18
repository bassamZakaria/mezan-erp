import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SequenceStore } from "@mezan/domain";

/**
 * SQLite-backed SequenceStore.
 *
 * Atomicity contract (docs/archive/plan.md §2.3 rule 5): each `increment` runs inside a
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

function counterKey(period: number | null, scope?: string | null): string {
  return `${period === null ? "" : String(period)}${scope ? `@${scope}` : ""}`;
}

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

  async increment(code: string, period: number | null, scope?: string | null): Promise<number> {
    // The scope rides in the period key rather than in a third column: an
    // unscoped counter keeps its exact existing row, so no migration is needed
    // and every number already issued keeps its meaning (D33).
    const p = counterKey(period, scope);
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

  /**
   * Read-only peek at the current counter value — never allocates a number.
   * Used by the sequences admin screen to show "Current Value" without
   * consuming one, unlike `increment`.
   */
  async peek(code: string, period: number | null, scope?: string | null): Promise<number> {
    const p = counterKey(period, scope);
    const row = this.read.get(code, p) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  /** Every counter row as stored: `period` is the raw key — `""`, a year, and an optional `@scope` suffix. */
  async counterRows(): Promise<readonly SequenceCounterRow[]> {
    return this.sqlite.prepare(`SELECT code, period, value FROM sequence_counter ORDER BY code, period`).all() as SequenceCounterRow[];
  }

  /**
   * Explicit, admin-guarded counter write — bypasses `increment`'s
   * gap-free allocation path entirely. Callers (the `/sequences/:code/counter`
   * route) must themselves refuse any value below the current counter: this
   * method performs no such check, since going backward is exactly what would
   * let two documents share a number.
   */
  async setCounter(code: string, period: number | null, value: number, scope?: string | null): Promise<void> {
    const p = counterKey(period, scope);
    await withSqliteTransaction(
      this.sqlite,
      async () => {
        this.sqlite
          .prepare(
            `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, ?)
             ON CONFLICT(code, period) DO UPDATE SET value = ?`,
          )
          .run(code, p, value, value);
      },
      "BEGIN IMMEDIATE",
    );
  }
}

export interface SequenceCounterRow {
  readonly code: string;
  readonly period: string;
  readonly value: number;
}

export interface SqliteSequenceStoreHandle extends SequenceStore {
  close(): void;
  peek(code: string, period: number | null, scope?: string | null): Promise<number>;
  counterRows(): Promise<readonly SequenceCounterRow[]>;
  setCounter(code: string, period: number | null, value: number, scope?: string | null): Promise<void>;
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
