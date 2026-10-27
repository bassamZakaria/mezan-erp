import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SequenceStore } from "@mezan/domain";
import { TransactionMode, type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

// INVARIANT: each `increment` runs under the tenant write lock (BEGIN IMMEDIATE
// on SQLite, the per-tenant advisory lock on Postgres), so two callers can
// never observe the same counter value.
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sequence_counter (
  code   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  INTEGER NOT NULL,
  PRIMARY KEY (code, period)
);
`;

// The scope rides in the period key rather than in a third column: an unscoped
// counter keeps its exact existing row, so every number issued keeps its meaning (D33).
function counterKey(period: number | null, scope?: string | null): string {
  return `${period === null ? "" : String(period)}${scope ? `@${scope}` : ""}`;
}

class SqlSequenceStore implements SequenceStore {
  constructor(private readonly db: SqlDb) {}

  async increment(code: string, period: number | null, scope?: string | null): Promise<number> {
    const p = counterKey(period, scope);
    return this.db.transaction(async () => {
      const row = await this.db.get<{ value: bigint }>(
        `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, 1)
         ON CONFLICT(code, period) DO UPDATE SET value = sequence_counter.value + 1
         RETURNING value`,
        [code, p],
      );
      return Number(row!.value);
    }, TransactionMode.Immediate);
  }

  async peek(code: string, period: number | null, scope?: string | null): Promise<number> {
    const row = await this.db.get<{ value: bigint }>(`SELECT value FROM sequence_counter WHERE code = ? AND period = ?`, [code, counterKey(period, scope)]);
    return row ? Number(row.value) : 0;
  }

  async counterRows(): Promise<readonly SequenceCounterRow[]> {
    const rows = await this.db.all<{ code: string; period: string; value: bigint }>(`SELECT code, period, value FROM sequence_counter ORDER BY code, period`);
    return rows.map((row) => ({ code: row.code, period: row.period, value: Number(row.value) }));
  }

  // Bypasses `increment`'s gap-free allocation: the caller must refuse any
  // value below the current counter, or two documents can share a number.
  async setCounter(code: string, period: number | null, value: number, scope?: string | null): Promise<void> {
    const p = counterKey(period, scope);
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO sequence_counter (code, period, value) VALUES (?, ?, ?)
         ON CONFLICT(code, period) DO UPDATE SET value = excluded.value`,
        [code, p, value],
      );
    }, TransactionMode.Immediate);
  }
}

export interface SequenceCounterRow {
  readonly code: string;
  readonly period: string;
  readonly value: number;
}

export interface SequenceStoreHandle extends SequenceStore {
  peek(code: string, period: number | null, scope?: string | null): Promise<number>;
  counterRows(): Promise<readonly SequenceCounterRow[]>;
  setCounter(code: string, period: number | null, value: number, scope?: string | null): Promise<void>;
}

export interface SqliteSequenceStoreHandle extends SequenceStoreHandle {
  close(): void;
}

export async function ensureSequenceSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createSequenceStore(db: SqlDb): SequenceStoreHandle {
  return new SqlSequenceStore(db);
}

export function createSqliteSequenceStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSequenceStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createSequenceStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSequenceStoreHandle;
}
