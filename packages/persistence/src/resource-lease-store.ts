import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS resource_lease (
  lease_key  TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export interface SqliteLeaseStore {
  tryAcquire(key: string, owner: string, expiresAt: number, now: number): boolean;
  release(key: string, owner: string): void;
}

/**
 * A lease row per contended resource in the database every server instance
 * shares. Acquisition is ONE statement: the upsert only takes over a row whose
 * lease has expired, so two instances cannot both succeed.
 */
export function createSqliteLeaseStore(input: SqliteConnectionInput): SqliteLeaseStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  const acquire = sqlite.prepare(
    `INSERT INTO resource_lease (lease_key, owner, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (lease_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
     WHERE resource_lease.expires_at <= ?`,
  );
  const release = sqlite.prepare(`DELETE FROM resource_lease WHERE lease_key = ? AND owner = ?`);
  return {
    tryAcquire: (key, owner, expiresAt, now) => acquire.run(key, owner, expiresAt, now).changes === 1,
    release: (key, owner) => void release.run(key, owner),
  };
}
