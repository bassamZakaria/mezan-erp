import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  LEAVE_TYPE_CODES,
  type LeaveAccrualFrequency,
  type LeaveCarryoverPolicy,
  type LeavePolicyRepository,
  type LeavePolicySource,
  type LeavePolicyVersion,
  type LeaveTypeCode,
} from "@mezan/domain";

/** SQLite-backed Leave Policy store (docs/catalog "سياسات الإجازات"). Append-only: a version is never updated, only superseded by a newer effective-dated one. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS hr_leave_policy_version (
  id                     TEXT PRIMARY KEY,
  leave_type_code        TEXT NOT NULL,
  effective_date         TEXT NOT NULL,
  base_balance_days      REAL NOT NULL,
  accrual_frequency      TEXT NOT NULL,
  carryover              TEXT NOT NULL,
  carryover_max_days     REAL,
  payout_on_termination  INTEGER NOT NULL,
  legally_mandatory      INTEGER NOT NULL,
  source                 TEXT NOT NULL,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_policy_type_date ON hr_leave_policy_version(leave_type_code, effective_date);
`;

interface PolicyRow {
  id: string;
  leave_type_code: string;
  effective_date: string;
  base_balance_days: number;
  accrual_frequency: string;
  carryover: string;
  carryover_max_days: number | null;
  payout_on_termination: number;
  legally_mandatory: number;
  source: string;
  created_at: string;
}

function toVersion(row: PolicyRow): LeavePolicyVersion {
  return {
    id: row.id,
    leaveTypeCode: row.leave_type_code as LeaveTypeCode,
    effectiveDate: row.effective_date,
    baseBalanceDays: row.base_balance_days,
    accrualFrequency: row.accrual_frequency as LeaveAccrualFrequency,
    carryover: row.carryover as LeaveCarryoverPolicy,
    carryoverMaxDays: row.carryover_max_days,
    payoutOnTermination: row.payout_on_termination === 1,
    legallyMandatory: row.legally_mandatory === 1,
    source: row.source as LeavePolicySource,
    createdAt: row.created_at,
  };
}

export interface SqliteLeavePolicyRepositoryHandle extends LeavePolicyRepository {
  close(): void;
}

export function createSqliteLeavePolicyRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeavePolicyRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);

  const insert: Database.Statement = sqlite.prepare(`
    INSERT INTO hr_leave_policy_version (
      id, leave_type_code, effective_date, base_balance_days, accrual_frequency,
      carryover, carryover_max_days, payout_on_termination, legally_mandatory, source, created_at
    ) VALUES (
      @id, @leave_type_code, @effective_date, @base_balance_days, @accrual_frequency,
      @carryover, @carryover_max_days, @payout_on_termination, @legally_mandatory, @source, @created_at
    )
  `);
  const selectByType: Database.Statement = sqlite.prepare(
    `SELECT * FROM hr_leave_policy_version WHERE leave_type_code = ? ORDER BY effective_date DESC`,
  );
  const selectEffective: Database.Statement = sqlite.prepare(
    `SELECT * FROM hr_leave_policy_version WHERE leave_type_code = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1`,
  );

  return {
    async listVersions(leaveTypeCode) {
      return (selectByType.all(leaveTypeCode) as PolicyRow[]).map(toVersion);
    },
    async listEffective(asOfDate) {
      const result: LeavePolicyVersion[] = [];
      for (const code of LEAVE_TYPE_CODES) {
        const row = selectEffective.get(code, asOfDate) as PolicyRow | undefined;
        if (row) result.push(toVersion(row));
      }
      return result;
    },
    async findEffective(leaveTypeCode, asOfDate) {
      const row = selectEffective.get(leaveTypeCode, asOfDate) as PolicyRow | undefined;
      return row ? toVersion(row) : null;
    },
    async create(version) {
      insert.run({
        id: version.id,
        leave_type_code: version.leaveTypeCode,
        effective_date: version.effectiveDate,
        base_balance_days: version.baseBalanceDays,
        accrual_frequency: version.accrualFrequency,
        carryover: version.carryover,
        carryover_max_days: version.carryoverMaxDays,
        payout_on_termination: version.payoutOnTermination ? 1 : 0,
        legally_mandatory: version.legallyMandatory ? 1 : 0,
        source: version.source,
        created_at: version.createdAt,
      });
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
