import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  BASE_CURRENCY,
  FX_REVALUATION_ALL_CURRENCIES,
  FX_REVALUATION_DOC_TYPE,
  Money,
  PeriodCloseCommitOutcome,
  PeriodCloseDocKind,
  nextDay,
  seriesRangesInWindow,
  type AuditEvent,
  type NumberedDocument,
  type PeriodCloseCheckCode,
  type PeriodCloseCheckResult,
  type PeriodCloseDocCount,
  type PeriodCloseFinding,
  type PeriodCloseSummary,
  type PeriodCloseSummaryRepository,
  type PeriodCloseWindow,
  type TrialBalanceSnapshotRow,
  type TrialBalanceSnapshotTotals,
} from "@mezan/domain";

const CREATE_SUMMARY = `
CREATE TABLE IF NOT EXISTS period_close_summary (
  id                  TEXT PRIMARY KEY,
  period_id           TEXT NOT NULL,
  year                INTEGER NOT NULL,
  period_number       INTEGER NOT NULL,
  start_date          TEXT NOT NULL,
  end_date            TEXT NOT NULL,
  closed_by           TEXT NOT NULL,
  closed_at           TEXT NOT NULL,
  override_reason     TEXT,
  failed_checks_json  TEXT NOT NULL,
  checks_json         TEXT NOT NULL,
  trial_balance_json  TEXT NOT NULL,
  totals_json         TEXT NOT NULL,
  sha256              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_period_close_summary_period ON period_close_summary(period_id);
`;

const APPEND_ONLY_MESSAGE = "period_close_summary is append-only";

const SQLITE_SUMMARY_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS period_close_summary_no_update BEFORE UPDATE ON period_close_summary
BEGIN SELECT RAISE(ABORT, 'period_close_summary is append-only'); END;
CREATE TRIGGER IF NOT EXISTS period_close_summary_no_delete BEFORE DELETE ON period_close_summary
BEGIN SELECT RAISE(ABORT, 'period_close_summary is append-only'); END;
`;

interface SummaryRow {
  id: string;
  period_id: string;
  year: bigint;
  period_number: bigint;
  start_date: string;
  end_date: string;
  closed_by: string;
  closed_at: string;
  override_reason: string | null;
  failed_checks_json: string;
  checks_json: string;
  trial_balance_json: string;
  totals_json: string;
  sha256: string;
}

type WireFinding = Omit<PeriodCloseFinding, "amount"> & { amount: string | null };
type WireCheck = Omit<PeriodCloseCheckResult, "findings"> & { findings: WireFinding[] };
type WireRow = { [K in keyof TrialBalanceSnapshotRow]: TrialBalanceSnapshotRow[K] extends Money ? string : TrialBalanceSnapshotRow[K] };
type WireTotals = { [K in keyof TrialBalanceSnapshotTotals]: string };

function checksToWire(checks: readonly PeriodCloseCheckResult[]): WireCheck[] {
  return checks.map((c) => ({ ...c, findings: c.findings.map((f) => ({ ...f, amount: f.amount?.toString() ?? null })) }));
}

function checksFromWire(json: string): PeriodCloseCheckResult[] {
  return (JSON.parse(json) as WireCheck[]).map((c) => ({
    ...c,
    findings: c.findings.map((f) => ({ ...f, amount: f.amount === null ? null : Money.fromMajor(f.amount) })),
  }));
}

function rowsToWire(rows: readonly TrialBalanceSnapshotRow[]): WireRow[] {
  return rows.map((r) => ({ ...r, opening: r.opening.toString(), movement: r.movement.toString(), closing: r.closing.toString() }));
}

function rowsFromWire(json: string): TrialBalanceSnapshotRow[] {
  return (JSON.parse(json) as WireRow[]).map((r) => ({
    ...r,
    opening: Money.fromMajor(r.opening),
    movement: Money.fromMajor(r.movement),
    closing: Money.fromMajor(r.closing),
  }));
}

function totalsFromWire(json: string): TrialBalanceSnapshotTotals {
  const t = JSON.parse(json) as WireTotals;
  return {
    closingDebit: Money.fromMajor(t.closingDebit),
    closingCredit: Money.fromMajor(t.closingCredit),
    movementDebit: Money.fromMajor(t.movementDebit),
    movementCredit: Money.fromMajor(t.movementCredit),
  };
}

function fromRow(row: SummaryRow): PeriodCloseSummary {
  return {
    id: row.id,
    periodId: row.period_id,
    year: Number(row.year),
    periodNumber: Number(row.period_number),
    startDate: row.start_date,
    endDate: row.end_date,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    overrideReason: row.override_reason,
    failedChecks: JSON.parse(row.failed_checks_json) as PeriodCloseCheckCode[],
    checks: checksFromWire(row.checks_json),
    trialBalance: rowsFromWire(row.trial_balance_json),
    totals: totalsFromWire(row.totals_json),
    sha256: row.sha256,
  };
}

const SUMMARY_INSERT = `
  INSERT INTO period_close_summary (
    id, period_id, year, period_number, start_date, end_date, closed_by, closed_at, override_reason,
    failed_checks_json, checks_json, trial_balance_json, totals_json, sha256
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function summaryParams(summary: PeriodCloseSummary): SqlValue[] {
  const totals: WireTotals = {
    closingDebit: summary.totals.closingDebit.toString(),
    closingCredit: summary.totals.closingCredit.toString(),
    movementDebit: summary.totals.movementDebit.toString(),
    movementCredit: summary.totals.movementCredit.toString(),
  };
  return [
    summary.id,
    summary.periodId,
    summary.year,
    summary.periodNumber,
    summary.startDate,
    summary.endDate,
    summary.closedBy,
    summary.closedAt,
    summary.overrideReason,
    JSON.stringify(summary.failedChecks),
    JSON.stringify(checksToWire(summary.checks)),
    JSON.stringify(rowsToWire(summary.trialBalance)),
    JSON.stringify(totals),
    summary.sha256,
  ];
}

class SqlPeriodCloseSummaryRepository implements PeriodCloseSummaryRepository {
  constructor(private readonly db: SqlDb) {}

  async save(summary: PeriodCloseSummary): Promise<void> {
    await this.db.run(SUMMARY_INSERT, summaryParams(summary));
  }

  async findById(id: string): Promise<PeriodCloseSummary | null> {
    const row = await this.db.get<SummaryRow>(`SELECT * FROM period_close_summary WHERE id = ?`, [id]);
    return row ? fromRow(row) : null;
  }

  async list(filter?: { readonly periodId?: string }): Promise<readonly PeriodCloseSummary[]> {
    const rows = filter?.periodId
      ? await this.db.all<SummaryRow>(`SELECT * FROM period_close_summary WHERE period_id = ? ORDER BY closed_at DESC, id DESC`, [filter.periodId])
      : await this.db.all<SummaryRow>(`SELECT * FROM period_close_summary ORDER BY closed_at DESC, id DESC`);
    return rows.map(fromRow);
  }
}

interface DocSource {
  readonly kind: PeriodCloseDocKind;
  readonly table: string;
  readonly docType?: string;
  readonly byPeriodKey?: boolean;
  readonly dateColumn?: string;
  readonly unpostedStatuses?: readonly string[];
  readonly numberColumn?: string;
  readonly holdsForApproval?: boolean;
}

enum CertificateStatus {
  Draft = "draft",
  Measured = "measured",
  Certified = "certified",
}

enum PhysicalCountStatus {
  InProgress = "IN_PROGRESS",
  Completed = "COMPLETED",
}

const UNAPPROVED_CERTIFICATE_STATUSES = [CertificateStatus.Draft, CertificateStatus.Measured, CertificateStatus.Certified] as const;
const UNADJUSTED_COUNT_STATUSES = [PhysicalCountStatus.InProgress, PhysicalCountStatus.Completed] as const;
const DEFAULT_DATE_COLUMN = "date";

const DOC_SOURCES: readonly DocSource[] = [
  { kind: PeriodCloseDocKind.JournalEntry, table: "journal_entry", numberColumn: "entry_no" },
  { kind: PeriodCloseDocKind.SalesInvoice, table: "sales_invoice", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.PurchaseInvoice, table: "purchase_invoice", numberColumn: "number" },
  { kind: PeriodCloseDocKind.GoodsReceipt, table: "goods_receipt", numberColumn: "number" },
  { kind: PeriodCloseDocKind.Voucher, table: "voucher", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.SalesReturn, table: "framework_document", docType: "SALES_RETURN", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.PurchaseReturn, table: "framework_document", docType: "PURCHASE_RETURN", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.LandedCost, table: "framework_document", docType: "LANDED_COST", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.StockTransfer, table: "stock_transfer_document", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.StockAdjustment, table: "stock_adjustment_document", numberColumn: "doc_no", holdsForApproval: true },
  { kind: PeriodCloseDocKind.DepreciationRun, table: "depreciation_run", byPeriodKey: true },
  { kind: PeriodCloseDocKind.WritedownRun, table: "writedown_run", byPeriodKey: true },
  { kind: PeriodCloseDocKind.ProgressCertificate, table: "contracting_certificate", dateColumn: "execution_date", unpostedStatuses: UNAPPROVED_CERTIFICATE_STATUSES },
  { kind: PeriodCloseDocKind.SubcontractCertificate, table: "subcontract_certificate", dateColumn: "execution_date", unpostedStatuses: UNAPPROVED_CERTIFICATE_STATUSES },
  { kind: PeriodCloseDocKind.PhysicalCount, table: "physical_count", unpostedStatuses: UNADJUSTED_COUNT_STATUSES },
  { kind: PeriodCloseDocKind.SiteIssue, table: "site_issue" },
  { kind: PeriodCloseDocKind.SiteReceipt, table: "site_receipt" },
  { kind: PeriodCloseDocKind.MaterialConsumption, table: "material_consumption" },
  { kind: PeriodCloseDocKind.EquipmentLog, table: "equipment_log" },
];

enum StoredStatus {
  Draft = "draft",
  Pending = "pending",
  Calculated = "calculated",
  Posted = "posted",
  Reversed = "reversed",
  EtaError = "error",
  StatementCompleted = "completed",
  BankAccountType = "bank",
  PayrollApproved = "approved",
  PayrollDisbursed = "disbursed",
}

const FISCAL_PERIOD_ENTITY = "FISCAL_PERIOD";
const FISCAL_PERIOD_CLOSE_ACTION = "CLOSE";
const ASSET_DISPOSAL_DOC_TYPE = "ASSET_DISPOSAL";
const DRAFT_STATUSES = [StoredStatus.Draft] as const;
const PENDING_STATUSES = [StoredStatus.Pending] as const;
const UNPOSTED_PAYROLL_STATUSES = [StoredStatus.Draft, StoredStatus.Calculated] as const;
const LEDGER_EFFECTIVE_STATUSES = [StoredStatus.Posted, StoredStatus.Reversed] as const;

const CREATE_FX_RUN = `
CREATE TABLE IF NOT EXISTS fx_revaluation_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  as_of_date  TEXT NOT NULL,
  currency    TEXT NOT NULL,
  entry_id    TEXT,
  ran_by      TEXT NOT NULL,
  ran_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fx_revaluation_run_date ON fx_revaluation_run(as_of_date, currency);
`;

export interface FxRevaluationRunRecord {
  readonly asOfDate: string;
  readonly currencies: readonly string[];
  readonly entryId: string | null;
  readonly ranBy: string;
  readonly ranAt: string;
}

export interface FxRevaluationRunLog {
  record(run: FxRevaluationRunRecord): Promise<void>;
  currenciesRevaluedAsOf(asOfDate: string): Promise<string[]>;
}

export interface PeriodCloseBankAccountRow {
  readonly treasuryAccountId: string;
  readonly name: string;
  readonly firstMovementDate: string;
}

export interface PeriodClosePayrollRunsRow {
  readonly paidEmployeeIds: readonly string[];
  readonly hasUnpostedRun: boolean;
  readonly partMonthTaxedPayslips: number;
}

export interface PeriodCloseBankStatementRow {
  readonly statementId: string;
  readonly treasuryAccountId: string;
  readonly statementNumber: string | null;
  readonly treasuryAccountName: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly finalized: boolean;
  readonly forced: boolean;
  readonly unmatchedLines: number;
}

export interface PeriodCloseRecurringRunRow {
  readonly templateId: string;
  readonly period: string;
  readonly entryStatus: string | null;
}

export interface PeriodCloseRecurringSkipRow {
  readonly templateId: string;
  readonly period: string;
}

export interface PeriodCloseFxLineGroup {
  readonly accountId: string;
  readonly currency: string;
  readonly fxRate: string;
  readonly memo: string | null;
  readonly debit: Money;
  readonly credit: Money;
}

export interface PeriodCloseUntaggedTreasuryGroup {
  readonly accountId: string;
  readonly currency: string;
  readonly date: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface PeriodCloseQueries {
  draftCounts(window: PeriodCloseWindow): Promise<PeriodCloseDocCount[]>;
  pendingApprovalCounts(window: PeriodCloseWindow): Promise<PeriodCloseDocCount[]>;
  numberedDocuments(window: PeriodCloseWindow): Promise<{ kind: PeriodCloseDocKind; documents: NumberedDocument[] }[]>;
  bankStatementsOverlapping(window: PeriodCloseWindow): Promise<PeriodCloseBankStatementRow[]>;
  bankAccountsWithMovement(window: PeriodCloseWindow): Promise<PeriodCloseBankAccountRow[]>;
  payrollRuns(window: PeriodCloseWindow): Promise<PeriodClosePayrollRunsRow>;
  recurringRuns(): Promise<PeriodCloseRecurringRunRow[]>;
  recurringSkips(): Promise<PeriodCloseRecurringSkipRow[]>;
  openFxLineGroups(toDate: string): Promise<PeriodCloseFxLineGroup[]>;
  untaggedTreasuryLineGroups(toDate: string): Promise<PeriodCloseUntaggedTreasuryGroup[]>;
  etaErrorIds(window: PeriodCloseWindow): Promise<string[]>;
  assetDisposalDates(): Promise<{ assetId: string; date: string }[]>;
  auditedSeals(periodId: string): Promise<string[]>;
  lastAuditedCloser(periodId: string): Promise<string | null>;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

// SQLite's CAST reads a text's leading integer and yields 0 when there is
// none; Postgres raises instead, which would abort the whole transaction.
function leadingInteger(db: SqlDb, expr: string): string {
  return db.dialect === SqlDialect.Postgres
    ? `COALESCE(CAST(substring(${expr} from '^[[:space:]]*[+-]?[0-9]+') AS BIGINT), 0)`
    : `CAST(${expr} AS INTEGER)`;
}

// Table and column names below come only from DOC_SOURCES, never from a caller; every value is bound.
function createQueries(db: SqlDb): PeriodCloseQueries {
  async function count(sql: string, params: readonly SqlValue[]): Promise<number> {
    const row = await db.get<{ n: bigint }>(sql, params);
    return Number(row?.n ?? 0);
  }

  async function countByStatus(source: DocSource, statuses: readonly string[], window: PeriodCloseWindow): Promise<number> {
    const typeClause = source.docType ? " AND doc_type = ?" : "";
    const typeParams = source.docType ? [source.docType] : [];
    const dateColumn = source.dateColumn ?? DEFAULT_DATE_COLUMN;
    const statusClause = `status IN (${placeholders(statuses)})`;
    return source.byPeriodKey
      ? count(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${statusClause}${typeClause} AND period = ?`, [...statuses, ...typeParams, window.startDate.slice(0, 7)])
      : count(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${statusClause}${typeClause} AND ${dateColumn} >= ? AND ${dateColumn} < ?`, [
          ...statuses,
          ...typeParams,
          window.startDate,
          nextDay(window.endDate),
        ]);
  }

  function unpostedPayrollRuns(window: PeriodCloseWindow): Promise<number> {
    return count(
      `SELECT COUNT(*) AS n FROM hr_payroll_run WHERE status IN (${placeholders(UNPOSTED_PAYROLL_STATUSES)}) AND period_end >= ? AND period_end <= ?`,
      [...UNPOSTED_PAYROLL_STATUSES, window.startDate, window.endDate],
    );
  }

  return {
    async draftCounts(window) {
      const counts: PeriodCloseDocCount[] = [];
      for (const source of DOC_SOURCES) counts.push({ kind: source.kind, count: await countByStatus(source, source.unpostedStatuses ?? DRAFT_STATUSES, window) });
      counts.push({ kind: PeriodCloseDocKind.PayrollRun, count: await unpostedPayrollRuns(window) });
      return counts;
    },
    async pendingApprovalCounts(window) {
      const counts: PeriodCloseDocCount[] = [];
      for (const source of DOC_SOURCES.filter((candidate) => candidate.holdsForApproval)) {
        counts.push({ kind: source.kind, count: await countByStatus(source, PENDING_STATUSES, window) });
      }
      return counts;
    },
    async numberedDocuments(window) {
      const from = window.startDate;
      const before = nextDay(window.endDate);
      const result: { kind: PeriodCloseDocKind; documents: NumberedDocument[] }[] = [];
      for (const source of DOC_SOURCES) {
        const column = source.numberColumn;
        if (!column) continue;
        const typeClause = source.docType ? " AND doc_type = ?" : "";
        const typeParams = source.docType ? [source.docType] : [];
        const digits = leadingInteger(db, `substr(${column}, ?)`);
        const select = `SELECT ${column} AS number, substr(date, 1, 10) AS date FROM ${source.table} WHERE ${column} IS NOT NULL AND ${column} <> ''${typeClause}`;
        const documents = await db.all<NumberedDocument>(`${select} AND date >= ? AND date < ?`, [...typeParams, from, before]);
        for (const range of seriesRangesInWindow(documents, window)) {
          const digitsAt = range.prefix.length + 1;
          const previousRow = await db.get<{ value: bigint | null }>(
            `SELECT MAX(${digits}) AS value FROM ${source.table}
              WHERE ${column} IS NOT NULL AND ${column} <> ''${typeClause} AND substr(${column}, 1, ?) = ? AND ${digits} < ? AND date < ?`,
            [digitsAt, ...typeParams, range.prefix.length, range.prefix, digitsAt, range.low, from],
          );
          const previous = previousRow?.value === null || previousRow?.value === undefined ? null : Number(previousRow.value);
          const rows = await db.all<NumberedDocument>(
            `${select} AND substr(${column}, 1, ?) = ? AND ${digits} BETWEEN ? AND ? AND NOT (date >= ? AND date < ?)`,
            [...typeParams, range.prefix.length, range.prefix, digitsAt, previous ?? range.low, range.high, from, before],
          );
          documents.push(...rows);
        }
        result.push({ kind: source.kind, documents });
      }
      return result;
    },
    async bankStatementsOverlapping(window) {
      const rows = await db.all<{ id: string; treasury_account_id: string; statement_number: string | null; period_start: string; period_end: string; status: string; account_name: string | null; forced: bigint; unmatched_lines: bigint }>(
        `SELECT s.id, s.treasury_account_id, s.statement_number, s.period_start, s.period_end, s.status, ta.name AS account_name,
                CASE WHEN s.finalize_override_reason IS NOT NULL OR COALESCE(s.unmatched_at_finalize, 0) > 0 THEN 1 ELSE 0 END AS forced,
                (SELECT COUNT(*) FROM statement_line l WHERE l.statement_id = s.id AND l.status <> 'matched') AS unmatched_lines
           FROM bank_statement s
           LEFT JOIN treasury_account ta ON ta.id = s.treasury_account_id
          WHERE s.period_start <= ? AND s.period_end >= ?
          ORDER BY s.period_end, s.id`,
        [window.endDate, window.startDate],
      );
      return rows.map((row) => ({
        statementId: row.id,
        treasuryAccountId: row.treasury_account_id,
        statementNumber: row.statement_number,
        treasuryAccountName: row.account_name,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        finalized: row.status === StoredStatus.StatementCompleted,
        forced: row.status === StoredStatus.StatementCompleted && Number(row.forced) === 1,
        unmatchedLines: Number(row.unmatched_lines),
      }));
    },
    async bankAccountsWithMovement(window) {
      const rows = await db.all<{ id: string; name: string; first_movement: string }>(
        `SELECT ta.id, ta.name, MIN(substr(je.date, 1, 10)) AS first_movement
           FROM treasury_account ta
           JOIN journal_line jl ON jl.account_id = ta.gl_account_id
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE ta.type = ? AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date >= ? AND je.date < ?
          GROUP BY ta.id, ta.name
          ORDER BY ta.id`,
        [StoredStatus.BankAccountType, ...LEDGER_EFFECTIVE_STATUSES, window.startDate, nextDay(window.endDate)],
      );
      return rows.map((row) => ({ treasuryAccountId: row.id, name: row.name, firstMovementDate: row.first_movement }));
    },
    async payrollRuns(window) {
      const year = Number(window.startDate.slice(0, 4));
      const month = Number(window.startDate.slice(5, 7));
      const paid = await db.all<{ employee_id: string }>(
        `SELECT DISTINCT p.employee_id FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id
          WHERE r.year = ? AND r.month = ? AND r.status IN (?, ?)`,
        [year, month, StoredStatus.PayrollApproved, StoredStatus.PayrollDisbursed],
      );
      const unposted = await count(`SELECT COUNT(*) AS n FROM hr_payroll_run WHERE year = ? AND month = ? AND status IN (${placeholders(UNPOSTED_PAYROLL_STATUSES)})`, [
        year,
        month,
        ...UNPOSTED_PAYROLL_STATUSES,
      ]);
      const partMonth = await count(
        `SELECT COUNT(*) AS n FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id
          WHERE r.year = ? AND r.month = ? AND r.status IN (?, ?) AND p.paid_days < p.period_days AND p.insurable_wage > 0`,
        [year, month, StoredStatus.PayrollApproved, StoredStatus.PayrollDisbursed],
      );
      return { paidEmployeeIds: paid.map((row) => row.employee_id), hasUnpostedRun: unposted > 0, partMonthTaxedPayslips: partMonth };
    },
    async recurringRuns() {
      const rows = await db.all<{ template_id: string; period: string; status: string | null }>(
        `SELECT r.template_id, r.period, je.status FROM recurring_journal_run r LEFT JOIN journal_entry je ON je.id = r.journal_entry_id
          WHERE r.generation = (SELECT MAX(newer.generation) FROM recurring_journal_run newer WHERE newer.template_id = r.template_id AND newer.period = r.period)`,
      );
      return rows.map((row) => ({ templateId: row.template_id, period: row.period, entryStatus: row.status }));
    },
    async recurringSkips() {
      const rows = await db.all<{ template_id: string; period: string }>(`SELECT template_id, period FROM recurring_journal_skip`);
      return rows.map((row) => ({ templateId: row.template_id, period: row.period }));
    },
    async openFxLineGroups(toDate) {
      const rows = await db.all<{ account_id: string; currency: string; fx_rate: string; memo: string | null; debit: bigint; credit: bigint }>(
        `SELECT jl.account_id, jl.currency, jl.fx_rate, jl.memo, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.currency IS NOT NULL AND jl.currency <> ? AND jl.fx_rate IS NOT NULL
            AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date < ?
          GROUP BY jl.account_id, jl.currency, jl.fx_rate, jl.memo`,
        [BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, nextDay(toDate)],
      );
      return rows.map((row) => ({
        accountId: row.account_id,
        currency: row.currency,
        fxRate: row.fx_rate,
        memo: row.memo,
        debit: Money.fromScaled(row.debit),
        credit: Money.fromScaled(row.credit),
      }));
    },
    async untaggedTreasuryLineGroups(toDate) {
      const rows = await db.all<{ account_id: string; currency: string; date: string; debit: bigint; credit: bigint }>(
        `SELECT jl.account_id, ta.currency AS currency, je.date AS date, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
           FROM treasury_account ta
           JOIN journal_line jl ON jl.account_id = ta.gl_account_id
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE ta.currency <> ? AND (jl.currency IS NULL OR jl.currency = ? OR jl.fx_rate IS NULL)
            AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date < ?
          GROUP BY jl.account_id, ta.currency, je.date`,
        [BASE_CURRENCY, BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, nextDay(toDate)],
      );
      return rows.map((row) => ({ accountId: row.account_id, currency: row.currency, date: row.date, debit: Money.fromScaled(row.debit), credit: Money.fromScaled(row.credit) }));
    },
    async etaErrorIds(window) {
      const documentDate = `COALESCE(si.date, fd.date, e.created_at)`;
      const rows = await db.all<{ internal_id: string }>(
        `SELECT e.internal_id
           FROM eta_submission e
           LEFT JOIN sales_invoice si ON si.id = e.internal_id
           LEFT JOIN framework_document fd ON fd.id = e.internal_id
          WHERE e.status = ? AND ${documentDate} >= ? AND ${documentDate} < ?
          ORDER BY e.internal_id`,
        [StoredStatus.EtaError, window.startDate, nextDay(window.endDate)],
      );
      return rows.map((r) => r.internal_id);
    },
    async assetDisposalDates() {
      const rows = await db.all<{ asset_id: string; date: string }>(
        `SELECT source_doc_id AS asset_id, MIN(date) AS date FROM journal_entry
          WHERE source_doc_type = ? AND status = ? AND reverses_entry_id IS NULL AND source_doc_id IS NOT NULL
          GROUP BY source_doc_id`,
        [ASSET_DISPOSAL_DOC_TYPE, StoredStatus.Posted],
      );
      return rows.map((row) => ({ assetId: row.asset_id, date: row.date }));
    },
    async auditedSeals(periodId) {
      const seal = db.dialect === SqlDialect.Postgres ? "(details::jsonb ->> 'sha256')" : "json_extract(details, '$.sha256')";
      const rows = await db.all<{ seal: string }>(
        `SELECT ${seal} AS seal FROM audit_event WHERE entity_type = ? AND entity_id = ? AND ${seal} IS NOT NULL`,
        [FISCAL_PERIOD_ENTITY, periodId],
      );
      return rows.map((row) => row.seal);
    },
    async lastAuditedCloser(periodId) {
      const row = await db.get<{ actor: string }>(`SELECT actor FROM audit_event WHERE entity_type = ? AND entity_id = ? AND action = ? ORDER BY id DESC LIMIT 1`, [
        FISCAL_PERIOD_ENTITY,
        periodId,
        FISCAL_PERIOD_CLOSE_ACTION,
      ]);
      return row?.actor ?? null;
    },
  };
}

function createFxRunLog(db: SqlDb): FxRevaluationRunLog {
  const undoneBy = (entry: string, asOf: string) =>
    `EXISTS (SELECT 1 FROM journal_entry undone JOIN journal_entry undo ON undo.id = undone.reversed_by_entry_id WHERE undone.id = ${entry} AND substr(undo.date, 1, 10) <= ${asOf})`;
  type Stamp = { currency: string; at: string };
  const standingRuns = (asOfDate: string) =>
    db.all<Stamp>(
      `SELECT run.currency AS currency, MAX(run.ran_at) AS at FROM fx_revaluation_run run WHERE run.as_of_date = ? AND NOT ${undoneBy("run.entry_id", "run.as_of_date")} GROUP BY run.currency`,
      [asOfDate],
    );
  const foreignLines = `
       FROM journal_line jl
       JOIN journal_entry je ON je.id = jl.entry_id
      WHERE jl.currency IS NOT NULL AND jl.currency <> ? AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)})`;
  const lastForeignPosting = (asOfDate: string) =>
    db.all<Stamp>(`SELECT jl.currency AS currency, MAX(COALESCE(je.posted_at, je.created_at)) AS at ${foreignLines} AND je.date <= ? GROUP BY jl.currency`, [
      BASE_CURRENCY,
      ...LEDGER_EFFECTIVE_STATUSES,
      asOfDate,
    ]);
  const revaluationEntries = (asOfDate: string) =>
    db.all<Stamp>(
      `SELECT jl.currency AS currency, MAX(COALESCE(je.posted_at, je.created_at)) AS at ${foreignLines} AND je.source_doc_type = ? AND substr(je.date, 1, 10) = ? AND je.reverses_entry_id IS NULL AND NOT ${undoneBy("je.id", "?")} GROUP BY jl.currency`,
      [BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, FX_REVALUATION_DOC_TYPE, asOfDate, asOfDate],
    );
  const unseenTreasuryCurrencies = (asOfDate: string) =>
    db.all<{ currency: string }>(
      `SELECT ta.currency AS currency
         FROM treasury_account ta
         JOIN journal_line jl ON jl.account_id = ta.gl_account_id
         JOIN journal_entry je ON je.id = jl.entry_id
        WHERE ta.currency <> ? AND (jl.currency IS NULL OR jl.currency <> ta.currency OR jl.fx_rate IS NULL)
          AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date < ?
        GROUP BY ta.currency
       HAVING SUM(jl.debit) <> SUM(jl.credit)`,
      [BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, nextDay(asOfDate)],
    );
  const later = (a: string | undefined, b: string | undefined): string | undefined => (a === undefined ? b : b === undefined || a >= b ? a : b);
  return {
    async record(run) {
      await db.transaction(async () => {
        for (const currency of run.currencies) {
          await db.run(`INSERT INTO fx_revaluation_run (as_of_date, currency, entry_id, ran_by, ran_at) VALUES (?, ?, ?, ?, ?)`, [
            run.asOfDate,
            currency,
            run.entryId,
            run.ranBy,
            run.ranAt,
          ]);
        }
      });
    },
    async currenciesRevaluedAsOf(asOfDate) {
      const ranAt = new Map((await standingRuns(asOfDate)).map((row) => [row.currency, row.at]));
      const entryAt = new Map((await revaluationEntries(asOfDate)).map((row) => [row.currency, row.at]));
      const postedAt = new Map((await lastForeignPosting(asOfDate)).map((row) => [row.currency, row.at]));
      const unseen = new Set((await unseenTreasuryCurrencies(asOfDate)).map((row) => row.currency));
      const allRanAt = ranAt.get(FX_REVALUATION_ALL_CURRENCIES);
      const candidates = new Set([...ranAt.keys(), ...entryAt.keys(), ...postedAt.keys()]);
      candidates.delete(FX_REVALUATION_ALL_CURRENCIES);
      return [...candidates]
        .filter((currency) => {
          if (unseen.has(currency)) return false;
          const doneAt = later(later(entryAt.get(currency), ranAt.get(currency)), allRanAt);
          return doneAt !== undefined && (postedAt.get(currency) ?? "") <= doneAt;
        })
        .sort();
    },
  };
}

export interface PeriodCloseCommit {
  readonly changeToken: number;
  readonly periodId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly summary: PeriodCloseSummary | null;
  readonly auditEvent: AuditEvent;
  readonly appendAudit: (event: AuditEvent) => void;
}

export interface PeriodCloseCriticalSection {
  changeToken(): number;
  commit(input: PeriodCloseCommit): PeriodCloseCommitOutcome;
}

// SQLite only: the change token is the connection's total_changes(), which has
// no Postgres equivalent, and the audit append inside it is synchronous.
function createCriticalSection(sqlite: Database.Database): PeriodCloseCriticalSection {
  const totalChanges = sqlite.prepare(`SELECT total_changes() AS n`);
  const insertSummary = sqlite.prepare(SUMMARY_INSERT);
  const statusOf = sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = ?`);
  const move = sqlite.prepare(`UPDATE fiscal_period SET status = ? WHERE id = ? AND status = ?`);
  const changeToken = (): number => (totalChanges.get() as { n: number }).n;

  const commit = sqlite.transaction((input: PeriodCloseCommit): PeriodCloseCommitOutcome => {
    if (changeToken() !== input.changeToken) return PeriodCloseCommitOutcome.Stale;
    const current = statusOf.get(input.periodId) as { status: string } | undefined;
    if (current?.status !== input.fromStatus) return PeriodCloseCommitOutcome.Stale;
    move.run(input.toStatus, input.periodId, input.fromStatus);
    if (input.summary) insertSummary.run(...summaryParams(input.summary));
    input.appendAudit(input.auditEvent);
    return PeriodCloseCommitOutcome.Committed;
  });

  return {
    changeToken,
    commit: (input) => (sqlite.inTransaction ? PeriodCloseCommitOutcome.Stale : commit(input)),
  };
}

export type SqlPeriodCloseCommit = Omit<PeriodCloseCommit, "changeToken" | "appendAudit"> & {
  readonly appendAudit: (event: AuditEvent) => Promise<void>;
};

// CONTRACT: the caller runs this inside the same db.transaction as the checks it
// commits on; that transaction's tenant write lock stands in for SQLite's change token.
export function createSqlPeriodCloseCommit(db: SqlDb): (input: SqlPeriodCloseCommit) => Promise<PeriodCloseCommitOutcome> {
  return async (input) => {
    const current = await db.get<{ status: string }>(`SELECT status FROM fiscal_period WHERE id = ?`, [input.periodId]);
    if (current?.status !== input.fromStatus) return PeriodCloseCommitOutcome.Stale;
    await db.run(`UPDATE fiscal_period SET status = ? WHERE id = ? AND status = ?`, [input.toStatus, input.periodId, input.fromStatus]);
    if (input.summary) await db.run(SUMMARY_INSERT, summaryParams(input.summary));
    await input.appendAudit(input.auditEvent);
    return PeriodCloseCommitOutcome.Committed;
  };
}

export interface PeriodCloseStoreHandle {
  readonly summaries: PeriodCloseSummaryRepository;
  readonly queries: PeriodCloseQueries;
  readonly fxRuns: FxRevaluationRunLog;
}

export interface SqlitePeriodCloseStoreHandle extends PeriodCloseStoreHandle {
  readonly critical: PeriodCloseCriticalSection;
  close(): void;
}

const POSTGRES_SUMMARY_TRIGGER = `
CREATE OR REPLACE FUNCTION period_close_summary_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '${APPEND_ONLY_MESSAGE}';
END;
$fn$;
CREATE OR REPLACE TRIGGER period_close_summary_no_update BEFORE UPDATE ON period_close_summary
  FOR EACH ROW EXECUTE FUNCTION period_close_summary_append_only();
CREATE OR REPLACE TRIGGER period_close_summary_no_delete BEFORE DELETE ON period_close_summary
  FOR EACH ROW EXECUTE FUNCTION period_close_summary_append_only();
CREATE OR REPLACE TRIGGER period_close_summary_no_truncate BEFORE TRUNCATE ON period_close_summary
  FOR EACH STATEMENT EXECUTE FUNCTION period_close_summary_append_only();
`;

export async function ensurePeriodCloseSchema(db: SqlDb): Promise<void> {
  await db.applySchema(`${CREATE_SUMMARY}${CREATE_FX_RUN}`);
  if (db.dialect === SqlDialect.Postgres) await db.exec(POSTGRES_SUMMARY_TRIGGER);
}

export function createPeriodCloseStore(db: SqlDb): PeriodCloseStoreHandle {
  return {
    summaries: new SqlPeriodCloseSummaryRepository(db),
    queries: createQueries(db),
    fxRuns: createFxRunLog(db),
  };
}

export function createSqlitePeriodCloseStore(path: SqliteConnectionInput = ":memory:"): SqlitePeriodCloseStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_SUMMARY);
  sqlite.exec(SQLITE_SUMMARY_TRIGGERS);
  sqlite.exec(CREATE_FX_RUN);
  return {
    ...createPeriodCloseStore(sqliteDb(sqlite)),
    critical: createCriticalSection(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
