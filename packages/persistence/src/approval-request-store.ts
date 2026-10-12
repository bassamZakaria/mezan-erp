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
import { insertingNew } from "./insert-new.js";
import { ApprovalStatusCode } from "@mezan/domain";

/**
 * SQLite-backed {@link ApprovalRequestRepository} (docs/archive/catalog/09 §الموافقات
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
  updated_at     TEXT NOT NULL,
  document_id          TEXT,
  document_branch_id   TEXT,
  document_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_request_status ON approval_request(status);
CREATE INDEX IF NOT EXISTS idx_approval_request_submitted_by ON approval_request(submitted_by);
`;

const DOCUMENT_COLUMNS = ["document_id", "document_branch_id", "document_fingerprint"] as const;

function addDocumentColumns(sqlite: Database.Database): void {
  const present = new Set((sqlite.prepare("PRAGMA table_info(approval_request)").all() as { name: string }[]).map((column) => column.name));
  for (const column of DOCUMENT_COLUMNS) if (!present.has(column)) sqlite.exec(`ALTER TABLE approval_request ADD COLUMN ${column} TEXT`);
}

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
  document_id: string | null;
  document_branch_id: string | null;
  document_fingerprint: string | null;
}

function toRow(record: ApprovalRequestRecord): Row {
  return {
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
    document_id: record.subject?.documentId ?? null,
    document_branch_id: record.subject?.branchId ?? null,
    document_fingerprint: record.subject?.fingerprint ?? null,
  };
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
    subject:
      row.document_id !== null && row.document_fingerprint !== null
        ? { documentId: row.document_id, branchId: row.document_branch_id, fingerprint: row.document_fingerprint }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INSERT = `
  INSERT INTO approval_request
    (id, action_type, submitted_by, steps_json, current_step, status, decisions_json, entity_label, created_at, updated_at,
     document_id, document_branch_id, document_fingerprint)
  VALUES (@id, @action_type, @submitted_by, @steps_json, @current_step, @status, @decisions_json, @entity_label, @created_at, @updated_at,
     @document_id, @document_branch_id, @document_fingerprint)
`;

class SqliteApprovalRequestStore implements ApprovalRequestRepository {
  private readonly insertOnly: Database.Statement;
  private readonly transition: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectPending: Database.Statement;
  private readonly selectBySubmitter: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insertOnly = sqlite.prepare(INSERT);
    this.transition = sqlite.prepare(`
      UPDATE approval_request SET
        submitted_by = @submitted_by,
        steps_json = @steps_json,
        current_step = @current_step,
        status = @status,
        decisions_json = @decisions_json,
        entity_label = @entity_label,
        updated_at = @updated_at,
        document_branch_id = @document_branch_id,
        document_fingerprint = @document_fingerprint
      WHERE id = @id
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

  async insert(record: ApprovalRequestRecord): Promise<void> {
    insertingNew(record.id, () => this.insertOnly.run(toRow(record)));
  }

  async save(record: ApprovalRequestRecord): Promise<void> {
    const { action_type: _actionType, created_at: _createdAt, document_id: _documentId, ...changes } = toRow(record);
    this.transition.run(changes);
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
  addDocumentColumns(sqlite);
  const store = new SqliteApprovalRequestStore(sqlite);
  return Object.assign(store, { close: () => { if (owned) sqlite.close(); } }) as SqliteApprovalRequestStoreHandle;
}

const HELD_DOCUMENT_STATUS = "pending";
const STALE_REQUEST_STATUSES = ["pending", "approved"] as const;
const UNVERIFIABLE_FINGERPRINT = "";

interface HeldDocumentRow {
  readonly id: string;
  readonly branchId: string | null;
}

function heldDocumentOf(sqlite: Database.Database, requestId: string): HeldDocumentRow | null {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    const columns = new Set((sqlite.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((column) => column.name));
    if (!columns.has("workflow_request_id") || !columns.has("status") || !columns.has("id")) continue;
    const branch = columns.has("branch_id") ? "branch_id" : "NULL";
    const row = sqlite.prepare(`SELECT id, ${branch} AS branchId FROM "${name}" WHERE workflow_request_id = ? AND status = ?`).get(requestId, HELD_DOCUMENT_STATUS) as HeldDocumentRow | undefined;
    if (row) return row;
  }
  return null;
}

/**
 * UPGRADE: a request written before requests carried their document's
 * fingerprint cannot be honoured on confirm. Where its document is still held,
 * the request is marked as needing re-approval and tied to that document, so
 * the next confirm sends it through the chain again instead of refusing it.
 */
export function markApprovalsNeedingReapproval(sqlite: Database.Database, now: () => string = () => new Date().toISOString()): string[] {
  sqlite.exec(CREATE_TABLE);
  addDocumentColumns(sqlite);
  const stale = sqlite
    .prepare(`SELECT id FROM approval_request WHERE document_fingerprint IS NULL AND status IN (${STALE_REQUEST_STATUSES.map(() => "?").join(", ")})`)
    .all(...STALE_REQUEST_STATUSES) as { id: string }[];
  const mark = sqlite.prepare("UPDATE approval_request SET status = ?, document_id = ?, document_branch_id = ?, document_fingerprint = ?, updated_at = ? WHERE id = ?");
  const marked: string[] = [];
  for (const { id } of stale) {
    const document = heldDocumentOf(sqlite, id);
    if (!document) continue;
    mark.run(ApprovalStatusCode.ReapprovalRequired, document.id, document.branchId, UNVERIFIABLE_FINGERPRINT, now(), id);
    marked.push(id);
  }
  return marked;
}
