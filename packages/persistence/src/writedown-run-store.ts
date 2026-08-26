import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  Qty,
  type WritedownRun,
  type WritedownRunLine,
  type WritedownRunRepository,
  type WritedownRunStatus,
} from "@mezan/domain";

/**
 * SQLite-backed store for Inventory Write-down Runs (docs/backlog.md Phase 4
 * "Aging-based inventory write-down batch"). Document-shaped, same modelling
 * as `fixed-assets-store.ts`'s `depreciation_run` table: per-position lines
 * serialized as a JSON text column, Money/Qty round-tripped as exact decimal
 * strings via `.toString()`/`Money.fromMajor`/`Qty.fromMajor` — never floats.
 */

const CREATE_WRITEDOWN_RUN = `
CREATE TABLE IF NOT EXISTS writedown_run (
  id               TEXT PRIMARY KEY,
  period           TEXT NOT NULL,
  warehouse_id     TEXT,
  status           TEXT NOT NULL,
  lines            TEXT NOT NULL,
  total_amount     INTEGER NOT NULL,
  journal_entry_id TEXT,
  created_at       TEXT NOT NULL,
  posted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_writedown_run_period ON writedown_run(period, warehouse_id);
`;

interface WritedownRunRow {
  id: string;
  period: string;
  warehouse_id: string | null;
  status: string;
  lines: string;
  total_amount: number;
  journal_entry_id: string | null;
  created_at: string;
  posted_at: string | null;
}

interface SerializedLine {
  itemId: string;
  warehouseId: string;
  onHandQty: string;
  unitCost: string;
  agingDays: number;
  writedownRateBps: number;
  amount: string;
}

function toWritedownRun(row: WritedownRunRow): WritedownRun {
  const lines = (JSON.parse(row.lines) as SerializedLine[]).map<WritedownRunLine>((l) => ({
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    onHandQty: Qty.fromMajor(l.onHandQty),
    unitCost: Money.fromMajor(l.unitCost),
    agingDays: l.agingDays,
    writedownRateBps: l.writedownRateBps,
    amount: Money.fromMajor(l.amount),
  }));
  return {
    id: row.id,
    period: row.period,
    warehouseId: row.warehouse_id,
    status: row.status as WritedownRunStatus,
    lines,
    totalAmount: Money.fromScaled(row.total_amount),
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    postedAt: row.posted_at,
  };
}

class SqliteWritedownRunRepository implements WritedownRunRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByPeriodWarehouse: Database.Statement;
  private readonly selectByPeriodNullWarehouse: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO writedown_run (id, period, warehouse_id, status, lines, total_amount, journal_entry_id, created_at, posted_at)
      VALUES (@id, @period, @warehouse_id, @status, @lines, @total_amount, @journal_entry_id, @created_at, @posted_at)
      ON CONFLICT(id) DO UPDATE SET
        period = excluded.period,
        warehouse_id = excluded.warehouse_id,
        status = excluded.status,
        lines = excluded.lines,
        total_amount = excluded.total_amount,
        journal_entry_id = excluded.journal_entry_id,
        created_at = excluded.created_at,
        posted_at = excluded.posted_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM writedown_run WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM writedown_run`);
    this.selectByPeriodWarehouse = sqlite.prepare(`SELECT * FROM writedown_run WHERE period = ? AND warehouse_id = ?`);
    this.selectByPeriodNullWarehouse = sqlite.prepare(
      `SELECT * FROM writedown_run WHERE period = ? AND warehouse_id IS NULL`,
    );
  }

  async findById(id: string): Promise<WritedownRun | null> {
    const row = this.selectById.get(id) as WritedownRunRow | undefined;
    return row ? toWritedownRun(row) : null;
  }

  async findByPeriod(period: string, warehouseId: string | null): Promise<WritedownRun | null> {
    const row = (
      warehouseId === null
        ? this.selectByPeriodNullWarehouse.get(period)
        : this.selectByPeriodWarehouse.get(period, warehouseId)
    ) as WritedownRunRow | undefined;
    return row ? toWritedownRun(row) : null;
  }

  async list(): Promise<WritedownRun[]> {
    return (this.selectAll.all() as WritedownRunRow[]).map(toWritedownRun);
  }

  async create(run: WritedownRun): Promise<void> {
    this.write(run);
  }

  async update(run: WritedownRun): Promise<void> {
    this.write(run);
  }

  private write(run: WritedownRun): void {
    const lines: SerializedLine[] = run.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      onHandQty: l.onHandQty.toString(),
      unitCost: l.unitCost.toString(),
      agingDays: l.agingDays,
      writedownRateBps: l.writedownRateBps,
      amount: l.amount.toString(),
    }));
    this.upsert.run({
      id: run.id,
      period: run.period,
      warehouse_id: run.warehouseId,
      status: run.status,
      lines: JSON.stringify(lines),
      total_amount: run.totalAmount.toScaledNumber(),
      journal_entry_id: run.journalEntryId,
      created_at: run.createdAt,
      posted_at: run.postedAt,
    });
  }
}

export interface SqliteWritedownRunRepositoryHandle extends WritedownRunRepository {
  close(): void;
}

/** Open a SQLite-backed WritedownRunRepository. ":memory:" for tests, a path for real. */
export function createSqliteWritedownRunRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteWritedownRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_WRITEDOWN_RUN);
  const repo = new SqliteWritedownRunRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteWritedownRunRepositoryHandle;
}
