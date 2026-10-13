import { createHmac, randomBytes } from "node:crypto";
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
  get(account: string): StoredAccountLock | null;
  put(account: string, record: StoredAccountLock): void;
  delete(account: string): void;
  accountOfLink(linkHash: string): string | null;
}

export interface SqliteAccountLockStore extends AccountLockRows {
  lockedAccounts(): readonly string[];
  // SECURITY: names nobody holds are kept in the SAME table as real accounts,
  // under a keyed hash, so a lock on one survives a restart exactly as a real
  // one does and the two cannot be told apart by waiting for either to vanish.
  // Nothing written here can be read back as an account, listed, or unlocked
  // by code or link.
  readonly unknownNames: AccountLockRows;
}

export interface SqliteAccountLockStoreOptions {
  readonly now?: () => number;
  readonly failureWindowMs?: number;
  readonly maxUnknownNames?: number;
}

interface Row {
  failures: string;
  locked_at: number | null;
  unlock_hash: string | null;
  unlock_expires_at: number | null;
  unlock_attempts: number;
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

function lastOf(failures: readonly number[]): number | null {
  return failures.length === 0 ? null : Math.max(...failures);
}

export function createSqliteAccountLockStore(input: SqliteConnectionInput, options: SqliteAccountLockStoreOptions = {}): SqliteAccountLockStore {
  const { sqlite } = openSqliteConnection(input);
  const now = options.now ?? Date.now;
  const failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
  const maxUnknownNames = options.maxUnknownNames ?? DEFAULT_MAX_UNKNOWN_NAMES;
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
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sign_in_lock_unlocked ON sign_in_account_lock(${LAST_FAILURE_COLUMN}) WHERE locked_at IS NULL`);

  const get = sqlite.prepare(
    `SELECT failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts, unlock_link_hash FROM sign_in_account_lock WHERE account = ?`,
  );
  const put = sqlite.prepare(
    `INSERT INTO sign_in_account_lock (account, failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts, unlock_link_hash, ${LAST_FAILURE_COLUMN})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET
       failures = excluded.failures, locked_at = excluded.locked_at, unlock_hash = excluded.unlock_hash,
       unlock_expires_at = excluded.unlock_expires_at, unlock_attempts = excluded.unlock_attempts,
       unlock_link_hash = excluded.unlock_link_hash, ${LAST_FAILURE_COLUMN} = excluded.${LAST_FAILURE_COLUMN}`,
  );
  const remove = sqlite.prepare(`DELETE FROM sign_in_account_lock WHERE account = ?`);
  const byLink = sqlite.prepare(`SELECT account FROM sign_in_account_lock WHERE unlock_link_hash = ? AND NOT (account >= ? AND account < ?)`);
  const locked = sqlite.prepare(`SELECT account FROM sign_in_account_lock WHERE locked_at IS NOT NULL AND NOT (account >= ? AND account < ?) ORDER BY account`);
  const expire = sqlite.prepare(`DELETE FROM sign_in_account_lock WHERE locked_at IS NULL AND (${LAST_FAILURE_COLUMN} IS NULL OR ${LAST_FAILURE_COLUMN} <= ?)`);
  const unknownCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM sign_in_account_lock WHERE account >= ? AND account < ?`);
  const dropOldestUnknown = sqlite.prepare(
    `DELETE FROM sign_in_account_lock WHERE account IN (
       SELECT account FROM sign_in_account_lock WHERE account >= ? AND account < ? ORDER BY COALESCE(${LAST_FAILURE_COLUMN}, 0), rowid LIMIT ?
     )`,
  );

  function hashKey(): Buffer {
    const stored = sqlite.prepare(`SELECT secret FROM sign_in_lock_key WHERE id = 1`).get() as { secret: string } | undefined;
    if (stored) return Buffer.from(stored.secret, "hex");
    const secret = randomBytes(32);
    sqlite.prepare(`INSERT OR IGNORE INTO sign_in_lock_key (id, secret) VALUES (1, ?)`).run(secret.toString("hex"));
    return Buffer.from((sqlite.prepare(`SELECT secret FROM sign_in_lock_key WHERE id = 1`).get() as { secret: string }).secret, "hex");
  }
  let key: Buffer | null = null;
  const unknownKey = (name: string): string => `${UNKNOWN_PREFIX}${createHmac("sha256", (key ??= hashKey())).update(name).digest("hex")}`;

  function read(account: string): StoredAccountLock | null {
    const row = get.get(account) as Row | undefined;
    if (!row) return null;
    return {
      failures: parseFailures(row.failures),
      lockedAt: row.locked_at,
      unlockHash: row.unlock_hash,
      unlockExpiresAt: row.unlock_expires_at,
      unlockAttempts: row.unlock_attempts,
      unlockLinkHash: row.unlock_link_hash,
    };
  }

  function write(account: string, record: StoredAccountLock): void {
    expire.run(now() - failureWindowMs);
    put.run(account, JSON.stringify(record.failures), record.lockedAt, record.unlockHash, record.unlockExpiresAt, record.unlockAttempts, record.unlockLinkHash ?? null, lastOf(record.failures));
  }

  return {
    get: read,
    put: write,
    delete(account) {
      remove.run(account);
    },
    accountOfLink(linkHash) {
      return (byLink.get(linkHash, UNKNOWN_PREFIX, UNKNOWN_RANGE_END) as { account: string } | undefined)?.account ?? null;
    },
    lockedAccounts() {
      return (locked.all(UNKNOWN_PREFIX, UNKNOWN_RANGE_END) as { account: string }[]).map((row) => row.account);
    },
    unknownNames: {
      get: (name) => read(unknownKey(name)),
      put(name, record) {
        write(unknownKey(name), { ...record, unlockHash: null, unlockExpiresAt: null, unlockLinkHash: null });
        const over = (unknownCount.get(UNKNOWN_PREFIX, UNKNOWN_RANGE_END) as { n: number }).n - maxUnknownNames;
        if (over > 0) dropOldestUnknown.run(UNKNOWN_PREFIX, UNKNOWN_RANGE_END, over);
      },
      delete: (name) => void remove.run(unknownKey(name)),
      accountOfLink: () => null,
    },
  };
}
