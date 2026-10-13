import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

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
  find(scope: string, key: string): IdempotentAnswer | null;
  record(scope: string, key: string, answer: IdempotentAnswer, recordedAt: string): void;
  forget(before: string): number;
}

interface Row {
  request_hash: string;
  status: number;
  body: string;
}

export function createSqliteIdempotentRequestStore(input: SqliteConnectionInput): IdempotentRequestStore & { readonly db: Database.Database } {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLE);
  const find = sqlite.prepare(`SELECT request_hash, status, body FROM idempotent_request WHERE scope = ? AND key = ?`);
  const record = sqlite.prepare(
    `INSERT INTO idempotent_request (scope, key, request_hash, status, body, recorded_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, key) DO NOTHING`,
  );
  const forget = sqlite.prepare(`DELETE FROM idempotent_request WHERE recorded_at < ?`);
  return {
    db: sqlite,
    find(scope, key) {
      const row = find.get(scope, key) as Row | undefined;
      return row ? { requestHash: row.request_hash, status: row.status, body: row.body } : null;
    },
    record(scope, key, answer, recordedAt) {
      record.run(scope, key, answer.requestHash, answer.status, answer.body, recordedAt);
    },
    forget(before) {
      return forget.run(before).changes;
    },
  };
}
