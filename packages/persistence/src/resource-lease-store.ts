import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS resource_lease (
  lease_key  TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export interface SqliteLeaseStore {
  tryAcquire(key: string, owner: string, expiresAt: number, now: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export async function ensureLeaseSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

/**
 * A lease row per contended resource in the database every server instance
 * shares. Acquisition is ONE statement: the upsert only takes over a row whose
 * lease has expired, so two instances cannot both succeed.
 */
export function createLeaseStore(db: SqlDb): SqliteLeaseStore {
  return {
    tryAcquire: async (key, owner, expiresAt, now) =>
      (
        await db.run(
          `INSERT INTO resource_lease (lease_key, owner, expires_at) VALUES (?, ?, ?)
           ON CONFLICT (lease_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
           WHERE resource_lease.expires_at <= ?`,
          [key, owner, expiresAt, now],
        )
      ).changes === 1,
    release: async (key, owner) => {
      await db.run(`DELETE FROM resource_lease WHERE lease_key = ? AND owner = ?`, [key, owner]);
    },
  };
}

export function createSqliteLeaseStore(input: SqliteConnectionInput): SqliteLeaseStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  return createLeaseStore(sqliteDb(sqlite));
}
