import type Database from "better-sqlite3";

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
  record(error: ClientErrorRecord): void;
  recent(limit: number): readonly ClientErrorRecord[];
  countSince(isoTime: string): number;
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

/**
 * The errors a tenant's clients (web, desktop renderer, mobile) reported. A report can arrive
 * without a session, so the table is CAPPED: every insert prunes it back to the newest
 * {@link CLIENT_ERRORS_KEPT} rows, and nobody can fill the disk by posting errors.
 */
export function createSqliteClientErrorStore(sqlite: Database.Database): ClientErrorStore {
  sqlite.exec(CREATE_TABLES);
  const insert = sqlite.prepare(
    `INSERT INTO client_error (id, received_at, platform, kind, message, stack, route, app_version, user_agent, request_id, user_id)
     VALUES (@id, @receivedAt, @platform, @kind, @message, @stack, @route, @appVersion, @userAgent, @requestId, @userId)`,
  );
  const prune = sqlite.prepare(
    `DELETE FROM client_error WHERE rowid <= (SELECT rowid FROM client_error ORDER BY rowid DESC LIMIT 1 OFFSET ${CLIENT_ERRORS_KEPT})`,
  );
  const recent = sqlite.prepare("SELECT * FROM client_error ORDER BY received_at DESC, rowid DESC LIMIT ?");
  const countSince = sqlite.prepare("SELECT COUNT(*) AS n FROM client_error WHERE received_at >= ?");
  const recordAndPrune = sqlite.transaction((error: ClientErrorRecord) => {
    insert.run(error);
    prune.run();
  });
  return {
    record: (error) => recordAndPrune(error),
    recent: (limit) => (recent.all(limit) as ClientErrorRow[]).map(recordOf),
    countSince: (isoTime) => (countSince.get(isoTime) as { n: number }).n,
  };
}
