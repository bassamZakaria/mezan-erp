import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type LeaveAccrualBatch,
  type LeaveAccrualBatchRepository,
  type LeaveAccrualBatchStatus,
  type LeaveAccrualLine,
  type LeaveAccrualRunType,
  type LeaveTypeCode,
} from "@mezan/domain";

/** SQLite-backed Leave Accrual Batch store (docs/catalog "استحقاقات الإجازات"), mirroring `fixed-assets-store.ts`'s `depreciation_run` table shape (JSON lines column, Money as scaled INTEGER). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS hr_leave_accrual_batch (
  id               TEXT PRIMARY KEY,
  period           TEXT NOT NULL,
  run_date         TEXT NOT NULL,
  run_type         TEXT NOT NULL,
  status           TEXT NOT NULL,
  lines            TEXT NOT NULL,
  total_days       REAL NOT NULL,
  total_value      INTEGER NOT NULL,
  journal_entry_id TEXT,
  executed_by      TEXT,
  created_at       TEXT NOT NULL,
  posted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_accrual_period ON hr_leave_accrual_batch(period);
`;

interface AccrualBatchRow {
  id: string;
  period: string;
  run_date: string;
  run_type: string;
  status: string;
  lines: string;
  total_days: number;
  total_value: number;
  journal_entry_id: string | null;
  executed_by: string | null;
  created_at: string;
  posted_at: string | null;
}

interface LineJson {
  employeeId: string;
  leaveTypeCode: LeaveTypeCode;
  creditedDays: number;
  value: string;
}

function toBatch(row: AccrualBatchRow): LeaveAccrualBatch {
  const lines: LeaveAccrualLine[] = (JSON.parse(row.lines) as LineJson[]).map((l) => ({
    employeeId: l.employeeId,
    leaveTypeCode: l.leaveTypeCode,
    creditedDays: l.creditedDays,
    value: Money.fromMajor(l.value),
  }));
  return {
    id: row.id,
    period: row.period,
    runDate: row.run_date,
    runType: row.run_type as LeaveAccrualRunType,
    status: row.status as LeaveAccrualBatchStatus,
    lines,
    totalDays: row.total_days,
    totalValue: Money.fromScaled(row.total_value),
    journalEntryId: row.journal_entry_id,
    executedBy: row.executed_by,
    createdAt: row.created_at,
    postedAt: row.posted_at,
  };
}

export interface SqliteLeaveAccrualBatchRepositoryHandle extends LeaveAccrualBatchRepository {
  close(): void;
}

export function createSqliteLeaveAccrualBatchRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteLeaveAccrualBatchRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);

  const upsert: Database.Statement = sqlite.prepare(`
    INSERT INTO hr_leave_accrual_batch (
      id, period, run_date, run_type, status, lines, total_days, total_value, journal_entry_id, executed_by, created_at, posted_at
    ) VALUES (
      @id, @period, @run_date, @run_type, @status, @lines, @total_days, @total_value, @journal_entry_id, @executed_by, @created_at, @posted_at
    )
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      journal_entry_id = excluded.journal_entry_id,
      posted_at = excluded.posted_at
  `);
  const selectById: Database.Statement = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch WHERE id = ?`);
  // Most-recent-first: after a batch is cancelled and a new one created for the same period, the newest row is the one that determines whether the period is "occupied".
  const selectByPeriod: Database.Statement = sqlite.prepare(
    `SELECT * FROM hr_leave_accrual_batch WHERE period = ? ORDER BY created_at DESC LIMIT 1`,
  );
  const selectAll: Database.Statement = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch ORDER BY created_at DESC`);

  function write(batch: LeaveAccrualBatch): void {
    upsert.run({
      id: batch.id,
      period: batch.period,
      run_date: batch.runDate,
      run_type: batch.runType,
      status: batch.status,
      lines: JSON.stringify(
        batch.lines.map((l) => ({ employeeId: l.employeeId, leaveTypeCode: l.leaveTypeCode, creditedDays: l.creditedDays, value: l.value.toString() })),
      ),
      total_days: batch.totalDays,
      total_value: batch.totalValue.toScaledNumber(),
      journal_entry_id: batch.journalEntryId,
      executed_by: batch.executedBy,
      created_at: batch.createdAt,
      posted_at: batch.postedAt,
    });
  }

  return {
    async findById(id) {
      const row = selectById.get(id) as AccrualBatchRow | undefined;
      return row ? toBatch(row) : null;
    },
    async findByPeriod(period) {
      const row = selectByPeriod.get(period) as AccrualBatchRow | undefined;
      return row ? toBatch(row) : null;
    },
    async list() {
      return (selectAll.all() as AccrualBatchRow[]).map(toBatch);
    },
    async create(batch) {
      write(batch);
    },
    async update(batch) {
      write(batch);
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
