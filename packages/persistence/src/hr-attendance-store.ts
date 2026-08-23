import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { AttendanceRecord, AttendanceRecordRepository, AttendanceStatus } from "@mezan/domain";

/** SQLite-backed Attendance store (docs/catalog "الحضور والانصراف"). One row per (employee, date), upserted on re-mark. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS hr_attendance_record (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  date           TEXT NOT NULL,
  status         TEXT NOT NULL,
  overtime_hours REAL NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_employee_date ON hr_attendance_record(employee_id, date);
`;

interface AttendanceRow {
  id: string;
  employee_id: string;
  date: string;
  status: string;
  overtime_hours: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    status: row.status as AttendanceStatus,
    overtimeHours: row.overtime_hours,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SqliteAttendanceRecordRepositoryHandle extends AttendanceRecordRepository {
  close(): void;
}

export function createSqliteAttendanceRecordRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteAttendanceRecordRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);

  const upsert: Database.Statement = sqlite.prepare(`
    INSERT INTO hr_attendance_record (id, employee_id, date, status, overtime_hours, notes, created_at, updated_at)
    VALUES (@id, @employee_id, @date, @status, @overtime_hours, @notes, @created_at, @updated_at)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = excluded.status,
      overtime_hours = excluded.overtime_hours,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);
  const selectByEmployeeDate: Database.Statement = sqlite.prepare(
    `SELECT * FROM hr_attendance_record WHERE employee_id = ? AND date = ?`,
  );

  return {
    async findByEmployeeAndDate(employeeId, date) {
      const row = selectByEmployeeDate.get(employeeId, date) as AttendanceRow | undefined;
      return row ? toRecord(row) : null;
    },
    async listForRange(employeeIds, fromDate, toDate) {
      let rows: AttendanceRow[];
      if (employeeIds === null) {
        rows = sqlite
          .prepare(`SELECT * FROM hr_attendance_record WHERE date >= ? AND date <= ?`)
          .all(fromDate, toDate) as AttendanceRow[];
      } else if (employeeIds.length === 0) {
        rows = [];
      } else {
        const placeholders = employeeIds.map(() => "?").join(",");
        rows = sqlite
          .prepare(`SELECT * FROM hr_attendance_record WHERE employee_id IN (${placeholders}) AND date >= ? AND date <= ?`)
          .all(...employeeIds, fromDate, toDate) as AttendanceRow[];
      }
      return rows.map(toRecord);
    },
    async save(record) {
      upsert.run({
        id: record.id,
        employee_id: record.employeeId,
        date: record.date,
        status: record.status,
        overtime_hours: record.overtimeHours,
        notes: record.notes,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
