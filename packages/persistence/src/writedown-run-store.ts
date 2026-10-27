import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type WritedownRun,
  type WritedownRunLine,
  type WritedownRunRepository,
  type WritedownRunStatus,
} from "@mezan/domain";

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

const UPSERT = `
  INSERT INTO writedown_run (id, period, warehouse_id, status, lines, total_amount, journal_entry_id, created_at, posted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    period = excluded.period,
    warehouse_id = excluded.warehouse_id,
    status = excluded.status,
    lines = excluded.lines,
    total_amount = excluded.total_amount,
    journal_entry_id = excluded.journal_entry_id,
    created_at = excluded.created_at,
    posted_at = excluded.posted_at`;

interface WritedownRunRow {
  id: string;
  period: string;
  warehouse_id: string | null;
  status: string;
  lines: string;
  total_amount: bigint;
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

function params(run: WritedownRun): SqlValue[] {
  const lines: SerializedLine[] = run.lines.map((l) => ({
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    onHandQty: l.onHandQty.toString(),
    unitCost: l.unitCost.toString(),
    agingDays: l.agingDays,
    writedownRateBps: l.writedownRateBps,
    amount: l.amount.toString(),
  }));
  return [run.id, run.period, run.warehouseId, run.status, JSON.stringify(lines), run.totalAmount.scaled, run.journalEntryId, run.createdAt, run.postedAt];
}

class SqlWritedownRunRepository implements WritedownRunRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<WritedownRun | null> {
    const row = await this.db.get<WritedownRunRow>(`SELECT * FROM writedown_run WHERE id = ?`, [id]);
    return row ? toWritedownRun(row) : null;
  }

  async findByPeriod(period: string, warehouseId: string | null): Promise<WritedownRun | null> {
    const row =
      warehouseId === null
        ? await this.db.get<WritedownRunRow>(
            `SELECT * FROM writedown_run WHERE period = ? AND warehouse_id IS NULL ORDER BY (status = 'cancelled'), created_at DESC`,
            [period],
          )
        : await this.db.get<WritedownRunRow>(
            `SELECT * FROM writedown_run WHERE period = ? AND warehouse_id = ? ORDER BY (status = 'cancelled'), created_at DESC`,
            [period, warehouseId],
          );
    return row ? toWritedownRun(row) : null;
  }

  async list(): Promise<WritedownRun[]> {
    return (await this.db.all<WritedownRunRow>(`SELECT * FROM writedown_run`)).map(toWritedownRun);
  }

  async create(run: WritedownRun): Promise<void> {
    await insertNew(this.db, run.id, UPSERT, params(run));
  }

  async update(run: WritedownRun): Promise<void> {
    await this.db.run(UPSERT, params(run));
  }
}

export interface SqliteWritedownRunRepositoryHandle extends WritedownRunRepository {
  close(): void;
}

export async function ensureWritedownRunSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_WRITEDOWN_RUN);
}

export function createWritedownRunRepository(db: SqlDb): WritedownRunRepository {
  return new SqlWritedownRunRepository(db);
}

export function createSqliteWritedownRunRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteWritedownRunRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_WRITEDOWN_RUN);
  return Object.assign(createWritedownRunRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteWritedownRunRepositoryHandle;
}
