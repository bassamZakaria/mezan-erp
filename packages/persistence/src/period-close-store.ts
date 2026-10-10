import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  FX_REVALUATION_DOC_TYPE,
  Money,
  PeriodCloseDocKind,
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
  readonly numberColumn?: string;
  readonly holdsForApproval?: boolean;
}

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
];

const DRAFT_STATUS = "draft";
const PENDING_STATUS = "pending";
const UNPOSTED_PAYROLL_STATUSES = ["draft", "calculated"] as const;
const LEDGER_EFFECTIVE_STATUSES = ["posted", "reversed"] as const;
const ETA_ERROR_STATUS = "error";

export interface PeriodCloseQueries {
  draftCounts(window: PeriodCloseWindow): PeriodCloseDocCount[];
  pendingApprovalCounts(window: PeriodCloseWindow): PeriodCloseDocCount[];
  numberedDocuments(window: PeriodCloseWindow): { kind: PeriodCloseDocKind; documents: NumberedDocument[] }[];
  fxRevaluationEntries(window: PeriodCloseWindow): number;
  journalEntryStatus(id: string): string | null;
  etaErrorIds(window: PeriodCloseWindow): string[];
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function dayAfter(isoDay: string): string {
  const next = new Date(`${isoDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Table and column names below come only from DOC_SOURCES, never from a caller; every value is bound.
function createQueries(sqlite: Database.Database): PeriodCloseQueries {
  function countByStatus(source: DocSource, status: string, window: PeriodCloseWindow): number {
    const typeClause = source.docType ? " AND doc_type = ?" : "";
    const typeParams = source.docType ? [source.docType] : [];
    const row = source.byPeriodKey
      ? sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE status = ?${typeClause} AND period = ?`)
          .get(status, ...typeParams, window.startDate.slice(0, 7))
      : sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE status = ?${typeClause} AND date >= ? AND date < ?`)
          .get(status, ...typeParams, window.startDate, dayAfter(window.endDate));
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
      const counts = DOC_SOURCES.map((source) => ({ kind: source.kind, count: countByStatus(source, DRAFT_STATUS, window) }));
      counts.push({ kind: PeriodCloseDocKind.PayrollRun, count: unpostedPayrollRuns(window) });
      return counts;
    },
    pendingApprovalCounts(window) {
      return DOC_SOURCES.filter((source) => source.holdsForApproval).map((source) => ({
        kind: source.kind,
        count: countByStatus(source, PENDING_STATUS, window),
      }));
    },
    // Every document whose number falls between the period's lowest and highest number, whatever its date:
    // a number used by a document dated in another month is not a gap in this one.
    numberedDocuments(window) {
      const from = window.startDate;
      const before = dayAfter(window.endDate);
      return DOC_SOURCES.flatMap((source) => {
        const column = source.numberColumn;
        if (!column) return [];
        const typeClause = source.docType ? " AND doc_type = ?" : "";
        const typeParams = source.docType ? [source.docType] : [];
        const numbered = `${column} IS NOT NULL AND ${column} <> ''${typeClause}`;
        const inWindow = `FROM ${source.table} WHERE ${numbered} AND date >= ? AND date < ?`;
        const documents = sqlite
          .prepare(
            `SELECT ${column} AS number, substr(date, 1, 10) AS date FROM ${source.table}
              WHERE ${numbered}
                AND ${column} >= (SELECT MIN(${column}) ${inWindow})
                AND ${column} <= (SELECT MAX(${column}) ${inWindow})`,
          )
          .all(...typeParams, ...typeParams, from, before, ...typeParams, from, before) as NumberedDocument[];
        return [{ kind: source.kind, documents }];
      });
    },
    fxRevaluationEntries(window) {
      const row = sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM journal_entry WHERE source_doc_type = ? AND reverses_entry_id IS NULL AND status IN (${placeholders(LEDGER_EFFECTIVE_STATUSES)}) AND date >= ? AND date < ?`,
        )
        .get(FX_REVALUATION_DOC_TYPE, ...LEDGER_EFFECTIVE_STATUSES, window.startDate, dayAfter(window.endDate)) as { n: number };
      return row.n;
    },
    journalEntryStatus(id) {
      const row = sqlite.prepare(`SELECT status FROM journal_entry WHERE id = ?`).get(id) as { status: string } | undefined;
      return row?.status ?? null;
    },
    etaErrorIds(window) {
      const rows = sqlite
        .prepare(
          `SELECT internal_id FROM eta_submission WHERE status = ? AND created_at >= ? AND created_at < ? ORDER BY internal_id`,
        )
        .all(ETA_ERROR_STATUS, window.startDate, dayAfter(window.endDate)) as { internal_id: string }[];
      return rows.map((r) => r.internal_id);
    },
  };
}

export interface SqlitePeriodCloseStoreHandle {
  readonly summaries: PeriodCloseSummaryRepository;
  readonly queries: PeriodCloseQueries;
  close(): void;
}

export function createSqlitePeriodCloseStore(path: SqliteConnectionInput = ":memory:"): SqlitePeriodCloseStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_SUMMARY);
  return {
    summaries: new SqlitePeriodCloseSummaryRepository(sqlite),
    queries: createQueries(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
