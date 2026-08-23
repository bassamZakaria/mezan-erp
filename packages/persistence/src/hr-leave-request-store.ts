import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  DecisionRecord,
  GateStep,
  GateableActionType,
  LeaveRequest,
  LeaveRequestRepository,
  LeaveRequestStatus,
  LeaveTypeCode,
} from "@mezan/domain";

/** SQLite-backed Leave Request store (docs/catalog "طلبات الإجازات"). The approval-chain state (steps/decisions) is stored as JSON text, mirroring `depreciation_run.lines`. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS hr_leave_request (
  id                  TEXT PRIMARY KEY,
  request_no          TEXT NOT NULL,
  employee_id         TEXT NOT NULL,
  leave_type_code     TEXT NOT NULL,
  start_date          TEXT NOT NULL,
  end_date            TEXT NOT NULL,
  half_day            INTEGER NOT NULL,
  days                REAL NOT NULL,
  reason              TEXT,
  status              TEXT NOT NULL,
  gate_action_type    TEXT NOT NULL,
  workflow_request_id TEXT NOT NULL,
  steps               TEXT NOT NULL,
  current_step_index  INTEGER NOT NULL,
  decisions           TEXT NOT NULL,
  submitted_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  decided_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_request_employee ON hr_leave_request(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_request_status ON hr_leave_request(status);
`;

interface LeaveRequestRow {
  id: string;
  request_no: string;
  employee_id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  half_day: number;
  days: number;
  reason: string | null;
  status: string;
  gate_action_type: string;
  workflow_request_id: string;
  steps: string;
  current_step_index: number;
  decisions: string;
  submitted_by: string;
  created_at: string;
  decided_at: string | null;
}

function toRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    requestNo: row.request_no,
    employeeId: row.employee_id,
    leaveTypeCode: row.leave_type_code as LeaveTypeCode,
    startDate: row.start_date,
    endDate: row.end_date,
    halfDay: row.half_day === 1,
    days: row.days,
    reason: row.reason,
    status: row.status as LeaveRequestStatus,
    gateActionType: row.gate_action_type as GateableActionType,
    workflowRequestId: row.workflow_request_id,
    steps: JSON.parse(row.steps) as GateStep[],
    currentStepIndex: row.current_step_index,
    decisions: JSON.parse(row.decisions) as DecisionRecord[],
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export interface SqliteLeaveRequestRepositoryHandle extends LeaveRequestRepository {
  close(): void;
}

export function createSqliteLeaveRequestRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveRequestRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);

  const upsert: Database.Statement = sqlite.prepare(`
    INSERT INTO hr_leave_request (
      id, request_no, employee_id, leave_type_code, start_date, end_date, half_day, days, reason,
      status, gate_action_type, workflow_request_id, steps, current_step_index, decisions, submitted_by,
      created_at, decided_at
    ) VALUES (
      @id, @request_no, @employee_id, @leave_type_code, @start_date, @end_date, @half_day, @days, @reason,
      @status, @gate_action_type, @workflow_request_id, @steps, @current_step_index, @decisions, @submitted_by,
      @created_at, @decided_at
    )
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      current_step_index = excluded.current_step_index,
      decisions = excluded.decisions,
      decided_at = excluded.decided_at
  `);
  const selectById: Database.Statement = sqlite.prepare(`SELECT * FROM hr_leave_request WHERE id = ?`);

  function write(request: LeaveRequest): void {
    upsert.run({
      id: request.id,
      request_no: request.requestNo,
      employee_id: request.employeeId,
      leave_type_code: request.leaveTypeCode,
      start_date: request.startDate,
      end_date: request.endDate,
      half_day: request.halfDay ? 1 : 0,
      days: request.days,
      reason: request.reason,
      status: request.status,
      gate_action_type: request.gateActionType,
      workflow_request_id: request.workflowRequestId,
      steps: JSON.stringify(request.steps),
      current_step_index: request.currentStepIndex,
      decisions: JSON.stringify(request.decisions),
      submitted_by: request.submittedBy,
      created_at: request.createdAt,
      decided_at: request.decidedAt,
    });
  }

  return {
    async findById(id) {
      const row = selectById.get(id) as LeaveRequestRow | undefined;
      return row ? toRequest(row) : null;
    },
    async list(filter) {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter?.employeeId) {
        clauses.push("employee_id = ?");
        params.push(filter.employeeId);
      }
      if (filter?.status) {
        clauses.push("status = ?");
        params.push(filter.status);
      }
      if (filter?.leaveTypeCode) {
        clauses.push("leave_type_code = ?");
        params.push(filter.leaveTypeCode);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = sqlite.prepare(`SELECT * FROM hr_leave_request ${where} ORDER BY created_at DESC`).all(...params) as LeaveRequestRow[];
      return rows.map(toRequest);
    },
    async create(request) {
      write(request);
    },
    async update(request) {
      write(request);
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
