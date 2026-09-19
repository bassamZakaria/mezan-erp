import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
 * Self-contained SQLite stores for the HR time & leave layer (docs/archive/catalog/06
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
  worked_minutes: number;
  approved_overtime_minutes: number | null;
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
    workedMinutes: row.worked_minutes,
    approvedOvertimeMinutes: row.approved_overtime_minutes ?? null,
    holidayCompensation: row.holiday_compensation === "day_off" ? "day_off" : "pay",
    status: row.status as AttendanceStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteAttendanceRepository implements AttendanceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByEmployeeAndDate: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_attendance (id, employee_id, date, check_in, check_out, worked_minutes, approved_overtime_minutes, holiday_compensation, status, notes, created_at, updated_at)
      VALUES (@id, @employee_id, @date, @check_in, @check_out, @worked_minutes, @approved_overtime_minutes, @holiday_compensation, @status, @notes, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        worked_minutes = excluded.worked_minutes,
        approved_overtime_minutes = excluded.approved_overtime_minutes,
        holiday_compensation = excluded.holiday_compensation,
        status = excluded.status,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_attendance WHERE id = ?`);
    this.selectByEmployeeAndDate = sqlite.prepare(`SELECT * FROM hr_attendance WHERE employee_id = ? AND date = ?`);
  }

  async findById(id: string): Promise<AttendanceEntry | null> {
    const row = this.selectById.get(id) as AttendanceRow | undefined;
    return row ? toAttendance(row) : null;
  }

  async findByEmployeeAndDate(employeeId: string, date: string): Promise<AttendanceEntry | null> {
    const row = this.selectByEmployeeAndDate.get(employeeId, date) as AttendanceRow | undefined;
    return row ? toAttendance(row) : null;
  }

  async list(filter: AttendanceFilter = {}): Promise<AttendanceEntry[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
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
    const rows = this.sqlite.prepare(`SELECT * FROM hr_attendance ${where} ORDER BY date DESC, employee_id`).all(...params) as AttendanceRow[];
    return rows.map(toAttendance);
  }

  async create(entry: AttendanceEntry): Promise<void> {
    this.write(entry);
  }

  async update(entry: AttendanceEntry): Promise<void> {
    this.write(entry);
  }

  private write(entry: AttendanceEntry): void {
    this.upsert.run({
      id: entry.id,
      employee_id: entry.employeeId,
      date: entry.date,
      check_in: entry.checkIn,
      check_out: entry.checkOut,
      worked_minutes: entry.workedMinutes,
      approved_overtime_minutes: entry.approvedOvertimeMinutes,
      holiday_compensation: entry.holidayCompensation,
      status: entry.status,
      notes: entry.notes,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    });
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
  entitlement_days: number;
  accrual_frequency: string;
  carry_over: number;
  max_carry_over_days: number | null;
  payout_on_termination: number;
  legally_mandated: number;
  preset_code: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toLeavePolicy(row: LeavePolicyRow): LeavePolicy {
  return {
    id: row.id,
    leaveType: row.leave_type as LeaveType,
    entitlementDays: Qty.fromScaled(row.entitlement_days),
    accrualFrequency: row.accrual_frequency as LeaveAccrualFrequency,
    carryOver: row.carry_over === 1,
    maxCarryOverDays: row.max_carry_over_days === null ? null : Qty.fromScaled(row.max_carry_over_days),
    payoutOnTermination: row.payout_on_termination === 1,
    legallyMandated: row.legally_mandated === 1,
    presetCode: row.preset_code,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteLeavePolicyRepository implements LeavePolicyRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByLeaveType: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_leave_policy (id, leave_type, entitlement_days, accrual_frequency, carry_over, max_carry_over_days, payout_on_termination, legally_mandated, preset_code, active, created_at, updated_at)
      VALUES (@id, @leave_type, @entitlement_days, @accrual_frequency, @carry_over, @max_carry_over_days, @payout_on_termination, @legally_mandated, @preset_code, @active, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        entitlement_days = excluded.entitlement_days,
        accrual_frequency = excluded.accrual_frequency,
        carry_over = excluded.carry_over,
        max_carry_over_days = excluded.max_carry_over_days,
        payout_on_termination = excluded.payout_on_termination,
        legally_mandated = excluded.legally_mandated,
        preset_code = excluded.preset_code,
        active = excluded.active,
        updated_at = excluded.updated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_leave_policy WHERE id = ?`);
    this.selectByLeaveType = sqlite.prepare(`SELECT * FROM hr_leave_policy WHERE leave_type = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_leave_policy ORDER BY leave_type`);
    this.deleteById = sqlite.prepare(`DELETE FROM hr_leave_policy WHERE id = ?`);
  }

  async findById(id: string): Promise<LeavePolicy | null> {
    const row = this.selectById.get(id) as LeavePolicyRow | undefined;
    return row ? toLeavePolicy(row) : null;
  }

  async findByLeaveType(leaveType: LeaveType): Promise<LeavePolicy | null> {
    const row = this.selectByLeaveType.get(leaveType) as LeavePolicyRow | undefined;
    return row ? toLeavePolicy(row) : null;
  }

  async list(): Promise<LeavePolicy[]> {
    return (this.selectAll.all() as LeavePolicyRow[]).map(toLeavePolicy);
  }

  async create(policy: LeavePolicy): Promise<void> {
    this.write(policy);
  }

  async update(policy: LeavePolicy): Promise<void> {
    this.write(policy);
  }

  async remove(id: string): Promise<void> {
    this.deleteById.run(id);
  }

  private write(policy: LeavePolicy): void {
    this.upsert.run({
      id: policy.id,
      leave_type: policy.leaveType,
      entitlement_days: policy.entitlementDays.toScaledNumber(),
      accrual_frequency: policy.accrualFrequency,
      carry_over: policy.carryOver ? 1 : 0,
      max_carry_over_days: policy.maxCarryOverDays === null ? null : policy.maxCarryOverDays.toScaledNumber(),
      payout_on_termination: policy.payoutOnTermination ? 1 : 0,
      legally_mandated: policy.legallyMandated ? 1 : 0,
      preset_code: policy.presetCode,
      active: policy.active ? 1 : 0,
      created_at: policy.createdAt,
      updated_at: policy.updatedAt,
    });
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
  year: number;
  entitled: number;
  carried_over: number;
  used: number;
  created_at: string;
  updated_at: string;
}

function toLeaveBalance(row: LeaveBalanceRow): LeaveBalance {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type as LeaveType,
    year: row.year,
    entitled: Qty.fromScaled(row.entitled),
    carriedOver: Qty.fromScaled(row.carried_over),
    used: Qty.fromScaled(row.used),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteLeaveBalanceRepository implements LeaveBalanceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectOne: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_leave_balance (id, employee_id, leave_type, year, entitled, carried_over, used, created_at, updated_at)
      VALUES (@id, @employee_id, @leave_type, @year, @entitled, @carried_over, @used, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        entitled = excluded.entitled,
        carried_over = excluded.carried_over,
        used = excluded.used,
        updated_at = excluded.updated_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_leave_balance WHERE id = ?`);
    this.selectOne = sqlite.prepare(`SELECT * FROM hr_leave_balance WHERE employee_id = ? AND leave_type = ? AND year = ?`);
  }

  async findById(id: string): Promise<LeaveBalance | null> {
    const row = this.selectById.get(id) as LeaveBalanceRow | undefined;
    return row ? toLeaveBalance(row) : null;
  }

  async find(employeeId: string, leaveType: LeaveType, year: number): Promise<LeaveBalance | null> {
    const row = this.selectOne.get(employeeId, leaveType, year) as LeaveBalanceRow | undefined;
    return row ? toLeaveBalance(row) : null;
  }

  async list(filter: LeaveBalanceFilter = {}): Promise<LeaveBalance[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
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
    const rows = this.sqlite
      .prepare(`SELECT * FROM hr_leave_balance ${where} ORDER BY year DESC, employee_id, leave_type`)
      .all(...params) as LeaveBalanceRow[];
    return rows.map(toLeaveBalance);
  }

  async create(balance: LeaveBalance): Promise<void> {
    this.write(balance);
  }

  async update(balance: LeaveBalance): Promise<void> {
    this.write(balance);
  }

  private write(balance: LeaveBalance): void {
    this.upsert.run({
      id: balance.id,
      employee_id: balance.employeeId,
      leave_type: balance.leaveType,
      year: balance.year,
      entitled: balance.entitled.toScaledNumber(),
      carried_over: balance.carriedOver.toScaledNumber(),
      used: balance.used.toScaledNumber(),
      created_at: balance.createdAt,
      updated_at: balance.updatedAt,
    });
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
  employee_count: number;
  total_days: number;
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
    employeeCount: row.employee_count,
    totalDays: Qty.fromScaled(row.total_days),
    lines,
    runBy: row.run_by,
    createdAt: row.created_at,
  };
}

class SqliteLeaveAccrualBatchRepository implements LeaveAccrualBatchRepository {
  private readonly insert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByPeriodKey: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByRunType: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO hr_leave_accrual_batch (id, number, period_key, frequency, run_type, run_date, notes, employee_count, total_days, lines_json, run_by, created_at)
      VALUES (@id, @number, @period_key, @frequency, @run_type, @run_date, @notes, @employee_count, @total_days, @lines_json, @run_by, @created_at)
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch WHERE id = ?`);
    this.selectByPeriodKey = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch WHERE period_key = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch ORDER BY run_date DESC, created_at DESC`);
    this.selectByRunType = sqlite.prepare(`SELECT * FROM hr_leave_accrual_batch WHERE run_type = ? ORDER BY run_date DESC, created_at DESC`);
  }

  async findById(id: string): Promise<LeaveAccrualBatch | null> {
    const row = this.selectById.get(id) as LeaveAccrualBatchRow | undefined;
    return row ? toLeaveAccrualBatch(row) : null;
  }

  async findByPeriodKey(periodKey: string): Promise<LeaveAccrualBatch | null> {
    const row = this.selectByPeriodKey.get(periodKey) as LeaveAccrualBatchRow | undefined;
    return row ? toLeaveAccrualBatch(row) : null;
  }

  async list(filter: LeaveAccrualBatchFilter = {}): Promise<LeaveAccrualBatch[]> {
    const rows = (filter.runType ? this.selectByRunType.all(filter.runType) : this.selectAll.all()) as LeaveAccrualBatchRow[];
    return rows.map(toLeaveAccrualBatch);
  }

  async create(batch: LeaveAccrualBatch): Promise<void> {
    this.insert.run({
      id: batch.id,
      number: batch.number,
      period_key: batch.periodKey,
      frequency: batch.frequency,
      run_type: batch.runType,
      run_date: batch.runDate,
      notes: batch.notes,
      employee_count: batch.employeeCount,
      total_days: batch.totalDays.toScaledNumber(),
      lines_json: JSON.stringify(batch.lines.map((l) => ({ employeeId: l.employeeId, leaveType: l.leaveType, days: l.days.toScaledNumber() }))),
      run_by: batch.runBy,
      created_at: batch.createdAt,
    });
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
  const repo = new SqliteAttendanceRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteAttendanceRepositoryHandle;
}

/** Open a SQLite-backed LeavePolicyRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeavePolicyRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeavePolicyRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_POLICY);
  const repo = new SqliteLeavePolicyRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeavePolicyRepositoryHandle;
}

/** Open a SQLite-backed LeaveBalanceRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveBalanceRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveBalanceRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_BALANCE);
  const repo = new SqliteLeaveBalanceRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveBalanceRepositoryHandle;
}

/** Open a SQLite-backed LeaveAccrualBatchRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteLeaveAccrualBatchRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeaveAccrualBatchRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAVE_ACCRUAL_BATCH);
  const repo = new SqliteLeaveAccrualBatchRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeaveAccrualBatchRepositoryHandle;
}
