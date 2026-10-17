import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

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
  read(key: string, at: number): RateWindowRow | null;
  hit(key: string, at: number, windowMs: number): void;
  sweep(at: number, maxRecords: number): void;
}

/**
 * Fixed-window counters for public endpoints, in the database every server
 * instance shares. `hit` is one upsert statement, so concurrent instances
 * cannot lose a count.
 */
export function createSqliteRateWindowStore(input: SqliteConnectionInput, scope: string): SqliteRateWindowStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  const read = sqlite.prepare(`SELECT hits, reset_at FROM rate_window WHERE scope = ? AND hit_key = ?`);
  const hit = sqlite.prepare(
    `INSERT INTO rate_window (scope, hit_key, hits, reset_at) VALUES (@scope, @key, 1, @at + @window)
     ON CONFLICT (scope, hit_key) DO UPDATE SET
       hits = CASE WHEN rate_window.reset_at <= @at THEN 1 ELSE rate_window.hits + 1 END,
       reset_at = CASE WHEN rate_window.reset_at <= @at THEN @at + @window ELSE rate_window.reset_at END`,
  );
  const expire = sqlite.prepare(`DELETE FROM rate_window WHERE scope = ? AND reset_at <= ?`);
  const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM rate_window WHERE scope = ?`);
  const dropOldest = sqlite.prepare(
    `DELETE FROM rate_window WHERE rowid IN (SELECT rowid FROM rate_window WHERE scope = ? ORDER BY reset_at, rowid LIMIT ?)`,
  );
  const trim = sqlite.transaction((at: number, maxRecords: number) => {
    expire.run(scope, at);
    const over = (count.get(scope) as { n: number }).n - maxRecords;
    if (over > 0) dropOldest.run(scope, over);
  });
  return {
    read(key) {
      const row = read.get(scope, key) as { hits: number; reset_at: number } | undefined;
      return row ? { hits: row.hits, resetAt: row.reset_at } : null;
    },
    hit: (key, at, windowMs) => void hit.run({ scope, key, at, window: windowMs }),
    sweep: (at, maxRecords) => trim.immediate(at, maxRecords),
  };
}
