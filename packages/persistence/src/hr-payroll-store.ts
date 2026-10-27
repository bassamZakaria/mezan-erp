import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type AdvanceInstallment,
  type AdvanceRepayment,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
  type EmployeeAdvanceStatus,
  type PayrollRun,
  type PayrollRunRepository,
  type PayrollRunStatus,
  type PayBasis,
  type Payslip,
  type PayslipBasis,
  type PayslipLine,
  type PayslipLineKind,
  type PayslipLineSource,
  type PayslipRepository,
  type PayrollComponent,
  type PayrollComponentFilter,
  type PayrollComponentKind,
  type PayrollComponentRepository,
  type GarnishmentFilter,
  type GarnishmentKind,
  type GarnishmentRecord,
  type GarnishmentRepository,
  type SocialInsuranceYearOverride,
  DEFAULT_PAYROLL_STATUTORY_FLAG,
  type PayrollStatutoryFlag,
  type PayrollStatutoryFlagRepository,
  type StatutoryOverrideRepository,
} from "@mezan/domain";

/**
 * Stores for HR payroll (docs/archive/catalog/06 "الرواتب" / "سلف الموظفين").
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
  created_at                  TEXT NOT NULL,
  repayments_json             TEXT
);
`;

interface AdvanceRow {
  id: string;
  number: string;
  employee_id: string;
  amount: bigint;
  currency: string;
  installment_count: bigint;
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
  repayments_json: string | null;
}

interface SerializedRepayment {
  id: string;
  date: string;
  amount: string;
  paymentMethod: string;
  treasuryAccountId: string;
  voucherId: string;
  voucherNo: string | null;
  journalEntryId: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

function serializeRepayments(items: readonly AdvanceRepayment[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  return JSON.stringify(items.map((r): SerializedRepayment => ({ ...r, amount: r.amount.scaled.toString() })));
}

function deserializeRepayments(json: string | null): AdvanceRepayment[] {
  if (!json) return [];
  return (JSON.parse(json) as SerializedRepayment[]).map((r) => ({ ...r, amount: Money.fromScaled(BigInt(r.amount)) }));
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
    installmentCount: Number(row.installment_count),
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
    repayments: deserializeRepayments(row.repayments_json),
  };
}

function advanceParams(advance: EmployeeAdvance): SqlValue[] {
  return [
    advance.id,
    advance.number,
    advance.employeeId,
    advance.amount.scaled,
    advance.currency,
    advance.installmentCount,
    advance.firstDeductionDate,
    advance.reason,
    serializeInstallments(advance.installments),
    advance.status,
    advance.requestedAt,
    advance.decidedAt,
    advance.decidedBy,
    advance.disbursedAt,
    advance.disbursementVoucherId,
    advance.disbursementJournalEntryId,
    advance.repaidAt,
    advance.createdAt,
    serializeRepayments(advance.repayments),
  ];
}

const ADVANCE_UPSERT = `
      INSERT INTO hr_employee_advance (
        id, number, employee_id, amount, currency, installment_count, first_deduction_date, reason,
        installments_json, status, requested_at, decided_at, decided_by, disbursed_at,
        disbursement_voucher_id, disbursement_journal_entry_id, repaid_at, created_at, repayments_json
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
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
        repaid_at = excluded.repaid_at,
        repayments_json = excluded.repayments_json
    `;

class SqlEmployeeAdvanceRepository implements EmployeeAdvanceRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<EmployeeAdvance | null> {
    const row = await this.db.get<AdvanceRow>(`SELECT * FROM hr_employee_advance WHERE id = ?`, [id]);
    return row ? toAdvance(row) : null;
  }

  async list(): Promise<EmployeeAdvance[]> {
    return (await this.db.all<AdvanceRow>(`SELECT * FROM hr_employee_advance ORDER BY created_at DESC`)).map(toAdvance);
  }

  async listByEmployeeId(employeeId: string): Promise<EmployeeAdvance[]> {
    return (await this.db.all<AdvanceRow>(`SELECT * FROM hr_employee_advance WHERE employee_id = ? ORDER BY created_at`, [employeeId])).map(toAdvance);
  }

  async create(advance: EmployeeAdvance): Promise<void> {
    await insertNew(this.db, advance.id, ADVANCE_UPSERT, advanceParams(advance));
  }

  async update(advance: EmployeeAdvance): Promise<void> {
    await this.db.run(ADVANCE_UPSERT, advanceParams(advance));
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
  total_employer_cost           INTEGER,
  unpaid_leave_source           TEXT NOT NULL,
  overtime_source               TEXT NOT NULL DEFAULT 'none',
  statutory_tables_json         TEXT NOT NULL DEFAULT '[]',
  warnings_json                 TEXT NOT NULL,
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
  year: bigint;
  month: bigint;
  period_start: string;
  period_end: string;
  branch_id: string | null;
  currency: string;
  status: string;
  employee_count: bigint;
  total_gross: bigint;
  total_deductions: bigint;
  total_employer_contributions: bigint;
  total_net: bigint;
  total_employer_cost: bigint | null;
  unpaid_leave_source: string;
  overtime_source: string | null;
  statutory_tables_json: string | null;
  warnings_json: string;
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
    year: Number(row.year),
    month: Number(row.month),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    branchId: row.branch_id,
    currency: row.currency,
    status: row.status as PayrollRunStatus,
    employeeCount: Number(row.employee_count),
    totalGross: Money.fromScaled(row.total_gross),
    totalDeductions: Money.fromScaled(row.total_deductions),
    totalEmployerContributions: Money.fromScaled(row.total_employer_contributions),
    totalNet: Money.fromScaled(row.total_net),
    // D191: NULL means this run predates the column — never fabricate 0, which
    // the payroll register could not tell apart from a genuinely zero cost.
    totalEmployerCost: row.total_employer_cost === null ? null : Money.fromScaled(row.total_employer_cost),
    unpaidLeaveSource: row.unpaid_leave_source === "provider" ? "provider" : "none",
    overtimeSource: row.overtime_source === "provider" ? "provider" : "none",
    statutoryTableCodes: JSON.parse(row.statutory_tables_json ?? "[]") as string[],
    warnings: JSON.parse(row.warnings_json) as string[],
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

function payrollRunParams(run: PayrollRun): SqlValue[] {
  return [
    run.id,
    run.number,
    run.year,
    run.month,
    run.periodStart,
    run.periodEnd,
    run.branchId,
    run.currency,
    run.status,
    run.employeeCount,
    run.totalGross.scaled,
    run.totalDeductions.scaled,
    run.totalEmployerContributions.scaled,
    run.totalNet.scaled,
    run.totalEmployerCost === null ? null : run.totalEmployerCost.scaled,
    run.unpaidLeaveSource,
    run.overtimeSource,
    JSON.stringify(run.statutoryTableCodes),
    JSON.stringify(run.warnings),
    run.journalEntryId,
    run.disbursementVoucherId,
    run.calculatedAt,
    run.approvedAt,
    run.approvedBy,
    run.disbursedAt,
    run.cancelledAt,
    run.createdAt,
  ];
}

const PAYROLL_RUN_UPSERT = `
      INSERT INTO hr_payroll_run (
        id, number, year, month, period_start, period_end, branch_id, currency, status, employee_count,
        total_gross, total_deductions, total_employer_contributions, total_net, total_employer_cost,
        unpaid_leave_source, overtime_source, statutory_tables_json,
        warnings_json, journal_entry_id, disbursement_voucher_id, calculated_at, approved_at, approved_by,
        disbursed_at, cancelled_at, created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        employee_count = excluded.employee_count,
        total_gross = excluded.total_gross,
        total_deductions = excluded.total_deductions,
        total_employer_contributions = excluded.total_employer_contributions,
        total_net = excluded.total_net,
        total_employer_cost = excluded.total_employer_cost,
        unpaid_leave_source = excluded.unpaid_leave_source,
        overtime_source = excluded.overtime_source,
        statutory_tables_json = excluded.statutory_tables_json,
        warnings_json = excluded.warnings_json,
        journal_entry_id = excluded.journal_entry_id,
        disbursement_voucher_id = excluded.disbursement_voucher_id,
        calculated_at = excluded.calculated_at,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        disbursed_at = excluded.disbursed_at,
        cancelled_at = excluded.cancelled_at
    `;

class SqlPayrollRunRepository implements PayrollRunRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PayrollRun | null> {
    const row = await this.db.get<PayrollRunRow>(`SELECT * FROM hr_payroll_run WHERE id = ?`, [id]);
    return row ? toPayrollRun(row) : null;
  }

  async findByPeriod(year: number, month: number, branchId: string | null): Promise<PayrollRun | null> {
    const row =
      branchId === null
        ? await this.db.get<PayrollRunRow>(`SELECT * FROM hr_payroll_run WHERE year = ? AND month = ? AND branch_id IS NULL`, [year, month])
        : await this.db.get<PayrollRunRow>(`SELECT * FROM hr_payroll_run WHERE year = ? AND month = ? AND branch_id = ?`, [year, month, branchId]);
    return row ? toPayrollRun(row) : null;
  }

  async list(): Promise<PayrollRun[]> {
    return (await this.db.all<PayrollRunRow>(`SELECT * FROM hr_payroll_run ORDER BY year DESC, month DESC, created_at DESC`)).map(toPayrollRun);
  }

  async create(run: PayrollRun): Promise<void> {
    await insertNew(this.db, run.id, PAYROLL_RUN_UPSERT, payrollRunParams(run));
  }

  async update(run: PayrollRun): Promise<void> {
    await this.db.run(PAYROLL_RUN_UPSERT, payrollRunParams(run));
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
  insurable_wage          INTEGER NOT NULL DEFAULT 0,
  insurable_wage_capped   INTEGER NOT NULL DEFAULT 0,
  annual_taxable_income   INTEGER NOT NULL DEFAULT 0,
  total_employer_cost     INTEGER,
  basis_json              TEXT,
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
  period_days: bigint;
  paid_days: bigint;
  lines_json: string;
  gross_earnings: bigint;
  total_deductions: bigint;
  employer_contributions: bigint;
  net_pay: bigint;
  insurable_wage: bigint | null;
  insurable_wage_capped: bigint | null;
  annual_taxable_income: bigint | null;
  total_employer_cost: bigint | null;
  basis_json: string | null;
  created_at: string;
}

interface SerializedPayslipBasis {
  payBasis: string;
  quantity: number | null;
  rate: string;
  contractCurrency: string;
  fxRate: string | null;
  fxRateDate: string | null;
  grossInContractCurrency: string | null;
  netInContractCurrency: string | null;
}

function serializeBasis(basis: PayslipBasis | null): string | null {
  if (!basis) return null;
  const json: SerializedPayslipBasis = {
    payBasis: basis.payBasis,
    quantity: basis.quantity,
    rate: basis.rate.toString(),
    contractCurrency: basis.contractCurrency,
    fxRate: basis.fxRate,
    fxRateDate: basis.fxRateDate,
    grossInContractCurrency: basis.grossInContractCurrency?.toString() ?? null,
    netInContractCurrency: basis.netInContractCurrency?.toString() ?? null,
  };
  return JSON.stringify(json);
}

function deserializeBasis(json: string | null): PayslipBasis | null {
  if (!json) return null;
  const b = JSON.parse(json) as SerializedPayslipBasis;
  return {
    payBasis: b.payBasis as PayBasis,
    quantity: b.quantity,
    rate: Money.fromMajor(b.rate),
    contractCurrency: b.contractCurrency,
    fxRate: b.fxRate,
    fxRateDate: b.fxRateDate,
    grossInContractCurrency: b.grossInContractCurrency === null ? null : Money.fromMajor(b.grossInContractCurrency),
    netInContractCurrency: b.netInContractCurrency === null ? null : Money.fromMajor(b.netInContractCurrency),
  };
}

interface SerializedPayslipLine {
  id: string;
  kind: string;
  source: string;
  nameAr: string;
  amount: number;
  glAccountId: string | null;
  referenceId: string | null;
  /** Optional — absent on rows written before the garnishment cap shipped. */
  capped?: boolean;
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
      capped: l.capped,
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
    capped: l.capped ?? false,
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
    periodDays: Number(row.period_days),
    paidDays: Number(row.paid_days),
    lines: deserializeLines(row.lines_json),
    grossEarnings: Money.fromScaled(row.gross_earnings),
    totalDeductions: Money.fromScaled(row.total_deductions),
    employerContributions: Money.fromScaled(row.employer_contributions),
    netPay: Money.fromScaled(row.net_pay),
    insurableWage: Money.fromScaled(row.insurable_wage ?? 0n),
    insurableWageCapped: Number(row.insurable_wage_capped ?? 0n) === 1,
    annualTaxableIncome: Money.fromScaled(row.annual_taxable_income ?? 0n),
    // D191: as toPayrollRun above — NULL means never computed, not a genuine zero.
    totalEmployerCost: row.total_employer_cost === null ? null : Money.fromScaled(row.total_employer_cost),
    basis: deserializeBasis(row.basis_json ?? null),
    createdAt: row.created_at,
  };
}

function payslipParams(payslip: Payslip): SqlValue[] {
  return [
    payslip.id,
    payslip.number,
    payslip.runId,
    payslip.employeeId,
    payslip.contractId,
    payslip.currency,
    payslip.periodStart,
    payslip.periodEnd,
    payslip.periodDays,
    payslip.paidDays,
    serializeLines(payslip.lines),
    payslip.grossEarnings.scaled,
    payslip.totalDeductions.scaled,
    payslip.employerContributions.scaled,
    payslip.netPay.scaled,
    payslip.insurableWage.scaled,
    payslip.insurableWageCapped ? 1 : 0,
    payslip.annualTaxableIncome.scaled,
    payslip.totalEmployerCost === null ? null : payslip.totalEmployerCost.scaled,
    serializeBasis(payslip.basis ?? null),
    payslip.createdAt,
  ];
}

const PAYSLIP_UPSERT = `
      INSERT INTO hr_payslip (
        id, number, run_id, employee_id, contract_id, currency, period_start, period_end, period_days, paid_days,
        lines_json, gross_earnings, total_deductions, employer_contributions, net_pay,
        insurable_wage, insurable_wage_capped, annual_taxable_income, total_employer_cost, basis_json, created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        lines_json = excluded.lines_json,
        gross_earnings = excluded.gross_earnings,
        total_deductions = excluded.total_deductions,
        employer_contributions = excluded.employer_contributions,
        net_pay = excluded.net_pay,
        insurable_wage = excluded.insurable_wage,
        insurable_wage_capped = excluded.insurable_wage_capped,
        annual_taxable_income = excluded.annual_taxable_income,
        total_employer_cost = excluded.total_employer_cost,
        basis_json = excluded.basis_json
    `;

class SqlPayslipRepository implements PayslipRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Payslip | null> {
    const row = await this.db.get<PayslipRow>(`SELECT * FROM hr_payslip WHERE id = ?`, [id]);
    return row ? toPayslip(row) : null;
  }

  async listByRunId(runId: string): Promise<Payslip[]> {
    return (await this.db.all<PayslipRow>(`SELECT * FROM hr_payslip WHERE run_id = ? ORDER BY number`, [runId])).map(toPayslip);
  }

  async listByEmployeeId(employeeId: string): Promise<Payslip[]> {
    return (await this.db.all<PayslipRow>(`SELECT * FROM hr_payslip WHERE employee_id = ? ORDER BY period_start DESC`, [employeeId])).map(toPayslip);
  }

  async create(payslip: Payslip): Promise<void> {
    await this.db.run(PAYSLIP_UPSERT, payslipParams(payslip));
  }

  async deleteByRunId(runId: string): Promise<void> {
    await this.db.run(`DELETE FROM hr_payslip WHERE run_id = ?`, [runId]);
  }
}

// --- Garnishments ----------------------------------------------------------

const CREATE_GARNISHMENT = `
CREATE TABLE IF NOT EXISTS hr_garnishment (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  kind           TEXT NOT NULL,
  reference      TEXT NOT NULL,
  label_ar       TEXT NOT NULL,
  total_amount   INTEGER NOT NULL,
  monthly_amount INTEGER NOT NULL,
  outstanding    INTEGER NOT NULL,
  recovered      INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  notes          TEXT,
  active         INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_garnishment_employee_idx ON hr_garnishment (employee_id);
`;

interface GarnishmentRow {
  id: string;
  employee_id: string;
  kind: string;
  reference: string;
  label_ar: string;
  total_amount: bigint;
  monthly_amount: bigint;
  outstanding: bigint;
  recovered: bigint;
  currency: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  active: bigint;
  created_at: string;
  updated_at: string;
}

function toGarnishment(row: GarnishmentRow): GarnishmentRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind as GarnishmentKind,
    reference: row.reference,
    labelAr: row.label_ar,
    totalAmount: Money.fromScaled(row.total_amount),
    monthlyAmount: Money.fromScaled(row.monthly_amount),
    outstanding: Money.fromScaled(row.outstanding),
    recovered: Money.fromScaled(row.recovered),
    currency: row.currency,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function garnishmentParams(record: GarnishmentRecord): SqlValue[] {
  return [
    record.id,
    record.employeeId,
    record.kind,
    record.reference,
    record.labelAr,
    record.totalAmount.scaled,
    record.monthlyAmount.scaled,
    record.outstanding.scaled,
    record.recovered.scaled,
    record.currency,
    record.startDate,
    record.endDate,
    record.notes,
    record.active ? 1 : 0,
    record.createdAt,
    record.updatedAt,
  ];
}

const GARNISHMENT_UPSERT = `
      INSERT INTO hr_garnishment (
        id, employee_id, kind, reference, label_ar, total_amount, monthly_amount, outstanding, recovered,
        currency, start_date, end_date, notes, active, created_at, updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        reference = excluded.reference,
        label_ar = excluded.label_ar,
        total_amount = excluded.total_amount,
        monthly_amount = excluded.monthly_amount,
        outstanding = excluded.outstanding,
        recovered = excluded.recovered,
        currency = excluded.currency,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        notes = excluded.notes,
        active = excluded.active,
        updated_at = excluded.updated_at
    `;

class SqlGarnishmentRepository implements GarnishmentRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<GarnishmentRecord | null> {
    const row = await this.db.get<GarnishmentRow>(`SELECT * FROM hr_garnishment WHERE id = ?`, [id]);
    return row ? toGarnishment(row) : null;
  }

  async list(filter?: GarnishmentFilter): Promise<GarnishmentRecord[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter?.employeeId) {
      clauses.push("employee_id = ?");
      params.push(filter.employeeId);
    }
    if (filter?.active !== undefined && filter.active !== null) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<GarnishmentRow>(`SELECT * FROM hr_garnishment ${where} ORDER BY start_date DESC, reference`, params);
    return rows.map(toGarnishment);
  }

  async listByEmployeeId(employeeId: string): Promise<GarnishmentRecord[]> {
    return (await this.db.all<GarnishmentRow>(`SELECT * FROM hr_garnishment WHERE employee_id = ? ORDER BY start_date DESC, reference`, [employeeId])).map(toGarnishment);
  }

  async create(record: GarnishmentRecord): Promise<void> {
    await insertNew(this.db, record.id, GARNISHMENT_UPSERT, garnishmentParams(record));
  }

  async update(record: GarnishmentRecord): Promise<void> {
    await this.db.run(GARNISHMENT_UPSERT, garnishmentParams(record));
  }
}

// --- Statutory year overrides ----------------------------------------------

const CREATE_STATUTORY_OVERRIDE = `
CREATE TABLE IF NOT EXISTS hr_statutory_insurance_year (
  year                  INTEGER PRIMARY KEY,
  monthly_wage_floor    TEXT NOT NULL,
  monthly_wage_ceiling  TEXT NOT NULL,
  note                  TEXT,
  entered_by            TEXT NOT NULL,
  entered_at            TEXT NOT NULL
);
`;

interface StatutoryOverrideRow {
  year: bigint;
  monthly_wage_floor: string;
  monthly_wage_ceiling: string;
  note: string | null;
  entered_by: string;
  entered_at: string;
}

/**
 * Limits are stored as the EXACT decimal STRING an admin typed off the decree,
 * not as a scaled integer: this row is a transcription of a published figure,
 * and it has to read back identically to what is on the paper.
 */
function toOverride(row: StatutoryOverrideRow): SocialInsuranceYearOverride {
  return {
    year: Number(row.year),
    monthlyWageFloor: row.monthly_wage_floor,
    monthlyWageCeiling: row.monthly_wage_ceiling,
    note: row.note,
    enteredBy: row.entered_by,
    enteredAt: row.entered_at,
  };
}

function overrideParams(override: SocialInsuranceYearOverride): SqlValue[] {
  return [
    override.year,
    override.monthlyWageFloor,
    override.monthlyWageCeiling,
    override.note,
    override.enteredBy,
    override.enteredAt,
  ];
}

const STATUTORY_OVERRIDE_UPSERT = `
      INSERT INTO hr_statutory_insurance_year (year, monthly_wage_floor, monthly_wage_ceiling, note, entered_by, entered_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(year) DO UPDATE SET
        monthly_wage_floor = excluded.monthly_wage_floor,
        monthly_wage_ceiling = excluded.monthly_wage_ceiling,
        note = excluded.note,
        entered_by = excluded.entered_by,
        entered_at = excluded.entered_at
    `;

class SqlStatutoryOverrideRepository implements StatutoryOverrideRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<SocialInsuranceYearOverride[]> {
    return (await this.db.all<StatutoryOverrideRow>(`SELECT * FROM hr_statutory_insurance_year ORDER BY year`)).map(toOverride);
  }

  async findByYear(year: number): Promise<SocialInsuranceYearOverride | null> {
    const row = await this.db.get<StatutoryOverrideRow>(`SELECT * FROM hr_statutory_insurance_year WHERE year = ?`, [year]);
    return row ? toOverride(row) : null;
  }

  async upsert(override: SocialInsuranceYearOverride): Promise<void> {
    await this.db.run(STATUTORY_OVERRIDE_UPSERT, overrideParams(override));
  }

  async remove(year: number): Promise<void> {
    await this.db.run(`DELETE FROM hr_statutory_insurance_year WHERE year = ?`, [year]);
  }
}

// --- Schema migrations -----------------------------------------------------

/**
 * Adds columns an older database predates. Statutory payroll landed after the
 * first payroll runs existed, so an install that already holds runs must gain
 * the new columns rather than be recreated — the DEFAULTs are what a
 * pre-statutory run legitimately had.
 *
 * `total_employer_cost` is the one exception (D191): it is added with NO
 * default, so a run/payslip that predates the column comes back NULL — "not
 * computed" — rather than being backfilled with a 0 the payroll register could
 * never tell apart from a genuinely zero-cost period.
 */
function addMissingColumns(sqlite: Database.Database, table: string, columns: readonly (readonly [string, string])[]): void {
  const existing = new Set((sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migratePayrollRunSchema(sqlite: Database.Database): void {
  addMissingColumns(sqlite, "hr_payroll_run", [
    ["total_employer_cost", "INTEGER"],
    ["overtime_source", "TEXT NOT NULL DEFAULT 'none'"],
    ["statutory_tables_json", "TEXT NOT NULL DEFAULT '[]'"],
  ]);
}

function migratePayslipSchema(sqlite: Database.Database): void {
  addMissingColumns(sqlite, "hr_payslip", [
    ["insurable_wage", "INTEGER NOT NULL DEFAULT 0"],
    ["insurable_wage_capped", "INTEGER NOT NULL DEFAULT 0"],
    ["annual_taxable_income", "INTEGER NOT NULL DEFAULT 0"],
    ["total_employer_cost", "INTEGER"],
    ["basis_json", "TEXT"],
  ]);
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

export async function ensureHrPayrollSchema(db: SqlDb): Promise<void> {
  await db.applySchema(
    [CREATE_ADVANCE, CREATE_PAYROLL_RUN, CREATE_PAYSLIP, CREATE_GARNISHMENT, CREATE_STATUTORY_OVERRIDE, CREATE_PAYROLL_COMPONENT, CREATE_STATUTORY_FLAG].join("\n"),
  );
}

export function createEmployeeAdvanceRepository(db: SqlDb): EmployeeAdvanceRepository {
  return new SqlEmployeeAdvanceRepository(db);
}

export function createPayrollRunRepository(db: SqlDb): PayrollRunRepository {
  return new SqlPayrollRunRepository(db);
}

export function createPayslipRepository(db: SqlDb): PayslipRepository {
  return new SqlPayslipRepository(db);
}

export function createPayrollComponentRepository(db: SqlDb): PayrollComponentRepository {
  return new SqlPayrollComponentRepository(db);
}

export function createGarnishmentRepository(db: SqlDb): GarnishmentRepository {
  return new SqlGarnishmentRepository(db);
}

export function createStatutoryOverrideRepository(db: SqlDb): StatutoryOverrideRepository {
  return new SqlStatutoryOverrideRepository(db);
}

export function createPayrollStatutoryFlagRepository(db: SqlDb): PayrollStatutoryFlagRepository {
  return new SqlPayrollStatutoryFlagRepository(db);
}

/** Open a SQLite-backed EmployeeAdvanceRepository. ":memory:" for tests, a path (or shared connection) for real. */
export function createSqliteEmployeeAdvanceRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeAdvanceRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_ADVANCE);
  const advanceColumns = new Set((sqlite.pragma("table_info(hr_employee_advance)") as { name: string }[]).map((c) => c.name));
  if (!advanceColumns.has("repayments_json")) sqlite.exec("ALTER TABLE hr_employee_advance ADD COLUMN repayments_json TEXT");
  const repo = createEmployeeAdvanceRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteEmployeeAdvanceRepositoryHandle;
}

/** Open a SQLite-backed PayrollRunRepository. */
export function createSqlitePayrollRunRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayrollRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PAYROLL_RUN);
  migratePayrollRunSchema(sqlite);
  const repo = createPayrollRunRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayrollRunRepositoryHandle;
}

/** Open a SQLite-backed PayslipRepository. */
export function createSqlitePayslipRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayslipRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PAYSLIP);
  migratePayslipSchema(sqlite);
  const repo = createPayslipRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayslipRepositoryHandle;
}

// --- Payroll components (GL routing) ---------------------------------------

const CREATE_PAYROLL_COMPONENT = `
CREATE TABLE IF NOT EXISTS hr_payroll_component (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  kind          TEXT NOT NULL,
  gl_account_id TEXT,
  active        INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
`;

interface PayrollComponentRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  kind: string;
  gl_account_id: string | null;
  active: bigint;
  created_at: string;
  updated_at: string;
}

function toPayrollComponent(row: PayrollComponentRow): PayrollComponent {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    kind: row.kind as PayrollComponentKind,
    glAccountId: row.gl_account_id,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function componentParams(component: PayrollComponent): SqlValue[] {
  return [
    component.id,
    component.code,
    component.nameAr,
    component.nameEn,
    component.kind,
    component.glAccountId,
    component.active ? 1 : 0,
    component.createdAt,
    component.updatedAt,
  ];
}

const PAYROLL_COMPONENT_UPSERT = `
      INSERT INTO hr_payroll_component (id, code, name_ar, name_en, kind, gl_account_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        kind = excluded.kind,
        gl_account_id = excluded.gl_account_id,
        active = excluded.active,
        updated_at = excluded.updated_at
    `;

class SqlPayrollComponentRepository implements PayrollComponentRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PayrollComponent | null> {
    const row = await this.db.get<PayrollComponentRow>(`SELECT * FROM hr_payroll_component WHERE id = ?`, [id]);
    return row ? toPayrollComponent(row) : null;
  }

  async findByCode(code: string): Promise<PayrollComponent | null> {
    const row = await this.db.get<PayrollComponentRow>(`SELECT * FROM hr_payroll_component WHERE code = ?`, [code]);
    return row ? toPayrollComponent(row) : null;
  }

  async list(filter?: PayrollComponentFilter): Promise<PayrollComponent[]> {
    let rows = (await this.db.all<PayrollComponentRow>(`SELECT * FROM hr_payroll_component ORDER BY kind, code`)).map(toPayrollComponent);
    if (filter?.kind) rows = rows.filter((row) => row.kind === filter.kind);
    if (filter?.active !== undefined && filter.active !== null) rows = rows.filter((row) => row.active === filter.active);
    return rows;
  }

  async create(component: PayrollComponent): Promise<void> {
    await insertNew(this.db, component.id, PAYROLL_COMPONENT_UPSERT, componentParams(component));
  }

  async update(component: PayrollComponent): Promise<void> {
    await this.db.run(PAYROLL_COMPONENT_UPSERT, componentParams(component));
  }
}

export interface SqlitePayrollComponentRepositoryHandle extends PayrollComponentRepository {
  close(): void;
}

/** Open a SQLite-backed PayrollComponentRepository. */
export function createSqlitePayrollComponentRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayrollComponentRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PAYROLL_COMPONENT);
  const repo = createPayrollComponentRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayrollComponentRepositoryHandle;
}

export interface SqliteGarnishmentRepositoryHandle extends GarnishmentRepository {
  close(): void;
}

/** Open a SQLite-backed GarnishmentRepository (الحجز على الأجر). */
export function createSqliteGarnishmentRepository(path: SqliteConnectionInput = ":memory:"): SqliteGarnishmentRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_GARNISHMENT);
  const repo = createGarnishmentRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteGarnishmentRepositoryHandle;
}

export interface SqliteStatutoryOverrideRepositoryHandle extends StatutoryOverrideRepository {
  close(): void;
}

/** Open a SQLite-backed StatutoryOverrideRepository (حدود الأجر التأميني بالسنة). */
export function createSqliteStatutoryOverrideRepository(path: SqliteConnectionInput = ":memory:"): SqliteStatutoryOverrideRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_STATUTORY_OVERRIDE);
  const repo = createStatutoryOverrideRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteStatutoryOverrideRepositoryHandle;
}

// --- hr.payroll.statutory ---------------------------------------------------

const CREATE_STATUTORY_FLAG = `
CREATE TABLE IF NOT EXISTS hr_payroll_statutory_flag (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  enabled       INTEGER NOT NULL,
  changed_by    TEXT,
  changed_at    TEXT,
  acknowledged  INTEGER NOT NULL
);
`;

interface StatutoryFlagRow {
  enabled: bigint;
  changed_by: string | null;
  changed_at: string | null;
  acknowledged: bigint;
}

class SqlPayrollStatutoryFlagRepository implements PayrollStatutoryFlagRepository {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<PayrollStatutoryFlag> {
    const row = await this.db.get<StatutoryFlagRow>(`SELECT enabled, changed_by, changed_at, acknowledged FROM hr_payroll_statutory_flag WHERE id = 1`);
    if (!row) return DEFAULT_PAYROLL_STATUTORY_FLAG;
    return { enabled: Number(row.enabled) === 1, changedBy: row.changed_by, changedAt: row.changed_at, acknowledged: Number(row.acknowledged) === 1 };
  }

  async set(flag: PayrollStatutoryFlag): Promise<void> {
    await this.db.run(
      `INSERT INTO hr_payroll_statutory_flag (id, enabled, changed_by, changed_at, acknowledged)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         changed_by = excluded.changed_by,
         changed_at = excluded.changed_at,
         acknowledged = excluded.acknowledged`,
      [flag.enabled ? 1 : 0, flag.changedBy, flag.changedAt, flag.acknowledged ? 1 : 0],
    );
  }
}

export interface SqlitePayrollStatutoryFlagRepositoryHandle extends PayrollStatutoryFlagRepository {
  close(): void;
}

/** Open the tenant's `hr.payroll.statutory` switch. Absent row = OFF. */
export function createSqlitePayrollStatutoryFlagRepository(path: SqliteConnectionInput = ":memory:"): SqlitePayrollStatutoryFlagRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_STATUTORY_FLAG);
  const repo = createPayrollStatutoryFlagRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePayrollStatutoryFlagRepositoryHandle;
}
