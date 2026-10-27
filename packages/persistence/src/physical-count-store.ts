import type Database from "better-sqlite3";
import { refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type PhysicalCount,
  type PhysicalCountLine,
  type PhysicalCountListFilter,
  type PhysicalCountRepository,
  type PhysicalCountStatus,
} from "@mezan/domain";

/**
 * SQLite-backed {@link PhysicalCountRepository} (docs/archive/catalog/03 §"الجرد
 * الفعلي"). Lines are stored as one JSON blob column — same convention as
 * `framework-document-store.ts` — since a count's line shape (system/counted
 * qty) is specific to this module and doesn't need its own normalized table.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS physical_count (
  id                     TEXT PRIMARY KEY,
  count_no               TEXT,
  warehouse_id           TEXT NOT NULL,
  date                   TEXT NOT NULL,
  memo                   TEXT NOT NULL,
  status                 TEXT NOT NULL,
  blind                  INTEGER NOT NULL DEFAULT 0,
  zoned                  INTEGER NOT NULL DEFAULT 0,
  lines_json             TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  completed_at           TEXT,
  generated_adjustment_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_count_status ON physical_count(status);
CREATE INDEX IF NOT EXISTS idx_physical_count_warehouse ON physical_count(warehouse_id);
`;

interface CountRow {
  id: string;
  count_no: string | null;
  warehouse_id: string;
  date: string;
  memo: string;
  status: string;
  blind: bigint;
  zoned: bigint;
  lines_json: string;
  created_at: string;
  completed_at: string | null;
  generated_adjustment_id: string | null;
}

interface WireLine {
  itemId: string;
  systemQty: string;
  unitCost?: string;
  countedQty: string | null;
  recount?: boolean;
}

function lineToWire(line: PhysicalCountLine): WireLine {
  return {
    itemId: line.itemId,
    systemQty: line.systemQty.toString(),
    unitCost: line.unitCost.toString(),
    countedQty: line.countedQty ? line.countedQty.toString() : null,
    recount: line.recount,
  };
}

function lineFromWire(wire: WireLine): PhysicalCountLine {
  return {
    itemId: wire.itemId,
    systemQty: Qty.fromMajor(wire.systemQty),
    unitCost: wire.unitCost ? Money.fromMajor(wire.unitCost) : Money.zero(),
    countedQty: wire.countedQty ? Qty.fromMajor(wire.countedQty) : null,
    recount: wire.recount === true,
  };
}

function countParams(count: PhysicalCount): SqlValue[] {
  return [
    count.countNo,
    count.warehouseId,
    count.date,
    count.memo,
    count.status,
    count.blind ? 1 : 0,
    count.zoned ? 1 : 0,
    JSON.stringify(count.lines.map(lineToWire)),
    count.completedAt,
    count.generatedAdjustmentId,
    count.createdAt,
    count.id,
  ];
}

function fromRow(row: CountRow): PhysicalCount {
  const wireLines = JSON.parse(row.lines_json) as WireLine[];
  return {
    id: row.id,
    countNo: row.count_no,
    warehouseId: row.warehouse_id,
    date: row.date,
    memo: row.memo,
    status: row.status as PhysicalCountStatus,
    blind: Number(row.blind) === 1,
    zoned: Number(row.zoned) === 1,
    lines: wireLines.map(lineFromWire),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    generatedAdjustmentId: row.generated_adjustment_id,
  };
}

/**
 * `blind` was added after the table shipped; CREATE TABLE IF NOT EXISTS will
 * not add it to an existing database, so widen it in place.
 */
function addMissingColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(physical_count)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "blind")) {
    sqlite.exec(`ALTER TABLE physical_count ADD COLUMN blind INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.some((c) => c.name === "zoned")) {
    sqlite.exec(`ALTER TABLE physical_count ADD COLUMN zoned INTEGER NOT NULL DEFAULT 0`);
  }
}

class SqlPhysicalCountStore implements PhysicalCountRepository {
  constructor(private readonly db: SqlDb) {}

  async save(count: PhysicalCount): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO physical_count
         (count_no, warehouse_id, date, memo, status, blind, zoned, lines_json, completed_at, generated_adjustment_id, created_at, id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      countParams(count),
    );
    refuseUnlessInserted(count.id, inserted.changes);
  }

  async update(count: PhysicalCount): Promise<void> {
    const params = countParams(count);
    await this.db.run(
      `UPDATE physical_count SET
         count_no = ?, warehouse_id = ?, date = ?, memo = ?,
         status = ?, blind = ?, zoned = ?, lines_json = ?, completed_at = ?,
         generated_adjustment_id = ?
       WHERE id = ?`,
      [...params.slice(0, 10), count.id],
    );
  }

  async findById(id: string): Promise<PhysicalCount | null> {
    const row = await this.db.get<CountRow>(`SELECT * FROM physical_count WHERE id = ?`, [id]);
    return row ? fromRow(row) : null;
  }

  async list(filter: PhysicalCountListFilter = {}): Promise<readonly PhysicalCount[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.warehouseId) {
      clauses.push("warehouse_id = ?");
      params.push(filter.warehouseId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<CountRow>(`SELECT * FROM physical_count ${where} ORDER BY date, created_at`, params);
    return rows.map(fromRow);
  }
}

export type SqlitePhysicalCountStoreHandle = PhysicalCountRepository;

export async function ensurePhysicalCountSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createPhysicalCountStore(db: SqlDb): PhysicalCountRepository {
  return new SqlPhysicalCountStore(db);
}

/** Wire a {@link PhysicalCountRepository} onto an already-open connection. */
export function createSqlitePhysicalCountStore(sqlite: Database.Database): SqlitePhysicalCountStoreHandle {
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  return createPhysicalCountStore(sqliteDb(sqlite));
}
