import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type CostCategory,
  type RecognitionPolicy,
  type RecognitionRunFilter,
  type RecognitionRunStatus,
  type RevenueRecognitionRun,
  type RevenueRecognitionRunRepository,
  type WipCategoryAmount,
} from "@mezan/domain";

/**
 * SQLite-backed store for تشغيل الاعتراف بالإيراد (slice 4B of المقاولات).
 * Every figure the run computed is stored as a scaled INTEGER at 1e-6, so a
 * posted month can be re-explained years later without recomputing it against a
 * ledger that has moved on.
 *
 * `(contract_id, period_end)` is UNIQUE only across LIVE runs, which is why the
 * uniqueness is a partial index on `status = 'posted'`: a reversed month must
 * be runnable again.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS contracting_recognition_run (
  id                             TEXT PRIMARY KEY,
  doc_no                         TEXT NOT NULL UNIQUE,
  contract_id                    TEXT NOT NULL,
  contract_doc_no                TEXT NOT NULL,
  project_id                     TEXT NOT NULL,
  period_end                     TEXT NOT NULL,
  status                         TEXT NOT NULL,
  recognition_policy             TEXT NOT NULL,
  estimated_total_cost           INTEGER NOT NULL,
  cost_to_date                   INTEGER NOT NULL,
  cost_to_complete               INTEGER NOT NULL,
  percent_complete               TEXT NOT NULL,
  contract_value                 INTEGER NOT NULL,
  revenue_to_date                INTEGER NOT NULL,
  revenue_recognised_previously  INTEGER NOT NULL,
  period_revenue                 INTEGER NOT NULL,
  billed_in_period               INTEGER NOT NULL,
  billed_to_date                 INTEGER NOT NULL,
  contract_asset                 INTEGER NOT NULL,
  contract_liability             INTEGER NOT NULL,
  contract_position_movement     INTEGER NOT NULL,
  foreseeable_loss               INTEGER NOT NULL,
  provision_required             INTEGER NOT NULL,
  provision_balance              INTEGER NOT NULL,
  provision_movement             INTEGER NOT NULL,
  wip_opening                    INTEGER NOT NULL,
  wip_incurred                   INTEGER NOT NULL,
  wip_relieved                   INTEGER NOT NULL,
  wip_closing                    INTEGER NOT NULL,
  wip_by_category                TEXT NOT NULL DEFAULT '[]',
  journal_entry_id               TEXT,
  reversal_journal_entry_id      TEXT,
  posted_at                      TEXT NOT NULL,
  posted_by                      TEXT,
  reversed_at                    TEXT,
  reversed_by                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_recognition_run_contract ON contracting_recognition_run (contract_id, period_end);
CREATE INDEX IF NOT EXISTS idx_recognition_run_project ON contracting_recognition_run (project_id, period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recognition_run_live
  ON contracting_recognition_run (contract_id, period_end) WHERE status = 'posted';
`;

interface RunRow {
  id: string;
  doc_no: string;
  contract_id: string;
  contract_doc_no: string;
  project_id: string;
  period_end: string;
  status: string;
  recognition_policy: string;
  estimated_total_cost: number;
  cost_to_date: number;
  cost_to_complete: number;
  percent_complete: string;
  contract_value: number;
  revenue_to_date: number;
  revenue_recognised_previously: number;
  period_revenue: number;
  billed_in_period: number;
  billed_to_date: number;
  contract_asset: number;
  contract_liability: number;
  contract_position_movement: number;
  foreseeable_loss: number;
  provision_required: number;
  provision_balance: number;
  provision_movement: number;
  wip_opening: number;
  wip_incurred: number;
  wip_relieved: number;
  wip_closing: number;
  wip_by_category: string;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  posted_at: string;
  posted_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
}

interface WipCategoryJson {
  costCategory: CostCategory | null;
  amount: number;
}

function toWipByCategory(json: string): WipCategoryAmount[] {
  return (JSON.parse(json) as WipCategoryJson[]).map((row) => ({
    costCategory: row.costCategory ?? null,
    amount: Money.fromScaled(row.amount),
  }));
}

function toRun(row: RunRow): RevenueRecognitionRun {
  return {
    id: row.id,
    docNo: row.doc_no,
    contractId: row.contract_id,
    contractDocNo: row.contract_doc_no,
    projectId: row.project_id,
    periodEnd: row.period_end,
    status: row.status as RecognitionRunStatus,
    recognitionPolicy: row.recognition_policy as RecognitionPolicy,
    estimatedTotalCost: Money.fromScaled(row.estimated_total_cost),
    costToDate: Money.fromScaled(row.cost_to_date),
    costToComplete: Money.fromScaled(row.cost_to_complete),
    percentComplete: row.percent_complete,
    contractValue: Money.fromScaled(row.contract_value),
    revenueToDate: Money.fromScaled(row.revenue_to_date),
    revenueRecognisedPreviously: Money.fromScaled(row.revenue_recognised_previously),
    periodRevenue: Money.fromScaled(row.period_revenue),
    billedInPeriod: Money.fromScaled(row.billed_in_period),
    billedToDate: Money.fromScaled(row.billed_to_date),
    contractAsset: Money.fromScaled(row.contract_asset),
    contractLiability: Money.fromScaled(row.contract_liability),
    contractPositionMovement: Money.fromScaled(row.contract_position_movement),
    foreseeableLoss: Money.fromScaled(row.foreseeable_loss),
    provisionRequired: Money.fromScaled(row.provision_required),
    provisionBalance: Money.fromScaled(row.provision_balance),
    provisionMovement: Money.fromScaled(row.provision_movement),
    wipOpening: Money.fromScaled(row.wip_opening),
    wipIncurred: Money.fromScaled(row.wip_incurred),
    wipRelieved: Money.fromScaled(row.wip_relieved),
    wipClosing: Money.fromScaled(row.wip_closing),
    wipByCategory: toWipByCategory(row.wip_by_category),
    journalEntryId: row.journal_entry_id,
    reversalJournalEntryId: row.reversal_journal_entry_id,
    postedAt: row.posted_at,
    postedBy: row.posted_by,
    reversedAt: row.reversed_at,
    reversedBy: row.reversed_by,
  };
}

class SqliteRecognitionRunRepository implements RevenueRecognitionRunRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByDocNo: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO contracting_recognition_run (
        id, doc_no, contract_id, contract_doc_no, project_id, period_end, status,
        recognition_policy, estimated_total_cost, cost_to_date, cost_to_complete, percent_complete,
        contract_value, revenue_to_date, revenue_recognised_previously, period_revenue,
        billed_in_period, billed_to_date, contract_asset, contract_liability, contract_position_movement,
        foreseeable_loss, provision_required, provision_balance, provision_movement,
        wip_opening, wip_incurred, wip_relieved, wip_closing, wip_by_category,
        journal_entry_id, reversal_journal_entry_id, posted_at, posted_by, reversed_at, reversed_by
      ) VALUES (
        @id, @doc_no, @contract_id, @contract_doc_no, @project_id, @period_end, @status,
        @recognition_policy, @estimated_total_cost, @cost_to_date, @cost_to_complete, @percent_complete,
        @contract_value, @revenue_to_date, @revenue_recognised_previously, @period_revenue,
        @billed_in_period, @billed_to_date, @contract_asset, @contract_liability, @contract_position_movement,
        @foreseeable_loss, @provision_required, @provision_balance, @provision_movement,
        @wip_opening, @wip_incurred, @wip_relieved, @wip_closing, @wip_by_category,
        @journal_entry_id, @reversal_journal_entry_id, @posted_at, @posted_by, @reversed_at, @reversed_by
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        journal_entry_id = excluded.journal_entry_id,
        reversal_journal_entry_id = excluded.reversal_journal_entry_id,
        reversed_at = excluded.reversed_at,
        reversed_by = excluded.reversed_by
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM contracting_recognition_run WHERE id = ?`);
    this.selectByDocNo = sqlite.prepare(`SELECT * FROM contracting_recognition_run WHERE doc_no = ?`);
    this.selectAll = sqlite.prepare(
      `SELECT * FROM contracting_recognition_run ORDER BY period_end DESC, doc_no DESC`,
    );
  }

  async findById(id: string): Promise<RevenueRecognitionRun | null> {
    const row = this.selectById.get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async findByDocNo(docNo: string): Promise<RevenueRecognitionRun | null> {
    const row = this.selectByDocNo.get(docNo) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async list(filter?: RecognitionRunFilter): Promise<RevenueRecognitionRun[]> {
    return (this.selectAll.all() as RunRow[])
      .map(toRun)
      .filter(
        (r) =>
          (!filter?.contractId || r.contractId === filter.contractId) &&
          (!filter?.projectId || r.projectId === filter.projectId) &&
          (!filter?.periodEnd || r.periodEnd === filter.periodEnd) &&
          (!filter?.status || r.status === filter.status),
      );
  }

  async save(run: RevenueRecognitionRun): Promise<void> {
    this.upsert.run({
      id: run.id,
      doc_no: run.docNo,
      contract_id: run.contractId,
      contract_doc_no: run.contractDocNo,
      project_id: run.projectId,
      period_end: run.periodEnd,
      status: run.status,
      recognition_policy: run.recognitionPolicy,
      estimated_total_cost: run.estimatedTotalCost.toScaledNumber(),
      cost_to_date: run.costToDate.toScaledNumber(),
      cost_to_complete: run.costToComplete.toScaledNumber(),
      percent_complete: run.percentComplete,
      contract_value: run.contractValue.toScaledNumber(),
      revenue_to_date: run.revenueToDate.toScaledNumber(),
      revenue_recognised_previously: run.revenueRecognisedPreviously.toScaledNumber(),
      period_revenue: run.periodRevenue.toScaledNumber(),
      billed_in_period: run.billedInPeriod.toScaledNumber(),
      billed_to_date: run.billedToDate.toScaledNumber(),
      contract_asset: run.contractAsset.toScaledNumber(),
      contract_liability: run.contractLiability.toScaledNumber(),
      contract_position_movement: run.contractPositionMovement.toScaledNumber(),
      foreseeable_loss: run.foreseeableLoss.toScaledNumber(),
      provision_required: run.provisionRequired.toScaledNumber(),
      provision_balance: run.provisionBalance.toScaledNumber(),
      provision_movement: run.provisionMovement.toScaledNumber(),
      wip_opening: run.wipOpening.toScaledNumber(),
      wip_incurred: run.wipIncurred.toScaledNumber(),
      wip_relieved: run.wipRelieved.toScaledNumber(),
      wip_closing: run.wipClosing.toScaledNumber(),
      wip_by_category: JSON.stringify(
        run.wipByCategory.map((b) => ({ costCategory: b.costCategory, amount: b.amount.toScaledNumber() })),
      ),
      journal_entry_id: run.journalEntryId,
      reversal_journal_entry_id: run.reversalJournalEntryId,
      posted_at: run.postedAt,
      posted_by: run.postedBy,
      reversed_at: run.reversedAt,
      reversed_by: run.reversedBy,
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
}

export interface SqliteRecognitionStoreHandle extends RevenueRecognitionRunRepository {
  close(): void;
}

/** Open a SQLite-backed recognition-run store. ":memory:" for tests, a path for real. */
export function createSqliteContractingRecognitionStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteRecognitionStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteRecognitionRunRepository(sqlite);
  return Object.assign(repo, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteRecognitionStoreHandle;
}
