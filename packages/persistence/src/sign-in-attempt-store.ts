import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { ensureInsertionOrder, insertionOrder } from "./sql/insertion-order.js";
import { TransactionMode, type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

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
  update<T>(key: string, change: (held: StoredAttempt | null) => StoredAttemptChange<T>): Promise<T>;
  peek(key: string): Promise<StoredAttempt | null>;
  remove(key: string): Promise<void>;
  removeWithPrefix(prefix: string): Promise<void>;
  sweep(at: number, limits: { readonly decayMs: number; readonly maxRecords: number }): Promise<void>;
  size(): Promise<number>;
}

interface Row {
  failures: string;
  locked_until: bigint;
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

const attemptOf = (row: Row): StoredAttempt => ({ failures: parseFailures(row.failures), lockedUntil: Number(row.locked_until) });

export async function ensureAttemptSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
  await ensureInsertionOrder(db, "sign_in_attempt");
}

/**
 * SECURITY: the failure count lives in the database every server instance of
 * the tenant (or of the platform) shares, and every change to it is one
 * immediate (write-locked) transaction. A count held in process memory gives an
 * attacker who spreads guesses across N instances N times the free attempts
 * and N independent lockouts.
 */
export function createAttemptStore(db: SqlDb, scope: SignInAttemptScope): SqliteAttemptStore {
  const order = insertionOrder(db);
  const read = (key: string) => db.get<Row>(`SELECT failures, locked_until FROM sign_in_attempt WHERE scope = ? AND attempt_key = ?`, [scope, key]);
  const count = async () => Number((await db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM sign_in_attempt WHERE scope = ?`, [scope]))!.n);
  const remove = async (key: string) => {
    await db.run(`DELETE FROM sign_in_attempt WHERE scope = ? AND attempt_key = ?`, [scope, key]);
  };
  return {
    update: <T>(key: string, change: (held: StoredAttempt | null) => StoredAttemptChange<T>): Promise<T> =>
      db.transaction(async () => {
        const row = await read(key);
        const outcome = change(row ? attemptOf(row) : null);
        if (outcome.record === null) await remove(key);
        else if (outcome.record !== undefined) {
          await db.run(
            `INSERT INTO sign_in_attempt (scope, attempt_key, failures, locked_until, last_failure_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (scope, attempt_key) DO UPDATE SET
               failures = excluded.failures, locked_until = excluded.locked_until, last_failure_at = excluded.last_failure_at`,
            [scope, key, JSON.stringify(outcome.record.failures), outcome.record.lockedUntil, outcome.record.failures.at(-1) ?? 0],
          );
        }
        return outcome.result;
      }, TransactionMode.Immediate),
    async peek(key) {
      const row = await read(key);
      return row ? attemptOf(row) : null;
    },
    remove,
    removeWithPrefix: async (prefix) => {
      await db.run(`DELETE FROM sign_in_attempt WHERE scope = ? AND attempt_key >= ? AND attempt_key < ?`, [scope, prefix, prefixEnd(prefix)]);
    },
    sweep: (at, limits) =>
      db.transaction(async () => {
        await db.run(`DELETE FROM sign_in_attempt WHERE scope = ? AND locked_until <= ? AND last_failure_at <= ?`, [scope, at, at - limits.decayMs]);
        const over = (await count()) - limits.maxRecords;
        if (over > 0) {
          await db.run(
            `DELETE FROM sign_in_attempt WHERE scope = ? AND attempt_key IN (
               SELECT attempt_key FROM sign_in_attempt WHERE scope = ? ORDER BY last_failure_at, ${order} LIMIT ?
             )`,
            [scope, scope, over],
          );
        }
      }, TransactionMode.Immediate),
    size: count,
  };
}

export function createSqliteAttemptStore(input: SqliteConnectionInput, scope: SignInAttemptScope): SqliteAttemptStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  return createAttemptStore(sqliteDb(sqlite), scope);
}
