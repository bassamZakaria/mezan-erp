import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sign_in_attempt (
  scope           TEXT NOT NULL,
  attempt_key     TEXT NOT NULL,
  failures        TEXT NOT NULL,
  locked_until    INTEGER NOT NULL,
  last_failure_at INTEGER NOT NULL,
  PRIMARY KEY (scope, attempt_key)
);
CREATE INDEX IF NOT EXISTS idx_sign_in_attempt_last ON sign_in_attempt(scope, last_failure_at);
`;

export enum SignInAttemptScope {
  Ladder = "ladder",
  Source = "source",
}

export interface StoredAttempt {
  failures: number[];
  lockedUntil: number;
}

export interface StoredAttemptChange<T> {
  readonly record?: StoredAttempt | null;
  readonly result: T;
}

export interface SqliteAttemptStore {
  update<T>(key: string, change: (held: StoredAttempt | null) => StoredAttemptChange<T>): T;
  peek(key: string): StoredAttempt | null;
  remove(key: string): void;
  removeWithPrefix(prefix: string): void;
  sweep(at: number, limits: { readonly decayMs: number; readonly maxRecords: number }): void;
  size(): number;
}

interface Row {
  failures: string;
  locked_until: number;
}

function parseFailures(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((at): at is number => typeof at === "number") : [];
  } catch {
    return [];
  }
}

function prefixEnd(prefix: string): string {
  return `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;
}

/**
 * SECURITY: the failure count lives in the database every server instance of
 * the tenant (or of the platform) shares, and every change to it is one
 * `BEGIN IMMEDIATE` transaction. A count held in process memory gives an
 * attacker who spreads guesses across N instances N times the free attempts
 * and N independent lockouts.
 */
export function createSqliteAttemptStore(input: SqliteConnectionInput, scope: SignInAttemptScope): SqliteAttemptStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);

  const get = sqlite.prepare(`SELECT failures, locked_until FROM sign_in_attempt WHERE scope = ? AND attempt_key = ?`);
  const put = sqlite.prepare(
    `INSERT INTO sign_in_attempt (scope, attempt_key, failures, locked_until, last_failure_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, attempt_key) DO UPDATE SET
       failures = excluded.failures, locked_until = excluded.locked_until, last_failure_at = excluded.last_failure_at`,
  );
  const remove = sqlite.prepare(`DELETE FROM sign_in_attempt WHERE scope = ? AND attempt_key = ?`);
  const removeRange = sqlite.prepare(`DELETE FROM sign_in_attempt WHERE scope = ? AND attempt_key >= ? AND attempt_key < ?`);
  const expire = sqlite.prepare(`DELETE FROM sign_in_attempt WHERE scope = ? AND locked_until <= ? AND last_failure_at <= ?`);
  const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM sign_in_attempt WHERE scope = ?`);
  const dropOldest = sqlite.prepare(
    `DELETE FROM sign_in_attempt WHERE rowid IN (
       SELECT rowid FROM sign_in_attempt WHERE scope = ? ORDER BY last_failure_at, rowid LIMIT ?
     )`,
  );

  const exchange = sqlite.transaction(<T>(key: string, change: (held: StoredAttempt | null) => StoredAttemptChange<T>): T => {
    const row = get.get(scope, key) as Row | undefined;
    const outcome = change(row ? { failures: parseFailures(row.failures), lockedUntil: row.locked_until } : null);
    if (outcome.record === null) remove.run(scope, key);
    else if (outcome.record !== undefined) {
      put.run(scope, key, JSON.stringify(outcome.record.failures), outcome.record.lockedUntil, outcome.record.failures.at(-1) ?? 0);
    }
    return outcome.result;
  });

  const trim = sqlite.transaction((at: number, limits: { readonly decayMs: number; readonly maxRecords: number }) => {
    expire.run(scope, at, at - limits.decayMs);
    const over = (count.get(scope) as { n: number }).n - limits.maxRecords;
    if (over > 0) dropOldest.run(scope, over);
  });

  return {
    update: <T>(key: string, change: (held: StoredAttempt | null) => StoredAttemptChange<T>): T => exchange.immediate(key, change) as T,
    peek(key) {
      const row = get.get(scope, key) as Row | undefined;
      return row ? { failures: parseFailures(row.failures), lockedUntil: row.locked_until } : null;
    },
    remove: (key) => void remove.run(scope, key),
    removeWithPrefix: (prefix) => void removeRange.run(scope, prefix, prefixEnd(prefix)),
    sweep: (at, limits) => trim.immediate(at, limits),
    size: () => (count.get(scope) as { n: number }).n,
  };
}
