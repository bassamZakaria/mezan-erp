import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { ensureInsertionOrder, insertionOrder } from "./sql/insertion-order.js";
import { type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS rate_window (
  scope     TEXT NOT NULL,
  hit_key   TEXT NOT NULL,
  hits      INTEGER NOT NULL,
  reset_at  INTEGER NOT NULL,
  PRIMARY KEY (scope, hit_key)
);
CREATE INDEX IF NOT EXISTS idx_rate_window_reset ON rate_window(scope, reset_at);
`;

export interface RateWindowRow {
  readonly hits: number;
  readonly resetAt: number;
}

export interface SqliteRateWindowStore {
  read(key: string, at: number): Promise<RateWindowRow | null>;
  hit(key: string, at: number, windowMs: number): Promise<void>;
  sweep(at: number, maxRecords: number): Promise<void>;
}

export async function ensureRateWindowSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
  await ensureInsertionOrder(db, "rate_window");
}

/**
 * Fixed-window counters for public endpoints, in the database every server
 * instance shares. `hit` is one upsert statement, so concurrent instances
 * cannot lose a count.
 */
export function createRateWindowStore(db: SqlDb, scope: string): SqliteRateWindowStore {
  const order = insertionOrder(db);
  return {
    async read(key) {
      const row = await db.get<{ hits: bigint; reset_at: bigint }>(`SELECT hits, reset_at FROM rate_window WHERE scope = ? AND hit_key = ?`, [scope, key]);
      return row ? { hits: Number(row.hits), resetAt: Number(row.reset_at) } : null;
    },
    async hit(key, at, windowMs) {
      const resetAt = at + windowMs;
      await db.run(
        `INSERT INTO rate_window (scope, hit_key, hits, reset_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (scope, hit_key) DO UPDATE SET
           hits = CASE WHEN rate_window.reset_at <= ? THEN 1 ELSE rate_window.hits + 1 END,
           reset_at = CASE WHEN rate_window.reset_at <= ? THEN ? ELSE rate_window.reset_at END`,
        [scope, key, resetAt, at, at, resetAt],
      );
    },
    async sweep(at, maxRecords) {
      await db.run(
        `DELETE FROM rate_window WHERE scope = ? AND (reset_at <= ? OR hit_key NOT IN (SELECT hit_key FROM rate_window WHERE scope = ? AND reset_at > ? ORDER BY reset_at DESC, ${order} DESC LIMIT ?))`,
        [scope, at, scope, at, maxRecords],
      );
    },
  };
}

export function createSqliteRateWindowStore(input: SqliteConnectionInput, scope: string): SqliteRateWindowStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  return createRateWindowStore(sqliteDb(sqlite), scope);
}
