import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Qty,
  type AttendanceEntry,
  type AttendanceFilter,
  type AttendanceRepository,
  type AttendanceStatus,
  type LeaveAccrualBatch,
  type LeaveAccrualBatchFilter,
  type LeaveAccrualBatchRepository,
  type LeaveAccrualFrequency,
  type LeaveAccrualLine,
  type LeaveAccrualRunType,
  type LeaveBalance,
  type LeaveBalanceFilter,
  type LeaveBalanceRepository,
  type LeavePolicy,
  type LeavePolicyRepository,
  type LeaveType,
} from "@mezan/domain";

/**
 * Stores for the HR time & leave layer (docs/archive/catalog/06
 * "الحضور والانصراف" / "سياسات الإجازات" / "استحقاقات الإجازات"). Same
 * single-file, table-per-entity style as `hr-store.ts`; `Qty` day counts are
 * stored as the scaled INTEGER the value object carries, never as a REAL.
 */

// --- Attendance ------------------------------------------------------------

const CREATE_ATTENDANCE = `
CREATE TABLE IF NOT EXISTS hr_attendance (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  date           TEXT NOT NULL,
  check_in       TEXT,
  check_out      TEXT,
  worked_minutes INTEGER NOT NULL,
  approved_overtime_minutes INTEGER,
  holiday_compensation TEXT NOT NULL DEFAULT 'pay',
  status         TEXT NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS hr_attendance_date_idx ON hr_attendance (date);
`;

interface AttendanceRow {
  id: string;
  employee_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  worked_minutes: bigint;
  approved_overtime_minutes: bigint | null;
  holiday_compensation: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toAttendance(row: AttendanceRow): AttendanceEntry {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out,
    workedMinutes: Number(row.worked_minutes),
    approvedOvertimeMinutes: row.approved_overtime_minutes === null ? null : Number(row.approved_overtime_minutes),
    holidayCompensation: row.holiday_compensation === "day_off" ? "day_off" : "pay",
    status: row.status as AttendanceStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ATTENDANCE_UPSERT = `
      INSERT INTO hr_attendance (id, employee_id, date, check_in, check_out, worked_minutes, approved_overtime_minutes, holiday_compensation, status, notes, created_at, updated_at)
      VALUES (${placeholders(12)})
      ON CONFLICT(id) DO UPDATE SET
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        worked_minutes = excluded.worked_minutes,
        approved_overtime_minutes = excluded.approved_overtime_minutes,
        holiday_compensation = excluded.holiday_compensation,
        status = excluded.status,
        notes = excluded.notes,
        updated_at = excluded.updated_at`;

function attendanceParams(entry: AttendanceEntry): SqlValue[] {
  return [
    entry.id,
    entry.employeeId,
    entry.date,
    entry.checkIn,
    entry.checkOut,
    entry.workedMinutes,
    entry.approvedOvertimeMinutes,
    entry.holidayCompensation,
    entry.status,
    entry.notes,
    entry.createdAt,
    entry.updatedAt,
  ];
}

class SqlAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<AttendanceEntry | null> {
    const row = await this.db.get<AttendanceRow>(`SELECT * FROM hr_attendance WHERE id = ?`, [id]);
    return row ? toAttendance(row) : null;
  }

  async findByEmployeeAndDate(employeeId: string, date: string): Promise<AttendanceEntry | null> {
    const row = await this.db.get<AttendanceRow>(`SELECT * FROM hr_attendance WHERE employee_id = ? AND date = ?`, [employeeId, date]);
    return row ? toAttendance(row) : null;
  }

  async list(filter: AttendanceFilter = {}): Promise<AttendanceEntry[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.employeeId) {
      clauses.push("employee_id = ?");
      params.push(filter.employeeId);
    }
    if (filter.from) {
      clauses.push("date >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      clauses.push("date <= ?");
      params.push(filter.to);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<AttendanceRow>(`SELECT * FROM hr_attendance ${where} ORDER BY date DESC, employee_id`, params);
    return rows.map(toAttendance);
  }

  async create(entry: AttendanceEntry): Promise<void> {
    await insertNew(this.db, entry.id, ATTENDANCE_UPSERT, attendanceParams(entry));
  }

  async update(entry: AttendanceEntry): Promise<void> {
    await this.db.run(ATTENDANCE_UPSERT, attendanceParams(entry));
  }
}

// --- Leave policies --------------------------------------------------------

const CREATE_LEAVE_POLICY = `
CREATE TABLE IF NOT EXISTS hr_leave_policy (
  id                    TEXT PRIMARY KEY,
  leave_type            TEXT NOT NULL UNIQUE,
  entitlement_days      INTEGER NOT NULL,
  accrual_frequency     TEXT NOT NULL,
  carry_over            INTEGER NOT NULL,
  max_carry_over_days   INTEGER,
  payout_on_termination INTEGER NOT NULL,
  legally_mandated      INTEGER NOT NULL,
  preset_code           TEXT,
  active                INTEGER NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
`;

interface LeavePolicyRow {
  id: string;
  leave_type: string;
  entitlement_days: bigint;
  accrual_frequency: string;
  carry_over: bigint;
  max_carry_over_days: bigint | null;
  payout_on_termination: bigint;
  legally_mandated: bigint;
  preset_code: string | null;
  active: bigint;
  created_at: string;
  updated_at: string;
}

function toLeavePolicy(row: LeavePolicyRow): LeavePolicy {
  return {
    id: row.id,
    leaveType: row.leave_type as LeaveType,
    entitlementDays: Qty.fromScaled(row.entitlement_days),
    accrualFrequency: row.accrual_frequency as LeaveAccrualFrequency,
    carryOver: Number(row.carry_over) === 1,
    maxCarryOverDays: row.max_carry_over_days === null ? null : Qty.fromScaled(row.max_carry_over_days),
    payoutOnTermination: Number(row.payout_on_termination) === 1,
    legallyMandated: Number(row.legally_mandated) === 1,
    presetCode: row.preset_code,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LEAVE_POLICY_UPSERT = `
      INSERT INTO hr_leave_policy (id, leave_type, entitlement_days, accrual_frequency, carry_over, max_carry_over_days, payout_on_termination, legally_mandated, preset_code, active, created_at, updated_at)
      VALUES (${placeholders(12)})
      ON CONFLICT(id) DO UPDATE SET
        entitlement_days = excluded.entitlement_days,
        accrual_frequency = excluded.accrual_frequency,
        carry_over = excluded.carry_over,
        max_carry_over_days = excluded.max_carry_over_days,
        payout_on_termination = excluded.payout_on_termination,
        legally_mandated = excluded.legally_mandated,
        preset_code = excluded.preset_code,
        active = excluded.active,
        updated_at = excluded.updated_at`;

function leavePolicyParams(policy: LeavePolicy): SqlValue[] {
  return [
    policy.id,
    policy.leaveType,
    policy.entitlementDays.scaled,
    policy.accrualFrequency,
    policy.carryOver ? 1 : 0,
    policy.maxCarryOverDays === null ? null : policy.maxCarryOverDays.scaled,
    policy.payoutOnTermination ? 1 : 0,
    policy.legallyMandated ? 1 : 0,
    policy.presetCode,
    policy.active ? 1 : 0,
    policy.createdAt,
    policy.updatedAt,
  ];
}

class SqlLeavePolicyRepository implements LeavePolicyRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<LeavePolicy | null> {
    const row = await this.db.get<LeavePolicyRow>(`SELECT * FROM hr_leave_policy WHERE id = ?`, [id]);
    return row ? toLeavePolicy(row) : null;
  }

  async findByLeaveType(leaveType: LeaveType): Promise<LeavePolicy | null> {
    const row = await this.db.get<LeavePolicyRow>(`SELECT * FROM hr_leave_policy WHERE leave_type = ?`, [leaveType]);
    return row ? toLeavePolicy(row) : null;
  }

  async list(): Promise<LeavePolicy[]> {
    return (await this.db.all<LeavePolicyRow>(`SELECT * FROM hr_leave_policy ORDER BY leave_type`)).map(toLeavePolicy);
  }

  async create(policy: LeavePolicy): Promise<void> {
    await insertNew(this.db, policy.id, LEAVE_POLICY_UPSERT, leavePolicyParams(policy));
  }

  async update(policy: LeavePolicy): Promise<void> {
    await this.db.run(LEAVE_POLICY_UPSERT, leavePolicyParams(policy));
  }

  async remove(id: string): Promise<void> {
    await this.db.run(`DELETE FROM hr_leave_policy WHERE id = ?`, [id]);
  }
}

// --- Leave balances --------------------------------------------------------

const CREATE_LEAVE_BALANCE = `
CREATE TABLE IF NOT EXISTS hr_leave_balance (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL,
  leave_type   TEXT NOT NULL,
  year         INTEGER NOT NULL,
  entitled     INTEGER NOT NULL,
  carried_over INTEGER NOT NULL,
  used         INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (employee_id, leave_type, year)
);
`;

interface LeaveBalanceRow {
  id: string;
  employee_id: string;
  leave_type: string;
  year: bigint;
  entitled: bigint;
  carried_over: bigint;
  used: bigint;
  created_at: string;
  updated_at: string;
}

function toLeaveBalance(row: LeaveBalanceRow): LeaveBalance {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type as LeaveType,
    year: Number(row.year),
    entitled: Qty.fromScaled(row.entitled),
    carriedOver: Qty.fromScaled(row.carried_over),
    used: Qty.fromScaled(row.used),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LEAVE_BALANCE_UPSERT = `
      INSERT INTO hr_leave_balance (id, employee_id, leave_type, year, entitled, carried_over, used, created_at, updated_at)
      VALUES (${placeholders(9)})
      ON CONFLICT(id) DO UPDATE SET
        entitled = excluded.entitled,
        carried_over = excluded.carried_over,
        used = excluded.used,
        updated_at = excluded.updated_at`;

function leaveBalanceParams(balance: LeaveBalance): SqlValue[] {
  return [
    balance.id,
    balance.employeeId,
    balance.leaveType,
    balance.year,
    balance.entitled.scaled,
    balance.carriedOver.scaled,
    balance.used.scaled,
    balance.createdAt,
    balance.updatedAt,
  ];
}

class SqlLeaveBalanceRepository implements LeaveBalanceRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<LeaveBalance | null> {
    const row = await this.db.get<LeaveBalanceRow>(`SELECT * FROM hr_leave_balance WHERE id = ?`, [id]);
    return row ? toLeaveBalance(row) : null;
  }

  async find(employeeId: string, leaveType: LeaveType, year: number): Promise<LeaveBalance | null> {
    const row = await this.db.get<LeaveBalanceRow>(
      `SELECT * FROM hr_leave_balance WHERE employee_id = ? AND leave_type = ? AND year = ?`,
      [employeeId, leaveType, year],
    );
    return row ? toLeaveBalance(row) : null;
  }

  async list(filter: LeaveBalanceFilter = {}): Promise<LeaveBalance[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.employeeId) {
      clauses.push("employee_id = ?");
      params.push(filter.employeeId);
    }
    if (filter.leaveType) {
      clauses.push("leave_type = ?");
      params.push(filter.leaveType);
    }
    if (filter.year) {
      clauses.push("year = ?");
      params.push(filter.year);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<LeaveBalanceRow>(`SELECT * FROM hr_leave_balance ${where} ORDER BY year DESC, employee_id, leave_type`, params);
    return rows.map(toLeaveBalance);
  }

  async create(balance: LeaveBalance): Promise<void> {
    await insertNew(this.db, balance.id, LEAVE_BALANCE_UPSERT, leaveBalanceParams(balance));
  }

  async update(balance: LeaveBalance): Promise<void> {
    await this.db.run(LEAVE_BALANCE_UPSERT, leaveBalanceParams(balance));
  }
}

// --- Leave accrual batches -------------------------------------------------

/**
 * `period_key` is UNIQUE — the database-level half of the accrual idempotency
 * guarantee: even if two runs race past the domain's `findByPeriodKey` check,
 * only one batch for a period can ever be recorded.
 */
const CREATE_LEAVE_ACCRUAL_BATCH = `
CREATE TABLE IF NOT EXISTS hr_leave_accrual_batch (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL,
  period_key     TEXT NOT NULL UNIQUE,
  frequency      TEXT NOT NULL,
  run_type       TEXT NOT NULL,
  run_date       TEXT NOT NULL,
  notes          TEXT,
  employee_count INTEGER NOT NULL,
  total_days     INTEGER NOT NULL,
  lines_json     TEXT NOT NULL,
  run_by         TEXT,
  created_at     TEXT NOT NULL
);
`;

interface LeaveAccrualBatchRow {
  id: string;
  number: string;
  period_key: string;
  frequency: string;
  run_type: string;
  run_date: string;
  notes: string | null;
  employee_count: bigint;
  total_days: bigint;
  lines_json: string;
  run_by: string | null;
  created_at: string;
}

interface StoredAccrualLine {
  employeeId: string;
  leaveType: string;
  days: number;
}

function toLeaveAccrualBatch(row: LeaveAccrualBatchRow): LeaveAccrualBatch {
  const lines: LeaveAccrualLine[] = (JSON.parse(row.lines_json) as StoredAccrualLine[]).map((l) => ({
    employeeId: l.employeeId,
    leaveType: l.leaveType as LeaveType,
    days: Qty.fromScaled(l.days),
  }));
  return {
    id: row.id,
    number: row.number,
    periodKey: row.period_key,
    frequency: row.frequency as LeaveAccrualFrequency,
    runType: row.run_type as LeaveAccrualRunType,
    runDate: row.run_date,
    notes: row.notes,
    employeeCount: Number(row.employee_count),
    totalDays: Qty.fromScaled(row.total_days),
    lines,
    runBy: row.run_by,
    createdAt: row.created_at,
  };
}

class SqlLeaveAccrualBatchRepository implements LeaveAccrualBatchRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<LeaveAccrualBatch | null> {
    const row = await this.db.get<LeaveAccrualBatchRow>(`SELECT * FROM hr_leave_accrual_batch WHERE id = ?`, [id]);
    return row ? toLeaveAccrualBatch(row) : null;
  }

  async findByPeriodKey(periodKey: string): Promise<LeaveAccrualBatch | null> {
    const row = await this.db.get<LeaveAccrualBatchRow>(`SELECT * FROM hr_leave_accrual_batch WHERE period_key = ?`, [periodKey]);
    return row ? toLeaveAccrualBatch(row) : null;
  }

  async list(filter: LeaveAccrualBatchFilter = {}): Promise<LeaveAccrualBatch[]> {
    const rows = filter.runType
      ? await this.db.all<LeaveAccrualBatchRow>(`SELECT * FROM hr_leave_accrual_batch WHERE run_type = ? ORDER BY run_date DESC, created_at DESC`, [filter.runType])
      : await this.db.all<LeaveAccrualBatchRow>(`SELECT * FROM hr_leave_accrual_batch ORDER BY run_date DESC, created_at DESC`);
    return rows.map(toLeaveAccrualBatch);
  }

  async create(batch: LeaveAccrualBatch): Promise<void> {
    await this.db.run(
      `INSERT INTO hr_leave_accrual_batch (id, number, period_key, frequency, run_type, run_date, notes, employee_count, total_days, lines_json, run_by, created_at)
       VALUES (${placeholders(12)})`,
      [
        batch.id,
        batch.number,
        batch.periodKey,
        batch.frequency,
        batch.runType,
        batch.runDate,
        batch.notes,
        batch.employeeCount,
        batch.totalDays.scaled,
        JSON.stringify(batch.lines.map((l) => ({ employeeId: l.employeeId, leaveType: l.leaveType, days: l.days.toScaledNumber() }))),
        batch.runBy,
        batch.createdAt,
      ],
    );
  }
}

// --- Factories -------------------------------------------------------------

export interface SqliteAttendanceRepositoryHandle extends AttendanceRepository {
  close(): void;
}
export interface SqliteLeavePolicyRepositoryHandle extends LeavePolicyRepository {
  close(): void;
}
export interface SqliteLeaveBalanceRepositoryHandle extends LeaveBalanceRepository {
  close(): void;
}
export interface SqliteLeaveAccrualBatchRepositoryHandle extends LeaveAccrualBatchRepository {
  close(): void;
}

export async function ensureHrTimeLeaveSchema(db: SqlDb): Promise<void> {
  await db.applySchema([CREATE_ATTENDANCE, CREATE_LEAVE_POLICY, CREATE_LEAVE_BALANCE, CREATE_LEAVE_ACCRUAL_BATCH].join("\n"));
}

export function createAttendanceRepository(db: SqlDb): AttendanceRepository {
  return new SqlAttendanceRepository(db);
}

export function createLeavePolicyRepository(db: SqlDb): LeavePolicyRepository {
  return new SqlLeavePolicyRepository(db);
}

export function createLeaveBalanceRepository(db: SqlDb): LeaveBalanceRepository {
  return new SqlLeaveBalanceRepository(db);
}

export function createLeaveAccrualBatchRepository(db: SqlDb): LeaveAccrualBatchRepository {
  return new SqlLeaveAccrualBatchRepository(db);
}

/** Open a SQLite-backed AttendanceRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteAttendanceRepository(path: SqliteConnectionInput = ":memory:"): SqliteAttendanceRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_ATTENDANCE);
  // Approved overtime landed after attendance shipped; an existing install gains
  // the column rather than losing its history. NULL is "no approval recorded",
  // which is deliberately distinct from an approved zero.
  if (!(sqlite.pragma(`table_info(hr_attendance)`) as { name: string }[]).some((c) => c.name === "approved_overtime_minutes")) {
    sqlite.exec(`ALTER TABLE hr_attendance ADD COLUMN approved_overtime_minutes INTEGER`);
  }
  if (!(sqlite.pragma(`table_info(hr_attendance)`) as { name: string }[]).some((c) => c.name === "holiday_compensation")) {
    sqlite.exec(`ALTER TABLE hr_attendance ADD COLUMN holiday_compensation TEXT NOT NULL DEFAULT 'pay'`);
  }
  const repo = createAttendanceRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteAttendanceRepositoryHandle;
}

/** Open a SQLite-backed LeavePolicyRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeavePolicyRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeavePolicyRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_POLICY);
  const repo = createLeavePolicyRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeavePolicyRepositoryHandle;
}

/** Open a SQLite-backed LeaveBalanceRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveBalanceRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveBalanceRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_BALANCE);
  const repo = createLeaveBalanceRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveBalanceRepositoryHandle;
}

/** Open a SQLite-backed LeaveAccrualBatchRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveAccrualBatchRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveAccrualBatchRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_ACCRUAL_BATCH);
  const repo = createLeaveAccrualBatchRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveAccrualBatchRepositoryHandle;
}
