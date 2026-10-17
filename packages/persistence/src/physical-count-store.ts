import Database from "better-sqlite3";
import { insertingNew } from "./insert-new.js";
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
  blind: number;
  zoned: number;
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

function toRow(count: PhysicalCount): Record<string, unknown> {
  return {
    id: count.id,
    count_no: count.countNo,
    warehouse_id: count.warehouseId,
    date: count.date,
    memo: count.memo,
    status: count.status,
    blind: count.blind ? 1 : 0,
    zoned: count.zoned ? 1 : 0,
    lines_json: JSON.stringify(count.lines.map(lineToWire)),
    created_at: count.createdAt,
    completed_at: count.completedAt,
    generated_adjustment_id: count.generatedAdjustmentId,
  };
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
    blind: row.blind === 1,
    zoned: row.zoned === 1,
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

class SqlitePhysicalCountStore implements PhysicalCountRepository {
  private readonly insert: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.sqlite.exec(CREATE_TABLE);
    addMissingColumns(sqlite);
    this.insert = sqlite.prepare(`
      INSERT INTO physical_count
        (id, count_no, warehouse_id, date, memo, status, blind, zoned, lines_json, created_at, completed_at, generated_adjustment_id)
      VALUES
        (@id, @count_no, @warehouse_id, @date, @memo, @status, @blind, @zoned, @lines_json, @created_at, @completed_at, @generated_adjustment_id)
    `);
    this.upsert = sqlite.prepare(`
      UPDATE physical_count SET
        count_no = @count_no, warehouse_id = @warehouse_id, date = @date, memo = @memo,
        status = @status, blind = @blind, zoned = @zoned, lines_json = @lines_json, completed_at = @completed_at,
        generated_adjustment_id = @generated_adjustment_id
      WHERE id = @id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM physical_count WHERE id = ?`);
  }

  async save(count: PhysicalCount): Promise<void> {
    insertingNew(count.id, () => this.insert.run(toRow(count)));
  }

  async update(count: PhysicalCount): Promise<void> {
    this.upsert.run(toRow(count));
  }

  async findById(id: string): Promise<PhysicalCount | null> {
    const row = this.selectById.get(id) as CountRow | undefined;
    return row ? fromRow(row) : null;
  }

  async list(filter: PhysicalCountListFilter = {}): Promise<readonly PhysicalCount[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.warehouseId) {
      clauses.push("warehouse_id = ?");
      params.push(filter.warehouseId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM physical_count ${where} ORDER BY date, created_at`)
      .all(...params) as CountRow[];
    return rows.map(fromRow);
  }
}

export type SqlitePhysicalCountStoreHandle = PhysicalCountRepository;

/** Wire a {@link PhysicalCountRepository} onto an already-open connection. */
export function createSqlitePhysicalCountStore(sqlite: Database.Database): SqlitePhysicalCountStoreHandle {
  return new SqlitePhysicalCountStore(sqlite);
}
