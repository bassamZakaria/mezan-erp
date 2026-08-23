import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  ApprovalRequestRecord,
  ApprovalRequestRepository,
  ApprovalStatus,
  DecisionRecord,
  GateableActionType,
  GateStep,
} from "@mezan/domain";

/**
 * SQLite-backed {@link ApprovalRequestRepository} (docs/catalog/09 §الموافقات
 * inbox). Steps/decisions are small, per-request, and never queried by their
 * own fields directly — so, like `settings-store.ts`, they're stored as JSON
 * text and the domain never sees the column shape. `listPendingForRoles`
 * filters in JS (this table is small — one row per in-flight approval).
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS approval_request (
  id             TEXT PRIMARY KEY,
  action_type    TEXT NOT NULL,
  submitted_by   TEXT NOT NULL,
  steps_json     TEXT NOT NULL,
  current_step   INTEGER NOT NULL,
  status         TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  entity_label   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_request_status ON approval_request(status);
CREATE INDEX IF NOT EXISTS idx_approval_request_submitted_by ON approval_request(submitted_by);
`;

interface Row {
  id: string;
  action_type: string;
  submitted_by: string;
  steps_json: string;
  current_step: number;
  status: string;
  decisions_json: string;
  entity_label: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: Row): ApprovalRequestRecord {
  return {
    id: row.id,
    actionType: row.action_type as GateableActionType,
    submittedBy: row.submitted_by,
    steps: JSON.parse(row.steps_json) as GateStep[],
    currentStep: row.current_step,
    status: row.status as ApprovalStatus,
    decisions: JSON.parse(row.decisions_json) as DecisionRecord[],
    entityLabel: row.entity_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteApprovalRequestStore implements ApprovalRequestRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectPending: Database.Statement;
  private readonly selectBySubmitter: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO approval_request
        (id, action_type, submitted_by, steps_json, current_step, status, decisions_json, entity_label, created_at, updated_at)
      VALUES (@id, @action_type, @submitted_by, @steps_json, @current_step, @status, @decisions_json, @entity_label, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        action_type = excluded.action_type,
        submitted_by = excluded.submitted_by,
        steps_json = excluded.steps_json,
        current_step = excluded.current_step,
        status = excluded.status,
        decisions_json = excluded.decisions_json,
        entity_label = excluded.entity_label,
        updated_at = excluded.updated_at
    `);
    this.selectAll = sqlite.prepare(`SELECT * FROM approval_request ORDER BY created_at DESC`);
    this.selectById = sqlite.prepare(`SELECT * FROM approval_request WHERE id = ?`);
    this.selectPending = sqlite.prepare(`SELECT * FROM approval_request WHERE status = 'pending' ORDER BY created_at`);
    this.selectBySubmitter = sqlite.prepare(`SELECT * FROM approval_request WHERE submitted_by = ? ORDER BY created_at DESC`);
  }

  async list(): Promise<readonly ApprovalRequestRecord[]> {
    return (this.selectAll.all() as Row[]).map(toRecord);
  }

  async findById(id: string): Promise<ApprovalRequestRecord | null> {
    const row = this.selectById.get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async save(record: ApprovalRequestRecord): Promise<void> {
    this.upsert.run({
      id: record.id,
      action_type: record.actionType,
      submitted_by: record.submittedBy,
      steps_json: JSON.stringify(record.steps),
      current_step: record.currentStep,
      status: record.status,
      decisions_json: JSON.stringify(record.decisions),
      entity_label: record.entityLabel,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  async listPendingForRoles(roles: readonly string[]): Promise<readonly ApprovalRequestRecord[]> {
    const pending = (this.selectPending.all() as Row[]).map(toRecord);
    if (roles.includes("*")) return pending;
    return pending.filter((r) => {
      const role = r.steps[r.currentStep]?.role;
      return role !== undefined && roles.includes(role);
    });
  }

  async listBySubmitter(submittedBy: string): Promise<readonly ApprovalRequestRecord[]> {
    return (this.selectBySubmitter.all(submittedBy) as Row[]).map(toRecord);
  }
}

export interface SqliteApprovalRequestStoreHandle extends ApprovalRequestRepository {
  close(): void;
}

/** Open a SQLite-backed ApprovalRequestRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteApprovalRequestStore(
  input: SqliteConnectionInput = ":memory:",
): SqliteApprovalRequestStoreHandle {
  const { sqlite, owned } = openSqliteConnection(input);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteApprovalRequestStore(sqlite);
  return Object.assign(store, { close: () => { if (owned) sqlite.close(); } }) as SqliteApprovalRequestStoreHandle;
}
