import { createHmac, randomBytes } from "node:crypto";
import { ensureInsertionOrder, insertionOrder } from "./sql/insertion-order.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sign_in_account_lock (
  account           TEXT PRIMARY KEY,
  failures          TEXT NOT NULL,
  locked_at         INTEGER,
  unlock_hash       TEXT,
  unlock_expires_at INTEGER,
  unlock_attempts   INTEGER NOT NULL DEFAULT 0,
  unlock_link_hash  TEXT,
  last_failure_at   INTEGER
);
CREATE TABLE IF NOT EXISTS sign_in_lock_key (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL
);
`;
const CREATE_UNLOCKED_INDEX = `CREATE INDEX IF NOT EXISTS idx_sign_in_lock_unlocked ON sign_in_account_lock(last_failure_at) WHERE locked_at IS NULL;`;
const LINK_COLUMN = "unlock_link_hash";
const LAST_FAILURE_COLUMN = "last_failure_at";
const UNKNOWN_PREFIX = "unknown:";
const UNKNOWN_RANGE_END = "unknown;";
const DEFAULT_FAILURE_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_UNKNOWN_NAMES = 100_000;

export interface StoredAccountLock {
  readonly failures: readonly number[];
  readonly lockedAt: number | null;
  readonly unlockHash: string | null;
  readonly unlockExpiresAt: number | null;
  readonly unlockAttempts: number;
  readonly unlockLinkHash?: string | null;
}

export interface AccountLockRows {
  get(account: string): Promise<StoredAccountLock | null>;
  put(account: string, record: StoredAccountLock): Promise<void>;
  delete(account: string): Promise<void>;
  accountOfLink(linkHash: string): Promise<string | null>;
}

export interface AccountLockStoreHandle extends AccountLockRows {
  lockedAccounts(): Promise<readonly string[]>;
  // SECURITY: names nobody holds are kept in the SAME table as real accounts,
  // under a keyed hash, so a lock on one survives a restart exactly as a real
  // one does and the two cannot be told apart by waiting for either to vanish.
  // Nothing written here can be read back as an account, listed, or unlocked
  // by code or link.
  readonly unknownNames: AccountLockRows;
}

export type SqliteAccountLockStore = AccountLockStoreHandle;

export interface AccountLockStoreOptions {
  readonly now?: () => number;
  readonly failureWindowMs?: number;
  readonly maxUnknownNames?: number;
}

export type SqliteAccountLockStoreOptions = AccountLockStoreOptions;

interface Row {
  failures: string;
  locked_at: bigint | number | null;
  unlock_hash: string | null;
  unlock_expires_at: bigint | number | null;
  unlock_attempts: bigint | number;
  unlock_link_hash: string | null;
}

function parseFailures(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((at): at is number => typeof at === "number") : [];
  } catch {
    return [];
  }
}

const numberOrNull = (value: bigint | number | null): number | null => (value === null ? null : Number(value));

function lastOf(failures: readonly number[]): number | null {
  return failures.length === 0 ? null : Math.max(...failures);
}

export async function ensureAccountLockSchema(db: SqlDb): Promise<void> {
  await db.applySchema(`${CREATE_TABLE}${CREATE_UNLOCKED_INDEX}`);
  await ensureInsertionOrder(db, "sign_in_account_lock");
}

export function createAccountLockStore(db: SqlDb, options: AccountLockStoreOptions = {}): AccountLockStoreHandle {
  const now = options.now ?? Date.now;
  const failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
  const maxUnknownNames = options.maxUnknownNames ?? DEFAULT_MAX_UNKNOWN_NAMES;
  const UPSERT = `INSERT INTO sign_in_account_lock (account, failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts, unlock_link_hash, ${LAST_FAILURE_COLUMN})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET
       failures = excluded.failures, locked_at = excluded.locked_at, unlock_hash = excluded.unlock_hash,
       unlock_expires_at = excluded.unlock_expires_at, unlock_attempts = excluded.unlock_attempts,
       unlock_link_hash = excluded.unlock_link_hash, ${LAST_FAILURE_COLUMN} = excluded.${LAST_FAILURE_COLUMN}`;
  const remove = (account: string) => db.run(`DELETE FROM sign_in_account_lock WHERE account = ?`, [account]);

  const readSecret = async (): Promise<string | undefined> =>
    (await db.get<{ secret: string }>(`SELECT secret FROM sign_in_lock_key WHERE id = 1`))?.secret;
  async function hashKey(): Promise<Buffer> {
    const stored = await readSecret();
    if (stored) return Buffer.from(stored, "hex");
    await db.run(`INSERT INTO sign_in_lock_key (id, secret) VALUES (1, ?) ON CONFLICT (id) DO NOTHING`, [randomBytes(32).toString("hex")]);
    return Buffer.from((await readSecret())!, "hex");
  }
  let key: Buffer | null = null;
  const unknownKey = async (name: string): Promise<string> =>
    `${UNKNOWN_PREFIX}${createHmac("sha256", (key ??= await hashKey())).update(name).digest("hex")}`;

  async function read(account: string): Promise<StoredAccountLock | null> {
    const row = await db.get<Row>(
      `SELECT failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts, unlock_link_hash FROM sign_in_account_lock WHERE account = ?`,
      [account],
    );
    if (!row) return null;
    return {
      failures: parseFailures(row.failures),
      lockedAt: numberOrNull(row.locked_at),
      unlockHash: row.unlock_hash,
      unlockExpiresAt: numberOrNull(row.unlock_expires_at),
      unlockAttempts: Number(row.unlock_attempts),
      unlockLinkHash: row.unlock_link_hash,
    };
  }

  async function write(account: string, record: StoredAccountLock): Promise<void> {
    await db.run(`DELETE FROM sign_in_account_lock WHERE locked_at IS NULL AND (${LAST_FAILURE_COLUMN} IS NULL OR ${LAST_FAILURE_COLUMN} <= ?)`, [
      now() - failureWindowMs,
    ]);
    await db.run(UPSERT, [
      account,
      JSON.stringify(record.failures),
      record.lockedAt,
      record.unlockHash,
      record.unlockExpiresAt,
      record.unlockAttempts,
      record.unlockLinkHash ?? null,
      lastOf(record.failures),
    ]);
  }

  return {
    get: read,
    put: write,
    async delete(account) {
      await remove(account);
    },
    async accountOfLink(linkHash) {
      const row = await db.get<{ account: string }>(
        `SELECT account FROM sign_in_account_lock WHERE unlock_link_hash = ? AND NOT (account >= ? AND account < ?)`,
        [linkHash, UNKNOWN_PREFIX, UNKNOWN_RANGE_END],
      );
      return row?.account ?? null;
    },
    async lockedAccounts() {
      const rows = await db.all<{ account: string }>(
        `SELECT account FROM sign_in_account_lock WHERE locked_at IS NOT NULL AND NOT (account >= ? AND account < ?) ORDER BY account`,
        [UNKNOWN_PREFIX, UNKNOWN_RANGE_END],
      );
      return rows.map((row) => row.account);
    },
    unknownNames: {
      get: async (name) => read(await unknownKey(name)),
      async put(name, record) {
        await write(await unknownKey(name), { ...record, unlockHash: null, unlockExpiresAt: null, unlockLinkHash: null });
        const counted = await db.get<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM sign_in_account_lock WHERE account >= ? AND account < ?`, [
          UNKNOWN_PREFIX,
          UNKNOWN_RANGE_END,
        ]);
        const over = Number(counted?.n ?? 0) - maxUnknownNames;
        if (over > 0) {
          await db.run(
            `DELETE FROM sign_in_account_lock WHERE account IN (
               SELECT account FROM sign_in_account_lock WHERE account >= ? AND account < ? ORDER BY COALESCE(${LAST_FAILURE_COLUMN}, 0), ${insertionOrder(db)} LIMIT ?
             )`,
            [UNKNOWN_PREFIX, UNKNOWN_RANGE_END, over],
          );
        }
      },
      delete: async (name) => void (await remove(await unknownKey(name))),
      accountOfLink: async () => null,
    },
  };
}

export function createSqliteAccountLockStore(input: SqliteConnectionInput, options: SqliteAccountLockStoreOptions = {}): SqliteAccountLockStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  const columns = new Set((sqlite.prepare(`PRAGMA table_info(sign_in_account_lock)`).all() as { name: string }[]).map((column) => column.name));
  if (!columns.has(LINK_COLUMN)) sqlite.exec(`ALTER TABLE sign_in_account_lock ADD COLUMN ${LINK_COLUMN} TEXT`);
  if (!columns.has(LAST_FAILURE_COLUMN)) {
    sqlite.exec(`ALTER TABLE sign_in_account_lock ADD COLUMN ${LAST_FAILURE_COLUMN} INTEGER`);
    const backfill = sqlite.prepare(`UPDATE sign_in_account_lock SET ${LAST_FAILURE_COLUMN} = ? WHERE account = ?`);
    for (const row of sqlite.prepare(`SELECT account, failures FROM sign_in_account_lock`).all() as { account: string; failures: string }[]) {
      backfill.run(lastOf(parseFailures(row.failures)), row.account);
    }
  }
  sqlite.exec(CREATE_UNLOCKED_INDEX);
  return createAccountLockStore(sqliteDb(sqlite), options);
}
