import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  BASE_CURRENCY,
  FX_REVALUATION_ALL_CURRENCIES,
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
CREATE TRIGGER IF NOT EXISTS period_close_summary_no_update BEFORE UPDATE ON period_close_summary
BEGIN SELECT RAISE(ABORT, 'period_close_summary is append-only'); END;
CREATE TRIGGER IF NOT EXISTS period_close_summary_no_delete BEFORE DELETE ON period_close_summary
BEGIN SELECT RAISE(ABORT, 'period_close_summary is append-only'); END;
`;

interface SummaryRow {
  id: string;
  period_id: string;
  year: number;
  period_number: number;
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
    year: row.year,
    periodNumber: row.period_number,
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

class SqlitePeriodCloseSummaryRepository implements PeriodCloseSummaryRepository {
  private readonly insert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly all: Database.Statement;
  private readonly byPeriod: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO period_close_summary (
        id, period_id, year, period_number, start_date, end_date, closed_by, closed_at, override_reason,
        failed_checks_json, checks_json, trial_balance_json, totals_json, sha256
      ) VALUES (
        @id, @period_id, @year, @period_number, @start_date, @end_date, @closed_by, @closed_at, @override_reason,
        @failed_checks_json, @checks_json, @trial_balance_json, @totals_json, @sha256
      )`);
    this.byId = sqlite.prepare(`SELECT * FROM period_close_summary WHERE id = ?`);
    this.all = sqlite.prepare(`SELECT * FROM period_close_summary ORDER BY closed_at DESC, id DESC`);
    this.byPeriod = sqlite.prepare(`SELECT * FROM period_close_summary WHERE period_id = ? ORDER BY closed_at DESC, id DESC`);
  }

  async save(summary: PeriodCloseSummary): Promise<void> {
    this.insertSync(summary);
  }

  insertSync(summary: PeriodCloseSummary): void {
    const totals: WireTotals = {
      closingDebit: summary.totals.closingDebit.toString(),
      closingCredit: summary.totals.closingCredit.toString(),
      movementDebit: summary.totals.movementDebit.toString(),
      movementCredit: summary.totals.movementCredit.toString(),
    };
    this.insert.run({
      id: summary.id,
      period_id: summary.periodId,
      year: summary.year,
      period_number: summary.periodNumber,
      start_date: summary.startDate,
      end_date: summary.endDate,
      closed_by: summary.closedBy,
      closed_at: summary.closedAt,
      override_reason: summary.overrideReason,
      failed_checks_json: JSON.stringify(summary.failedChecks),
      checks_json: JSON.stringify(checksToWire(summary.checks)),
      trial_balance_json: JSON.stringify(rowsToWire(summary.trialBalance)),
      totals_json: JSON.stringify(totals),
      sha256: summary.sha256,
    });
  }

  async findById(id: string): Promise<PeriodCloseSummary | null> {
    const row = this.byId.get(id) as SummaryRow | undefined;
    return row ? fromRow(row) : null;
  }

  async list(filter?: { readonly periodId?: string }): Promise<readonly PeriodCloseSummary[]> {
    const rows = (filter?.periodId ? this.byPeriod.all(filter.periodId) : this.all.all()) as SummaryRow[];
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
  EmployeeTerminated = "terminated",
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
  record(run: FxRevaluationRunRecord): void;
  currenciesRevaluedAsOf(asOfDate: string): string[];
}

export interface PeriodCloseBankAccountRow {
  readonly treasuryAccountId: string;
  readonly name: string;
}

export interface PeriodClosePayrollDueRow {
  readonly dueEmployees: number;
  readonly uncoveredEmployees: number;
  readonly hasUnpostedRun: boolean;
}

export interface PeriodCloseBankStatementRow {
  readonly statementId: string;
  readonly treasuryAccountId: string;
  readonly statementNumber: string | null;
  readonly treasuryAccountName: string | null;
  readonly periodEnd: string;
  readonly finalized: boolean;
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

export interface PeriodCloseQueries {
  draftCounts(window: PeriodCloseWindow): PeriodCloseDocCount[];
  pendingApprovalCounts(window: PeriodCloseWindow): PeriodCloseDocCount[];
  numberedDocuments(window: PeriodCloseWindow): { kind: PeriodCloseDocKind; documents: NumberedDocument[] }[];
  bankStatementsOverlapping(window: PeriodCloseWindow): PeriodCloseBankStatementRow[];
  bankAccountsWithMovement(window: PeriodCloseWindow): PeriodCloseBankAccountRow[];
  payrollDue(window: PeriodCloseWindow): PeriodClosePayrollDueRow;
  recurringRuns(): PeriodCloseRecurringRunRow[];
  recurringSkips(): PeriodCloseRecurringSkipRow[];
  openFxLineGroups(toDate: string): PeriodCloseFxLineGroup[];
  foreignTreasuryCurrencies(toDate: string): string[];
  etaErrorIds(window: PeriodCloseWindow): string[];
  assetDisposalDates(): { assetId: string; date: string }[];
  auditedSeals(periodId: string): string[];
  lastAuditedCloser(periodId: string): string | null;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

// Table and column names below come only from DOC_SOURCES, never from a caller; every value is bound.
function createQueries(sqlite: Database.Database): PeriodCloseQueries {
  function countByStatus(source: DocSource, statuses: readonly string[], window: PeriodCloseWindow): number {
    const typeClause = source.docType ? " AND doc_type = ?" : "";
    const typeParams = source.docType ? [source.docType] : [];
    const dateColumn = source.dateColumn ?? DEFAULT_DATE_COLUMN;
    const statusClause = `status IN (${placeholders(statuses)})`;
    const row = source.byPeriodKey
      ? sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${statusClause}${typeClause} AND period = ?`)
          .get(...statuses, ...typeParams, window.startDate.slice(0, 7))
      : sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${statusClause}${typeClause} AND ${dateColumn} >= ? AND ${dateColumn} < ?`)
          .get(...statuses, ...typeParams, window.startDate, nextDay(window.endDate));
    return (row as { n: number }).n;
  }

  function unpostedPayrollRuns(window: PeriodCloseWindow): number {
    const row = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM hr_payroll_run WHERE status IN (${placeholders(UNPOSTED_PAYROLL_STATUSES)}) AND period_end >= ? AND period_end <= ?`,
      )
      .get(...UNPOSTED_PAYROLL_STATUSES, window.startDate, window.endDate) as { n: number };
    return row.n;
  }

  return {
    draftCounts(window) {
      const counts = DOC_SOURCES.map((source) => ({ kind: source.kind, count: countByStatus(source, source.unpostedStatuses ?? DRAFT_STATUSES, window) }));
      counts.push({ kind: PeriodCloseDocKind.PayrollRun, count: unpostedPayrollRuns(window) });
      return counts;
    },
    pendingApprovalCounts(window) {
      return DOC_SOURCES.filter((source) => source.holdsForApproval).map((source) => ({
        kind: source.kind,
        count: countByStatus(source, PENDING_STATUSES, window),
      }));
    },
    numberedDocuments(window) {
      const from = window.startDate;
      const before = nextDay(window.endDate);
      return DOC_SOURCES.flatMap((source) => {
        const column = source.numberColumn;
        if (!column) return [];
        const typeClause = source.docType ? " AND doc_type = ?" : "";
        const typeParams = source.docType ? [source.docType] : [];
        const select = `SELECT ${column} AS number, substr(date, 1, 10) AS date FROM ${source.table} WHERE ${column} IS NOT NULL AND ${column} <> ''${typeClause}`;
        const documents = sqlite.prepare(`${select} AND date >= ? AND date < ?`).all(...typeParams, from, before) as NumberedDocument[];
        const outsideWindow = sqlite.prepare(
          `${select} AND substr(${column}, 1, ?) = ? AND CAST(substr(${column}, ?) AS INTEGER) BETWEEN ? AND ? AND NOT (date >= ? AND date < ?)`,
        );
        for (const range of seriesRangesInWindow(documents, window)) {
          const rows = outsideWindow.all(...typeParams, range.prefix.length, range.prefix, range.prefix.length + 1, range.low, range.high, from, before);
          documents.push(...(rows as NumberedDocument[]));
        }
        return [{ kind: source.kind, documents }];
      });
    },
    bankStatementsOverlapping(window) {
      const rows = sqlite
        .prepare(
          `SELECT s.id, s.treasury_account_id, s.statement_number, s.period_end, s.status, ta.name AS account_name
             FROM bank_statement s
             LEFT JOIN treasury_account ta ON ta.id = s.treasury_account_id
            WHERE s.period_start <= ? AND s.period_end >= ?
            ORDER BY s.period_end, s.id`,
        )
        .all(window.endDate, window.startDate) as { id: string; treasury_account_id: string; statement_number: string | null; period_end: string; status: string; account_name: string | null }[];
      return rows.map((row) => ({
        statementId: row.id,
        treasuryAccountId: row.treasury_account_id,
        statementNumber: row.statement_number,
        treasuryAccountName: row.account_name,
        periodEnd: row.period_end,
        finalized: row.status === StoredStatus.StatementCompleted,
      }));
    },
    bankAccountsWithMovement(window) {
      const rows = sqlite
        .prepare(
          `SELECT ta.id, ta.name
             FROM treasury_account ta
            WHERE ta.type = ? AND ta.gl_account_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id
                 WHERE jl.account_id = ta.gl_account_id AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date >= ? AND je.date <= ?
              )
            ORDER BY ta.id`,
        )
        .all(StoredStatus.BankAccountType, ...LEDGER_EFFECTIVE_STATUSES, window.startDate, window.endDate) as { id: string; name: string }[];
      return rows.map((row) => ({ treasuryAccountId: row.id, name: row.name }));
    },
    payrollDue(window) {
      const year = Number(window.startDate.slice(0, 4));
      const month = Number(window.startDate.slice(5, 7));
      const due = `
        FROM hr_employee e
       WHERE e.hire_date <= @endDate
         AND (e.status <> @terminated OR (e.terminated_at IS NOT NULL AND substr(e.terminated_at, 1, 10) > @endDate))
         AND EXISTS (
           SELECT 1 FROM hr_contract c
            WHERE c.employee_id = e.id AND c.start_date <= @endDate AND (c.end_date IS NULL OR c.end_date >= @startDate)
         )`;
      const params = { startDate: window.startDate, endDate: window.endDate, terminated: StoredStatus.EmployeeTerminated, year, month, approved: StoredStatus.PayrollApproved, disbursed: StoredStatus.PayrollDisbursed };
      const row = sqlite
        .prepare(
          `SELECT COUNT(*) AS due,
                  SUM(CASE WHEN NOT EXISTS (
                    SELECT 1 FROM hr_payslip p JOIN hr_payroll_run r ON r.id = p.run_id
                     WHERE p.employee_id = e.id AND r.year = @year AND r.month = @month AND r.status IN (@approved, @disbursed)
                  ) THEN 1 ELSE 0 END) AS uncovered
           ${due}`,
        )
        .get(params) as { due: number; uncovered: number | null };
      const unposted = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM hr_payroll_run WHERE year = ? AND month = ? AND status IN (${placeholders(UNPOSTED_PAYROLL_STATUSES)})`)
        .get(year, month, ...UNPOSTED_PAYROLL_STATUSES) as { n: number };
      return { dueEmployees: row.due, uncoveredEmployees: row.uncovered ?? 0, hasUnpostedRun: unposted.n > 0 };
    },
    recurringRuns() {
      const rows = sqlite
        .prepare(
          `SELECT r.template_id, r.period, je.status FROM recurring_journal_run r LEFT JOIN journal_entry je ON je.id = r.journal_entry_id`,
        )
        .all() as { template_id: string; period: string; status: string | null }[];
      return rows.map((row) => ({ templateId: row.template_id, period: row.period, entryStatus: row.status }));
    },
    recurringSkips() {
      const rows = sqlite.prepare(`SELECT template_id, period FROM recurring_journal_skip`).all() as { template_id: string; period: string }[];
      return rows.map((row) => ({ templateId: row.template_id, period: row.period }));
    },
    openFxLineGroups(toDate) {
      const rows = sqlite
        .prepare(
          `SELECT jl.account_id, jl.currency, jl.fx_rate, jl.memo, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
             FROM journal_line jl
             JOIN journal_entry je ON je.id = jl.entry_id
            WHERE jl.currency IS NOT NULL AND jl.currency <> ? AND jl.fx_rate IS NOT NULL
              AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date < ?
            GROUP BY jl.account_id, jl.currency, jl.fx_rate, jl.memo`,
        )
        .safeIntegers()
        .all(BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, nextDay(toDate)) as {
        account_id: string;
        currency: string;
        fx_rate: string;
        memo: string | null;
        debit: bigint;
        credit: bigint;
      }[];
      return rows.map((row) => ({
        accountId: row.account_id,
        currency: row.currency,
        fxRate: row.fx_rate,
        memo: row.memo,
        debit: Money.fromScaled(row.debit),
        credit: Money.fromScaled(row.credit),
      }));
    },
    foreignTreasuryCurrencies(toDate) {
      const rows = sqlite
        .prepare(
          `SELECT ta.currency AS currency
             FROM treasury_account ta
             JOIN journal_line jl ON jl.account_id = ta.gl_account_id
             JOIN journal_entry je ON je.id = jl.entry_id
            WHERE ta.currency <> ? AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date < ?
            GROUP BY ta.currency
           HAVING SUM(jl.debit) <> SUM(jl.credit)
            ORDER BY ta.currency`,
        )
        .all(BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, nextDay(toDate)) as { currency: string }[];
      return rows.map((row) => row.currency);
    },
    etaErrorIds(window) {
      const documentDate = `COALESCE(si.date, fd.date, e.created_at)`;
      const rows = sqlite
        .prepare(
          `SELECT e.internal_id
             FROM eta_submission e
             LEFT JOIN sales_invoice si ON si.id = e.internal_id
             LEFT JOIN framework_document fd ON fd.id = e.internal_id
            WHERE e.status = ? AND ${documentDate} >= ? AND ${documentDate} < ?
            ORDER BY e.internal_id`,
        )
        .all(StoredStatus.EtaError, window.startDate, nextDay(window.endDate)) as { internal_id: string }[];
      return rows.map((r) => r.internal_id);
    },
    assetDisposalDates() {
      const rows = sqlite
        .prepare(
          `SELECT source_doc_id AS asset_id, MIN(date) AS date FROM journal_entry
            WHERE source_doc_type = ? AND status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND source_doc_id IS NOT NULL
            GROUP BY source_doc_id`,
        )
        .all(ASSET_DISPOSAL_DOC_TYPE, ...LEDGER_EFFECTIVE_STATUSES) as { asset_id: string; date: string }[];
      return rows.map((row) => ({ assetId: row.asset_id, date: row.date }));
    },
    auditedSeals(periodId) {
      const rows = sqlite
        .prepare(
          `SELECT json_extract(details, '$.sha256') AS seal FROM audit_event WHERE entity_type = ? AND entity_id = ? AND json_extract(details, '$.sha256') IS NOT NULL`,
        )
        .all(FISCAL_PERIOD_ENTITY, periodId) as { seal: string }[];
      return rows.map((row) => row.seal);
    },
    lastAuditedCloser(periodId) {
      const row = sqlite
        .prepare(`SELECT actor FROM audit_event WHERE entity_type = ? AND entity_id = ? AND action = ? ORDER BY id DESC LIMIT 1`)
        .get(FISCAL_PERIOD_ENTITY, periodId, FISCAL_PERIOD_CLOSE_ACTION) as { actor: string } | undefined;
      return row?.actor ?? null;
    },
  };
}

function createFxRunLog(sqlite: Database.Database): FxRevaluationRunLog {
  const insert = sqlite.prepare(`INSERT INTO fx_revaluation_run (as_of_date, currency, entry_id, ran_by, ran_at) VALUES (?, ?, ?, ?, ?)`);
  const runs = sqlite.prepare(`SELECT currency, MAX(ran_at) AS ran_at FROM fx_revaluation_run WHERE as_of_date = ? GROUP BY currency ORDER BY currency`);
  // Prepared on first use: this log is opened before the ledger store has created its tables.
  const lastForeignPosting = (asOfDate: string) =>
    sqlite
      .prepare(
        `SELECT jl.currency AS currency, MAX(COALESCE(je.posted_at, je.created_at)) AS at
           FROM journal_line jl
           JOIN journal_entry je ON je.id = jl.entry_id
          WHERE jl.currency IS NOT NULL AND jl.currency <> ? AND je.status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND je.date <= ?
          GROUP BY jl.currency`,
      )
      .all(BASE_CURRENCY, ...LEDGER_EFFECTIVE_STATUSES, asOfDate) as { currency: string; at: string }[];
  const recordAll = sqlite.transaction((run: FxRevaluationRunRecord) => {
    for (const currency of run.currencies) insert.run(run.asOfDate, currency, run.entryId, run.ranBy, run.ranAt);
  });
  return {
    record: (run) => recordAll(run),
    currenciesRevaluedAsOf(asOfDate) {
      const ranAt = new Map((runs.all(asOfDate) as { currency: string; ran_at: string }[]).map((row) => [row.currency, row.ran_at]));
      const postedAt = new Map(lastForeignPosting(asOfDate).map((row) => [row.currency, row.at]));
      const allRanAt = ranAt.get(FX_REVALUATION_ALL_CURRENCIES);
      const freshSince = (currency: string, run: string | undefined): boolean => run !== undefined && (postedAt.get(currency) ?? "") <= run;
      if (allRanAt !== undefined && [...postedAt.keys()].every((currency) => freshSince(currency, allRanAt))) return [FX_REVALUATION_ALL_CURRENCIES];
      const candidates = new Set([...ranAt.keys(), ...postedAt.keys()]);
      candidates.delete(FX_REVALUATION_ALL_CURRENCIES);
      return [...candidates].filter((currency) => freshSince(currency, ranAt.get(currency)) || freshSince(currency, allRanAt)).sort();
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

/**
 * The close's critical section. `changeToken` is SQLite's `total_changes()` for
 * the ONE connection every store shares: if it is unchanged between the moment
 * the checks were read and the moment `commit` runs, no row anywhere was
 * written in between, so the checklist that was judged is still the truth.
 * `commit` re-reads it, moves the period, writes the summary and the audit row
 * in a single synchronous transaction of its own, and reports `Stale` — having
 * written nothing — when anything moved or another transaction is open.
 */
export interface PeriodCloseCriticalSection {
  changeToken(): number;
  commit(input: PeriodCloseCommit): PeriodCloseCommitOutcome;
}

function createCriticalSection(sqlite: Database.Database, summaries: SqlitePeriodCloseSummaryRepository): PeriodCloseCriticalSection {
  const totalChanges = sqlite.prepare(`SELECT total_changes() AS n`);
  const statusOf = sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = ?`);
  const move = sqlite.prepare(`UPDATE fiscal_period SET status = ? WHERE id = ? AND status = ?`);
  const changeToken = (): number => (totalChanges.get() as { n: number }).n;

  const commit = sqlite.transaction((input: PeriodCloseCommit): PeriodCloseCommitOutcome => {
    if (changeToken() !== input.changeToken) return PeriodCloseCommitOutcome.Stale;
    const current = statusOf.get(input.periodId) as { status: string } | undefined;
    if (current?.status !== input.fromStatus) return PeriodCloseCommitOutcome.Stale;
    move.run(input.toStatus, input.periodId, input.fromStatus);
    if (input.summary) summaries.insertSync(input.summary);
    input.appendAudit(input.auditEvent);
    return PeriodCloseCommitOutcome.Committed;
  });

  return {
    changeToken,
    // An open transaction here belongs to ANOTHER request parked on an await:
    // better-sqlite3 would nest this commit in it as a savepoint, and that
    // request's rollback would undo a close already answered 200.
    commit: (input) => (sqlite.inTransaction ? PeriodCloseCommitOutcome.Stale : commit(input)),
  };
}

export interface SqlitePeriodCloseStoreHandle {
  readonly summaries: PeriodCloseSummaryRepository;
  readonly queries: PeriodCloseQueries;
  readonly fxRuns: FxRevaluationRunLog;
  readonly critical: PeriodCloseCriticalSection;
  close(): void;
}

export function createSqlitePeriodCloseStore(path: SqliteConnectionInput = ":memory:"): SqlitePeriodCloseStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_SUMMARY);
  sqlite.exec(CREATE_FX_RUN);
  const summaries = new SqlitePeriodCloseSummaryRepository(sqlite);
  return {
    summaries,
    queries: createQueries(sqlite),
    fxRuns: createFxRunLog(sqlite),
    critical: createCriticalSection(sqlite, summaries),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
