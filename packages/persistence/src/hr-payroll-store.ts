import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type AdvanceInstallment,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeAdvanceStatus,
  type PayrollEmployeeNotice,
  type PayrollRun,
  type PayrollRunRepository,
  type PayrollRunStatus,
  type Payslip,
  type PayslipLine,
  type PayslipLineKind,
  type PayslipLineSource,
  type PayslipRepository,
} from "@mezan/domain";

/**
 * SQLite stores for HR payroll (docs/catalog/06 "الرواتب" / "سلف الموظفين").
 * Same single-file, single-table-per-entity style as `hr-store.ts`; the
 * instalment schedule and the payslip lines are JSON TEXT columns, and every
 * money column is the scaled INTEGER the `Money` value object round-trips.
 */

// --- Employee advances -----------------------------------------------------

const CREATE_ADVANCE = `
CREATE TABLE IF NOT EXISTS hr_employee_advance (
  id                          TEXT PRIMARY KEY,
  number                      TEXT NOT NULL UNIQUE,
  employee_id                 TEXT NOT NULL,
  amount                      INTEGER NOT NULL,
  currency                    TEXT NOT NULL,
  installment_count           INTEGER NOT NULL,
  first_deduction_date        TEXT NOT NULL,
  reason                      TEXT,
  installments_json           TEXT NOT NULL,
  status                      TEXT NOT NULL,
  requested_at                TEXT NOT NULL,
  decided_at                  TEXT,
  decided_by                  TEXT,
  disbursed_at                TEXT,
  disbursement_voucher_id     TEXT,
  disbursement_journal_entry_id TEXT,
  repaid_at                   TEXT,
  created_at                  TEXT NOT NULL
);
`;

interface AdvanceRow {
  id: string;
  number: string;
  employee_id: string;
  amount: number;
  currency: string;
  installment_count: number;
  first_deduction_date: string;
  reason: string | null;
  installments_json: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  disbursed_at: string | null;
  disbursement_voucher_id: string | null;
  disbursement_journal_entry_id: string | null;
  repaid_at: string | null;
  created_at: string;
}

interface SerializedInstallment {
  seq: number;
  dueDate: string;
  amount: number;
  recovered: number;
}

function serializeInstallments(items: readonly AdvanceInstallment[]): string {
  return JSON.stringify(
    items.map((i): SerializedInstallment => ({
      seq: i.seq,
      dueDate: i.dueDate,
      amount: i.amount.toScaledNumber(),
      recovered: i.recovered.toScaledNumber(),
    })),
  );
}

function deserializeInstallments(json: string): AdvanceInstallment[] {
  return (JSON.parse(json) as SerializedInstallment[]).map((i) => ({
    seq: i.seq,
    dueDate: i.dueDate,
    amount: Money.fromScaled(i.amount),
    recovered: Money.fromScaled(i.recovered),
  }));
}

function toAdvance(row: AdvanceRow): EmployeeAdvance {
  return {
    id: row.id,
    number: row.number,
    employeeId: row.employee_id,
    amount: Money.fromScaled(row.amount),
    currency: row.currency,
    installmentCount: row.installment_count,
    firstDeductionDate: row.first_deduction_date,
    reason: row.reason,
    installments: deserializeInstallments(row.installments_json),
    status: row.status as EmployeeAdvanceStatus,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    disbursedAt: row.disbursed_at,
    disbursementVoucherId: row.disbursement_voucher_id,
    disbursementJournalEntryId: row.disbursement_journal_entry_id,
    repaidAt: row.repaid_at,
    createdAt: row.created_at,
  };
}

class SqliteEmployeeAdvanceRepository implements EmployeeAdvanceRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByEmployee: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_employee_advance (
        id, number, employee_id, amount, currency, installment_count, first_deduction_date, reason,
        installments_json, status, requested_at, decided_at, decided_by, disbursed_at,
        disbursement_voucher_id, disbursement_journal_entry_id, repaid_at, created_at
      )
      VALUES (
        @id, @number, @employee_id, @amount, @currency, @installment_count, @first_deduction_date, @reason,
        @installments_json, @status, @requested_at, @decided_at, @decided_by, @disbursed_at,
        @disbursement_voucher_id, @disbursement_journal_entry_id, @repaid_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        amount = excluded.amount,
        currency = excluded.currency,
        installment_count = excluded.installment_count,
        first_deduction_date = excluded.first_deduction_date,
        reason = excluded.reason,
        installments_json = excluded.installments_json,
        status = excluded.status,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        disbursed_at = excluded.disbursed_at,
        disbursement_voucher_id = excluded.disbursement_voucher_id,
        disbursement_journal_entry_id = excluded.disbursement_journal_entry_id,
        repaid_at = excluded.repaid_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_employee_advance WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_employee_advance ORDER BY created_at DESC`);
    this.selectByEmployee = sqlite.prepare(`SELECT * FROM hr_employee_advance WHERE employee_id = ? ORDER BY created_at`);
  }

  async findById(id: string): Promise<EmployeeAdvance | null> {
    const row = this.selectById.get(id) as AdvanceRow | undefined;
    return row ? toAdvance(row) : null;
  }

  async list(): Promise<EmployeeAdvance[]> {
    return (this.selectAll.all() as AdvanceRow[]).map(toAdvance);
  }

  async listByEmployeeId(employeeId: string): Promise<EmployeeAdvance[]> {
    return (this.selectByEmployee.all(employeeId) as AdvanceRow[]).map(toAdvance);
  }

  async create(advance: EmployeeAdvance): Promise<void> {
    this.write(advance);
  }

  async update(advance: EmployeeAdvance): Promise<void> {
    this.write(advance);
  }

  private write(advance: EmployeeAdvance): void {
    this.upsert.run({
      id: advance.id,
      number: advance.number,
      employee_id: advance.employeeId,
      amount: advance.amount.toScaledNumber(),
      currency: advance.currency,
      installment_count: advance.installmentCount,
      first_deduction_date: advance.firstDeductionDate,
      reason: advance.reason,
      installments_json: serializeInstallments(advance.installments),
      status: advance.status,
      requested_at: advance.requestedAt,
      decided_at: advance.decidedAt,
      decided_by: advance.decidedBy,
      disbursed_at: advance.disbursedAt,
      disbursement_voucher_id: advance.disbursementVoucherId,
      disbursement_journal_entry_id: advance.disbursementJournalEntryId,
      repaid_at: advance.repaidAt,
      created_at: advance.createdAt,
    });
  }
}

// --- Payroll runs ----------------------------------------------------------

const CREATE_PAYROLL_RUN = `
CREATE TABLE IF NOT EXISTS hr_payroll_run (
  id                            TEXT PRIMARY KEY,
  number                        TEXT NOT NULL UNIQUE,
  year                          INTEGER NOT NULL,
  month                         INTEGER NOT NULL,
  period_start                  TEXT NOT NULL,
  period_end                    TEXT NOT NULL,
  branch_id                     TEXT,
  currency                      TEXT NOT NULL,
  status                        TEXT NOT NULL,
  employee_count                INTEGER NOT NULL,
  total_gross                   INTEGER NOT NULL,
  total_deductions              INTEGER NOT NULL,
  total_employer_contributions  INTEGER NOT NULL,
  total_net                     INTEGER NOT NULL,
  unpaid_leave_source           TEXT NOT NULL,
  warnings_json                 TEXT NOT NULL,
  employee_notices_json         TEXT NOT NULL DEFAULT '[]',
  journal_entry_id              TEXT,
  disbursement_voucher_id       TEXT,
  calculated_at                 TEXT,
  approved_at                   TEXT,
  approved_by                   TEXT,
  disbursed_at                  TEXT,
  cancelled_at                  TEXT,
  created_at                    TEXT NOT NULL
);
`;

interface PayrollRunRow {
  id: string;
  number: string;
  year: number;
  month: number;
  period_start: string;
  period_end: string;
  branch_id: string | null;
  currency: string;
  status: string;
  employee_count: number;
  total_gross: number;
  total_deductions: number;
  total_employer_contributions: number;
  total_net: number;
  unpaid_leave_source: string;
  warnings_json: string;
  employee_notices_json: string | null;
  journal_entry_id: string | null;
  disbursement_voucher_id: string | null;
  calculated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  disbursed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

function toPayrollRun(row: PayrollRunRow): PayrollRun {
  return {
    id: row.id,
    number: row.number,
    year: row.year,
    month: row.month,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    branchId: row.branch_id,
    currency: row.currency,
    status: row.status as PayrollRunStatus,
    employeeCount: row.employee_count,
    totalGross: Money.fromScaled(row.total_gross),
    totalDeductions: Money.fromScaled(row.total_deductions),
    totalEmployerContributions: Money.fromScaled(row.total_employer_contributions),
    totalNet: Money.fromScaled(row.total_net),
    unpaidLeaveSource: row.unpaid_leave_source === "provider" ? "provider" : "none",
    warnings: JSON.parse(row.warnings_json) as string[],
    employeeNotices: JSON.parse(row.employee_notices_json ?? "[]") as PayrollEmployeeNotice[],
    journalEntryId: row.journal_entry_id,
    disbursementVoucherId: row.disbursement_voucher_id,
    calculatedAt: row.calculated_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    disbursedAt: row.disbursed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

class SqlitePayrollRunRepository implements PayrollRunRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByPeriod: Database.Statement;
  private readonly selectByPeriodNullBranch: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_payroll_run (
        id, number, year, month, period_start, period_end, branch_id, currency, status, employee_count,
        total_gross, total_deductions, total_employer_contributions, total_net, unpaid_leave_source,
        warnings_json, employee_notices_json, journal_entry_id, disbursement_voucher_id, calculated_at, approved_at,
        approved_by, disbursed_at, cancelled_at, created_at
      )
      VALUES (
        @id, @number, @year, @month, @period_start, @period_end, @branch_id, @currency, @status, @employee_count,
        @total_gross, @total_deductions, @total_employer_contributions, @total_net, @unpaid_leave_source,
        @warnings_json, @employee_notices_json, @journal_entry_id, @disbursement_voucher_id, @calculated_at, @approved_at,
        @approved_by, @disbursed_at, @cancelled_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        employee_count = excluded.employee_count,
        total_gross = excluded.total_gross,
        total_deductions = excluded.total_deductions,
        total_employer_contributions = excluded.total_employer_contributions,
        total_net = excluded.total_net,
        unpaid_leave_source = excluded.unpaid_leave_source,
        warnings_json = excluded.warnings_json,
        employee_notices_json = excluded.employee_notices_json,
        journal_entry_id = excluded.journal_entry_id,
        disbursement_voucher_id = excluded.disbursement_voucher_id,
        calculated_at = excluded.calculated_at,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        disbursed_at = excluded.disbursed_at,
        cancelled_at = excluded.cancelled_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_payroll_run WHERE id = ?`);
    this.selectByPeriod = sqlite.prepare(`SELECT * FROM hr_payroll_run WHERE year = ? AND month = ? AND branch_id = ?`);
    this.selectByPeriodNullBranch = sqlite.prepare(`SELECT * FROM hr_payroll_run WHERE year = ? AND month = ? AND branch_id IS NULL`);
    this.selectAll = sqlite.prepare(`SELECT * FROM hr_payroll_run ORDER BY year DESC, month DESC, created_at DESC`);
  }

  async findById(id: string): Promise<PayrollRun | null> {
    const row = this.selectById.get(id) as PayrollRunRow | undefined;
    return row ? toPayrollRun(row) : null;
  }

  async findByPeriod(year: number, month: number, branchId: string | null): Promise<PayrollRun | null> {
    const row = (
      branchId === null ? this.selectByPeriodNullBranch.get(year, month) : this.selectByPeriod.get(year, month, branchId)
    ) as PayrollRunRow | undefined;
    return row ? toPayrollRun(row) : null;
  }

  async list(): Promise<PayrollRun[]> {
    return (this.selectAll.all() as PayrollRunRow[]).map(toPayrollRun);
  }

  async create(run: PayrollRun): Promise<void> {
    this.write(run);
  }

  async update(run: PayrollRun): Promise<void> {
    this.write(run);
  }

  private write(run: PayrollRun): void {
    this.upsert.run({
      id: run.id,
      number: run.number,
      year: run.year,
      month: run.month,
      period_start: run.periodStart,
      period_end: run.periodEnd,
      branch_id: run.branchId,
      currency: run.currency,
      status: run.status,
      employee_count: run.employeeCount,
      total_gross: run.totalGross.toScaledNumber(),
      total_deductions: run.totalDeductions.toScaledNumber(),
      total_employer_contributions: run.totalEmployerContributions.toScaledNumber(),
      total_net: run.totalNet.toScaledNumber(),
      unpaid_leave_source: run.unpaidLeaveSource,
      warnings_json: JSON.stringify(run.warnings),
      employee_notices_json: JSON.stringify(run.employeeNotices),
      journal_entry_id: run.journalEntryId,
      disbursement_voucher_id: run.disbursementVoucherId,
      calculated_at: run.calculatedAt,
      approved_at: run.approvedAt,
      approved_by: run.approvedBy,
      disbursed_at: run.disbursedAt,
      cancelled_at: run.cancelledAt,
      created_at: run.createdAt,
    });
  }
}

// --- Payslips --------------------------------------------------------------

const CREATE_PAYSLIP = `
CREATE TABLE IF NOT EXISTS hr_payslip (
  id                      TEXT PRIMARY KEY,
  number                  TEXT NOT NULL UNIQUE,
  run_id                  TEXT NOT NULL,
  employee_id             TEXT NOT NULL,
  contract_id             TEXT NOT NULL,
  currency                TEXT NOT NULL,
  period_start            TEXT NOT NULL,
  period_end              TEXT NOT NULL,
  period_days             INTEGER NOT NULL,
  paid_days               INTEGER NOT NULL,
  lines_json              TEXT NOT NULL,
  gross_earnings          INTEGER NOT NULL,
  total_deductions        INTEGER NOT NULL,
  employer_contributions  INTEGER NOT NULL,
  net_pay                 INTEGER NOT NULL,
  created_at              TEXT NOT NULL
);
`;

interface PayslipRow {
  id: string;
  number: string;
  run_id: string;
  employee_id: string;
  contract_id: string;
  currency: string;
  period_start: string;
  period_end: string;
  period_days: number;
  paid_days: number;
  lines_json: string;
  gross_earnings: number;
  total_deductions: number;
  employer_contributions: number;
  net_pay: number;
  created_at: string;
}

interface SerializedPayslipLine {
  id: string;
  kind: string;
  source: string;
  nameAr: string;
  amount: number;
  glAccountId: string | null;
  referenceId: string | null;
}

function serializeLines(lines: readonly PayslipLine[]): string {
  return JSON.stringify(
    lines.map((l): SerializedPayslipLine => ({
      id: l.id,
      kind: l.kind,
      source: l.source,
      nameAr: l.nameAr,
      amount: l.amount.toScaledNumber(),
      glAccountId: l.glAccountId,
      referenceId: l.referenceId,
    })),
  );
}

function deserializeLines(json: string): PayslipLine[] {
  return (JSON.parse(json) as SerializedPayslipLine[]).map((l) => ({
    id: l.id,
    kind: l.kind as PayslipLineKind,
    source: l.source as PayslipLineSource,
    nameAr: l.nameAr,
    amount: Money.fromScaled(l.amount),
    glAccountId: l.glAccountId,
    referenceId: l.referenceId,
  }));
}

function toPayslip(row: PayslipRow): Payslip {
  return {
    id: row.id,
    number: row.number,
    runId: row.run_id,
    employeeId: row.employee_id,
    contractId: row.contract_id,
    currency: row.currency,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodDays: row.period_days,
    paidDays: row.paid_days,
    lines: deserializeLines(row.lines_json),
    grossEarnings: Money.fromScaled(row.gross_earnings),
    totalDeductions: Money.fromScaled(row.total_deductions),
    employerContributions: Money.fromScaled(row.employer_contributions),
    netPay: Money.fromScaled(row.net_pay),
    createdAt: row.created_at,
  };
}

class SqlitePayslipRepository implements PayslipRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByRun: Database.Statement;
  private readonly selectByEmployee: Database.Statement;
  private readonly deleteByRun: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO hr_payslip (
        id, number, run_id, employee_id, contract_id, currency, period_start, period_end, period_days, paid_days,
        lines_json, gross_earnings, total_deductions, employer_contributions, net_pay, created_at
      )
      VALUES (
        @id, @number, @run_id, @employee_id, @contract_id, @currency, @period_start, @period_end, @period_days, @paid_days,
        @lines_json, @gross_earnings, @total_deductions, @employer_contributions, @net_pay, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        lines_json = excluded.lines_json,
        gross_earnings = excluded.gross_earnings,
        total_deductions = excluded.total_deductions,
        employer_contributions = excluded.employer_contributions,
        net_pay = excluded.net_pay
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM hr_payslip WHERE id = ?`);
    this.selectByRun = sqlite.prepare(`SELECT * FROM hr_payslip WHERE run_id = ? ORDER BY number`);
    this.selectByEmployee = sqlite.prepare(`SELECT * FROM hr_payslip WHERE employee_id = ? ORDER BY period_start DESC`);
    this.deleteByRun = sqlite.prepare(`DELETE FROM hr_payslip WHERE run_id = ?`);
  }

  async findById(id: string): Promise<Payslip | null> {
    const row = this.selectById.get(id) as PayslipRow | undefined;
    return row ? toPayslip(row) : null;
  }

  async listByRunId(runId: string): Promise<Payslip[]> {
    return (this.selectByRun.all(runId) as PayslipRow[]).map(toPayslip);
  }

  async listByEmployeeId(employeeId: string): Promise<Payslip[]> {
    return (this.selectByEmployee.all(employeeId) as PayslipRow[]).map(toPayslip);
  }

  async create(payslip: Payslip): Promise<void> {
    this.upsert.run({
      id: payslip.id,
      number: payslip.number,
      run_id: payslip.runId,
      employee_id: payslip.employeeId,
      contract_id: payslip.contractId,
      currency: payslip.currency,
      period_start: payslip.periodStart,
      period_end: payslip.periodEnd,
      period_days: payslip.periodDays,
      paid_days: payslip.paidDays,
      lines_json: serializeLines(payslip.lines),
      gross_earnings: payslip.grossEarnings.toScaledNumber(),
      total_deductions: payslip.totalDeductions.toScaledNumber(),
      employer_contributions: payslip.employerContributions.toScaledNumber(),
      net_pay: payslip.netPay.toScaledNumber(),
      created_at: payslip.createdAt,
    });
  }

  async deleteByRunId(runId: string): Promise<void> {
    this.deleteByRun.run(runId);
  }
}

// --- Factories -------------------------------------------------------------

export interface SqliteEmployeeAdvanceRepositoryHandle extends EmployeeAdvanceRepository {
  close(): void;
}
export interface SqlitePayrollRunRepositoryHandle extends PayrollRunRepository {
  close(): void;
}
export interface SqlitePayslipRepositoryHandle extends PayslipRepository {
  close(): void;
}

/** Open a SQLite-backed EmployeeAdvanceRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteEmployeeAdvanceRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeAdvanceRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_ADVANCE);
  const repo = new SqliteEmployeeAdvanceRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteEmployeeAdvanceRepositoryHandle;
}

/**
 * `employee_notices_json` was added after the table shipped; CREATE TABLE IF
 * NOT EXISTS will not add it to an existing database, so widen it in place.
 */
function addMissingPayrollRunColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(hr_payroll_run)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "employee_notices_json")) {
    sqlite.exec(`ALTER TABLE hr_payroll_run ADD COLUMN employee_notices_json TEXT NOT NULL DEFAULT '[]'`);
  }
}

/** Open a SQLite-backed PayrollRunRepository. */
export function createSqlitePayrollRunRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayrollRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PAYROLL_RUN);
  addMissingPayrollRunColumns(sqlite);
  const repo = new SqlitePayrollRunRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayrollRunRepositoryHandle;
}

/** Open a SQLite-backed PayslipRepository. */
export function createSqlitePayslipRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayslipRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PAYSLIP);
  const repo = new SqlitePayslipRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayslipRepositoryHandle;
}
