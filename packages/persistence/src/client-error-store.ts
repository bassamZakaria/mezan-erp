import type Database from "better-sqlite3";
import { ensureInsertionOrder, insertionOrder } from "./sql/insertion-order.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS client_error (
  id           TEXT PRIMARY KEY,
  received_at  TEXT NOT NULL,
  platform     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  message      TEXT NOT NULL,
  stack        TEXT,
  route        TEXT,
  app_version  TEXT,
  user_agent   TEXT,
  request_id   TEXT,
  user_id      TEXT
);
CREATE INDEX IF NOT EXISTS idx_client_error_received ON client_error(received_at);
`;

export const CLIENT_ERRORS_KEPT = 500;

export interface ClientErrorRecord {
  readonly id: string;
  readonly receivedAt: string;
  readonly platform: string;
  readonly kind: string;
  readonly message: string;
  readonly stack: string | null;
  readonly route: string | null;
  readonly appVersion: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly userId: string | null;
}

interface ClientErrorRow {
  id: string;
  received_at: string;
  platform: string;
  kind: string;
  message: string;
  stack: string | null;
  route: string | null;
  app_version: string | null;
  user_agent: string | null;
  request_id: string | null;
  user_id: string | null;
}

export interface ClientErrorStore {
  record(error: ClientErrorRecord): Promise<void>;
  recent(limit: number): Promise<readonly ClientErrorRecord[]>;
  countSince(isoTime: string): Promise<number>;
}

function recordOf(row: ClientErrorRow): ClientErrorRecord {
  return {
    id: row.id,
    receivedAt: row.received_at,
    platform: row.platform,
    kind: row.kind,
    message: row.message,
    stack: row.stack,
    route: row.route,
    appVersion: row.app_version,
    userAgent: row.user_agent,
    requestId: row.request_id,
    userId: row.user_id,
  };
}

const COLUMNS = "id, received_at, platform, kind, message, stack, route, app_version, user_agent, request_id, user_id";

export async function ensureClientErrorSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  await ensureInsertionOrder(db, "client_error");
}

/**
 * The errors a tenant's clients (web, desktop renderer, mobile) reported. A report can arrive
 * without a session, so the table is CAPPED: every insert prunes it back to the newest
 * {@link CLIENT_ERRORS_KEPT} rows, and nobody can fill the disk by posting errors.
 */
export function createClientErrorStore(db: SqlDb): ClientErrorStore {
  const order = insertionOrder(db);
  return {
    record: (error) =>
      db.transaction(async () => {
        await db.run(
          `INSERT INTO client_error (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [error.id, error.receivedAt, error.platform, error.kind, error.message, error.stack, error.route, error.appVersion, error.userAgent, error.requestId, error.userId],
        );
        await db.run(
          `DELETE FROM client_error WHERE ${order} <= (SELECT ${order} FROM client_error ORDER BY ${order} DESC LIMIT 1 OFFSET ${CLIENT_ERRORS_KEPT})`,
        );
      }),
    recent: async (limit) =>
      (await db.all<ClientErrorRow>(`SELECT ${COLUMNS} FROM client_error ORDER BY received_at DESC, ${order} DESC LIMIT ?`, [limit])).map(recordOf),
    countSince: async (isoTime) => Number((await db.get<{ n: bigint }>("SELECT COUNT(*) AS n FROM client_error WHERE received_at >= ?", [isoTime]))!.n),
  };
}

export function createSqliteClientErrorStore(sqlite: Database.Database): ClientErrorStore {
  sqlite.exec(CREATE_TABLES);
  return createClientErrorStore(sqliteDb(sqlite));
}
