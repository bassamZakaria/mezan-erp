import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  PeriodCloseDocKind,
  type NumberedDocument,
  type PeriodCloseCheckCode,
  type PeriodCloseCheckResult,
  type PeriodCloseDraftCount,
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

interface DraftSource {
  readonly kind: PeriodCloseDocKind;
  readonly table: string;
  readonly where: string;
  readonly byPeriodKey?: boolean;
}

const DRAFT_SOURCES: readonly DraftSource[] = [
  { kind: PeriodCloseDocKind.JournalEntry, table: "journal_entry", where: "status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.SalesInvoice, table: "sales_invoice", where: "status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.PurchaseInvoice, table: "purchase_invoice", where: "status = 'draft'" },
  { kind: PeriodCloseDocKind.GoodsReceipt, table: "goods_receipt", where: "status = 'draft'" },
  { kind: PeriodCloseDocKind.Voucher, table: "voucher", where: "status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.SalesReturn, table: "framework_document", where: "doc_type = 'SALES_RETURN' AND status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.PurchaseReturn, table: "framework_document", where: "doc_type = 'PURCHASE_RETURN' AND status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.LandedCost, table: "framework_document", where: "doc_type = 'LANDED_COST' AND status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.StockTransfer, table: "stock_transfer_document", where: "status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.StockAdjustment, table: "stock_adjustment_document", where: "status IN ('draft','pending')" },
  { kind: PeriodCloseDocKind.DepreciationRun, table: "depreciation_run", where: "status = 'draft'", byPeriodKey: true },
  { kind: PeriodCloseDocKind.WritedownRun, table: "writedown_run", where: "status = 'draft'", byPeriodKey: true },
];

interface NumberSource {
  readonly kind: PeriodCloseDocKind;
  readonly table: string;
  readonly column: string;
  readonly where?: string;
}

const NUMBER_SOURCES: readonly NumberSource[] = [
  { kind: PeriodCloseDocKind.JournalEntry, table: "journal_entry", column: "entry_no" },
  { kind: PeriodCloseDocKind.SalesInvoice, table: "sales_invoice", column: "doc_no" },
  { kind: PeriodCloseDocKind.PurchaseInvoice, table: "purchase_invoice", column: "number" },
  { kind: PeriodCloseDocKind.GoodsReceipt, table: "goods_receipt", column: "number" },
  { kind: PeriodCloseDocKind.Voucher, table: "voucher", column: "doc_no" },
  { kind: PeriodCloseDocKind.SalesReturn, table: "framework_document", column: "doc_no", where: "doc_type = 'SALES_RETURN'" },
  { kind: PeriodCloseDocKind.PurchaseReturn, table: "framework_document", column: "doc_no", where: "doc_type = 'PURCHASE_RETURN'" },
  { kind: PeriodCloseDocKind.LandedCost, table: "framework_document", column: "doc_no", where: "doc_type = 'LANDED_COST'" },
  { kind: PeriodCloseDocKind.StockTransfer, table: "stock_transfer_document", column: "doc_no" },
  { kind: PeriodCloseDocKind.StockAdjustment, table: "stock_adjustment_document", column: "doc_no" },
];

export interface PeriodCloseQueries {
  draftCounts(window: PeriodCloseWindow): PeriodCloseDraftCount[];
  numberedDocuments(): { kind: PeriodCloseDocKind; documents: NumberedDocument[] }[];
  unpostedPayrollRuns(window: PeriodCloseWindow): number;
  fxRevaluationEntries(window: PeriodCloseWindow): number;
  journalEntryStatus(id: string): string | null;
}

function createQueries(sqlite: Database.Database): PeriodCloseQueries {
  const tableExists = (name: string): boolean =>
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;

  return {
    draftCounts(window) {
      const counts: PeriodCloseDraftCount[] = [];
      for (const source of DRAFT_SOURCES) {
        if (!tableExists(source.table)) continue;
        const row = source.byPeriodKey
          ? (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${source.where} AND period = ?`).get(window.startDate.slice(0, 7)) as { n: number })
          : (sqlite
              .prepare(`SELECT COUNT(*) AS n FROM ${source.table} WHERE ${source.where} AND date >= ? AND date <= ?`)
              .get(window.startDate, `${window.endDate}￿`) as { n: number });
        counts.push({ kind: source.kind, count: row.n });
      }
      const payroll = this.unpostedPayrollRuns(window);
      counts.push({ kind: PeriodCloseDocKind.PayrollRun, count: payroll });
      return counts;
    },
    unpostedPayrollRuns(window) {
      if (!tableExists("hr_payroll_run")) return 0;
      const row = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM hr_payroll_run WHERE status IN ('draft','calculated') AND period_end >= ? AND period_end <= ?`)
        .get(window.startDate, window.endDate) as { n: number };
      return row.n;
    },
    numberedDocuments() {
      const out: { kind: PeriodCloseDocKind; documents: NumberedDocument[] }[] = [];
      for (const source of NUMBER_SOURCES) {
        if (!tableExists(source.table)) continue;
        const rows = sqlite
          .prepare(
            `SELECT ${source.column} AS number, substr(date, 1, 10) AS date FROM ${source.table} WHERE ${source.column} IS NOT NULL AND ${source.column} <> ''${source.where ? ` AND ${source.where}` : ""}`,
          )
          .all() as NumberedDocument[];
        out.push({ kind: source.kind, documents: rows });
      }
      return out;
    },
    fxRevaluationEntries(window) {
      const row = sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM journal_entry WHERE source_doc_type = 'FX_REVALUATION' AND reverses_entry_id IS NULL AND status IN ('posted','reversed') AND date >= ? AND date <= ?`,
        )
        .get(window.startDate, `${window.endDate}￿`) as { n: number };
      return row.n;
    },
    journalEntryStatus(id) {
      const row = sqlite.prepare(`SELECT status FROM journal_entry WHERE id = ?`).get(id) as { status: string } | undefined;
      return row?.status ?? null;
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
