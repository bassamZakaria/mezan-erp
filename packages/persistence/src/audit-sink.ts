import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { AuditEvent, AuditQueryFilter, AuditQueryPort, AuditQueryResult, AuditSink, AuditStream } from "@mezan/domain";

/**
 * SQLite-backed AuditSink (docs/plan.md §5.7).
 *
 * Append-only is enforced at the storage layer: BEFORE UPDATE / BEFORE DELETE
 * triggers RAISE(ABORT), so even a stray SQL statement cannot mutate history.
 * `details` is stored as JSON text (or NULL). Rows are read newest-first per
 * stream. No money columns here, so safeIntegers() is unnecessary — the numeric
 * column is only the autoincrement id.
 *
 * `branch_id` is NULLABLE by decision: rows appended before the column existed
 * cannot be back-filled (the table is append-only — the UPDATE trigger below
 * would abort), and a request whose branch scope spans several branches has no
 * single branch to name. It is added by ALTER on an existing database, which
 * does not fire the append-only triggers.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS audit_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stream      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  branch_id   TEXT,
  timestamp   TEXT NOT NULL,
  severity    TEXT NOT NULL,
  details     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_stream ON audit_event(stream, id);
CREATE TRIGGER IF NOT EXISTS audit_event_no_update
  BEFORE UPDATE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_no_delete
  BEFORE DELETE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
`;

interface AuditRow {
  stream: string;
  module: string;
  entity_type: string;
  action: string;
  actor: string;
  branch_id: string | null;
  timestamp: string;
  severity: string;
  details: string | null;
}

function rowToEvent(r: AuditRow): AuditEvent {
  return {
    stream: r.stream as AuditStream,
    module: r.module,
    entityType: r.entity_type,
    action: r.action,
    actor: r.actor,
    branchId: r.branch_id,
    timestamp: r.timestamp,
    severity: r.severity as AuditEvent["severity"],
    details: r.details === null ? null : (JSON.parse(r.details) as Record<string, unknown>),
  };
}

/** Filterable column -> SQL column, for {@link SqliteAuditSink.queryEvents}. */
const FILTER_COLUMNS: Record<string, string> = {
  stream: "stream",
  module: "module",
  action: "action",
  actor: "actor",
  branchId: "branch_id",
  entityType: "entity_type",
  severity: "severity",
};

class SqliteAuditSink implements AuditSink, AuditQueryPort {
  private readonly insert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insert = sqlite.prepare(
      `INSERT INTO audit_event
         (stream, module, entity_type, action, actor, branch_id, timestamp, severity, details)
       VALUES (@stream, @module, @entityType, @action, @actor, @branchId, @timestamp, @severity, @details)`,
    );
    this.select = sqlite.prepare(
      `SELECT stream, module, entity_type, action, actor, branch_id, timestamp, severity, details
         FROM audit_event WHERE stream = ? ORDER BY id DESC LIMIT ?`,
    );
  }

  async append(event: AuditEvent): Promise<void> {
    this.insert.run({
      stream: event.stream,
      module: event.module,
      entityType: event.entityType,
      action: event.action,
      actor: event.actor,
      branchId: event.branchId,
      timestamp: event.timestamp,
      severity: event.severity,
      details: event.details === null ? null : JSON.stringify(event.details),
    });
  }

  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    const rows = this.select.all(stream, limit) as AuditRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Filtered, paginated read for the audit viewer (`/audit`). Every field in
   * {@link AuditQueryFilter} is optional and AND-combined; `from`/`to` bound
   * `timestamp` inclusively. Newest-first, same as `query`.
   */
  async queryEvents(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(FILTER_COLUMNS)) {
      const value = (filter as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(`${column} = @${key}`);
        params[key] = value;
      }
    }
    if (filter.from !== undefined) {
      conditions.push("timestamp >= @from");
      params.from = filter.from;
    }
    if (filter.to !== undefined) {
      conditions.push("timestamp <= @to");
      params.to = filter.to;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const total = (
      this.sqlite.prepare(`SELECT COUNT(*) AS c FROM audit_event ${where}`).get(params) as { c: number }
    ).c;
    const rows = this.sqlite
      .prepare(
        `SELECT stream, module, entity_type, action, actor, branch_id, timestamp, severity, details
           FROM audit_event ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as AuditRow[];

    return { events: rows.map(rowToEvent), total };
  }
}

export interface SqliteAuditSinkHandle extends AuditSink, AuditQueryPort {
  close(): void;
  /** The raw connection, for tests asserting the append-only triggers fire. */
  readonly db: Database.Database;
}

/**
 * Adds `branch_id` to a database created before the column existed. Existing
 * rows keep NULL — the table is append-only, so they cannot be back-filled and
 * are not meant to be.
 */
function addBranchColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(audit_event)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_id")) {
    sqlite.exec(`ALTER TABLE audit_event ADD COLUMN branch_id TEXT`);
  }
}

/** Open a SQLite-backed AuditSink. ":memory:" for tests, a path for real. */
export function createSqliteAuditSink(path: SqliteConnectionInput = ":memory:"): SqliteAuditSinkHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addBranchColumnIfMissing(sqlite);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_event(branch_id, id)`);
  const sink = new SqliteAuditSink(sqlite);
  return Object.assign(sink, {
    close: () => { if (owned) sqlite.close(); },
    db: sqlite,
  }) as SqliteAuditSinkHandle;
}
