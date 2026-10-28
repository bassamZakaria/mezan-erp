import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS idempotent_request (
  scope        TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status       INTEGER NOT NULL,
  body         TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotent_request_recorded ON idempotent_request(recorded_at);
`;

export interface IdempotentAnswer {
  readonly requestHash: string;
  readonly status: number;
  readonly body: string;
}

export interface IdempotentRequestStore {
  find(scope: string, key: string): Promise<IdempotentAnswer | null>;
  record(scope: string, key: string, answer: IdempotentAnswer, recordedAt: string): Promise<void>;
  forget(before: string): Promise<number>;
}

interface Row {
  request_hash: string;
  status: bigint;
  body: string;
}

export async function ensureIdempotentRequestSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createIdempotentRequestStore(db: SqlDb): IdempotentRequestStore {
  return {
    async find(scope, key) {
      const row = await db.get<Row>(`SELECT request_hash, status, body FROM idempotent_request WHERE scope = ? AND key = ?`, [scope, key]);
      return row ? { requestHash: row.request_hash, status: Number(row.status), body: row.body } : null;
    },
    async record(scope, key, answer, recordedAt) {
      await db.run(
        `INSERT INTO idempotent_request (scope, key, request_hash, status, body, recorded_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope, key) DO NOTHING`,
        [scope, key, answer.requestHash, answer.status, answer.body, recordedAt],
      );
    },
    async forget(before) {
      return (await db.run(`DELETE FROM idempotent_request WHERE recorded_at < ?`, [before])).changes;
    },
  };
}

export function createSqliteIdempotentRequestStore(input: SqliteConnectionInput): IdempotentRequestStore & { readonly db: Database.Database } {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createIdempotentRequestStore(sqliteDb(sqlite)), { db: sqlite });
}
