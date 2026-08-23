import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { AuditEvent, AuditSink, AuditStream } from "@mezan/domain";

/**
 * SQLite-backed AuditSink (docs/plan.md §5.7).
 *
 * Append-only is enforced at the storage layer: BEFORE UPDATE / BEFORE DELETE
 * triggers RAISE(ABORT), so even a stray SQL statement cannot mutate history.
 * `details` is stored as JSON text (or NULL). Rows are read newest-first per
 * stream. No money columns here, so safeIntegers() is unnecessary — the numeric
 * column is only the autoincrement id.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS audit_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stream      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
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
  timestamp: string;
  severity: string;
  details: string | null;
}

class SqliteAuditSink implements AuditSink {
  private readonly insert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(
      `INSERT INTO audit_event
         (stream, module, entity_type, action, actor, timestamp, severity, details)
       VALUES (@stream, @module, @entityType, @action, @actor, @timestamp, @severity, @details)`,
    );
    this.select = sqlite.prepare(
      `SELECT stream, module, entity_type, action, actor, timestamp, severity, details
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
      timestamp: event.timestamp,
      severity: event.severity,
      details: event.details === null ? null : JSON.stringify(event.details),
    });
  }

  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    const rows = this.select.all(stream, limit) as AuditRow[];
    return rows.map((r) => ({
      stream: r.stream as AuditStream,
      module: r.module,
      entityType: r.entity_type,
      action: r.action,
      actor: r.actor,
      timestamp: r.timestamp,
      severity: r.severity as AuditEvent["severity"],
      details: r.details === null ? null : (JSON.parse(r.details) as Record<string, unknown>),
    }));
  }
}

export interface SqliteAuditSinkHandle extends AuditSink {
  close(): void;
  /** The raw connection, for tests asserting the append-only triggers fire. */
  readonly db: Database.Database;
}

/** Open a SQLite-backed AuditSink. ":memory:" for tests, a path for real. */
export function createSqliteAuditSink(path: SqliteConnectionInput = ":memory:"): SqliteAuditSinkHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const sink = new SqliteAuditSink(sqlite);
  return Object.assign(sink, {
    close: () => { if (owned) sqlite.close(); },
    db: sqlite,
  }) as SqliteAuditSinkHandle;
}
