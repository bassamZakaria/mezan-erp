import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sign_in_account_lock (
  account           TEXT PRIMARY KEY,
  failures          TEXT NOT NULL,
  locked_at         INTEGER,
  unlock_hash       TEXT,
  unlock_expires_at INTEGER,
  unlock_attempts   INTEGER NOT NULL DEFAULT 0
);
`;

export interface StoredAccountLock {
  readonly failures: readonly number[];
  readonly lockedAt: number | null;
  readonly unlockHash: string | null;
  readonly unlockExpiresAt: number | null;
  readonly unlockAttempts: number;
}

export interface SqliteAccountLockStore {
  get(account: string): StoredAccountLock | null;
  put(account: string, record: StoredAccountLock): void;
  delete(account: string): void;
  lockedAccounts(): readonly string[];
}

interface Row {
  failures: string;
  locked_at: number | null;
  unlock_hash: string | null;
  unlock_expires_at: number | null;
  unlock_attempts: number;
}

function parseFailures(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((at): at is number => typeof at === "number") : [];
  } catch {
    return [];
  }
}

export function createSqliteAccountLockStore(input: SqliteConnectionInput): SqliteAccountLockStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  const get = sqlite.prepare(
    `SELECT failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts FROM sign_in_account_lock WHERE account = ?`,
  );
  const put = sqlite.prepare(
    `INSERT INTO sign_in_account_lock (account, failures, locked_at, unlock_hash, unlock_expires_at, unlock_attempts)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (account) DO UPDATE SET
       failures = excluded.failures, locked_at = excluded.locked_at, unlock_hash = excluded.unlock_hash,
       unlock_expires_at = excluded.unlock_expires_at, unlock_attempts = excluded.unlock_attempts`,
  );
  const remove = sqlite.prepare(`DELETE FROM sign_in_account_lock WHERE account = ?`);
  const locked = sqlite.prepare(`SELECT account FROM sign_in_account_lock WHERE locked_at IS NOT NULL ORDER BY account`);
  return {
    get(account) {
      const row = get.get(account) as Row | undefined;
      if (!row) return null;
      return {
        failures: parseFailures(row.failures),
        lockedAt: row.locked_at,
        unlockHash: row.unlock_hash,
        unlockExpiresAt: row.unlock_expires_at,
        unlockAttempts: row.unlock_attempts,
      };
    },
    put(account, record) {
      put.run(account, JSON.stringify(record.failures), record.lockedAt, record.unlockHash, record.unlockExpiresAt, record.unlockAttempts);
    },
    delete(account) {
      remove.run(account);
    },
    lockedAccounts() {
      return (locked.all() as { account: string }[]).map((row) => row.account);
    },
  };
}
