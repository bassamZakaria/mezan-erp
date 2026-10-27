import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  latestStandingRevaluation,
  type StandingStockRevaluation,
  type CostLayer,
  type CostLayerRepository,
  type StockLedgerRepository,
  type StockMovement,
  type StockMovementDirection,
  type StockSourceDocType,
  type WacSnapshot,
  type WacSnapshotRepository,
  type AdjustmentReason,
} from "@mezan/domain";

/**
 * SQLite-backed store for the costing + stock-ledger engine. ONE connection
 * owns all three tables (movements, cost layers, WAC snapshots) so the
 * StockLedgerService can commit a movement + layer + snapshot (+ GL posting)
 * atomically via `transaction()` (docs/archive/plan.md §2.2).
 *
 * Money/Qty are stored as scaled INTEGER (scale 1e-6, docs/archive/plan.md §2.3) — never
 * REAL. The ledger is append-only and cost-layer unit costs are immutable, both
 * enforced by BEFORE-triggers so a stray UPDATE/DELETE can't corrupt the audit
 * trail or a layer's receipt-time price (docs/archive/catalog/03).
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS stock_movement (
  seq               INTEGER PRIMARY KEY AUTOINCREMENT,
  id                TEXT NOT NULL UNIQUE,
  item_id           TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  direction         TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  unit_cost         INTEGER NOT NULL,
  source_doc_type   TEXT NOT NULL,
  source_doc_id     TEXT NOT NULL,
  source_doc_number TEXT,
  reason            TEXT,
  occurred_at       TEXT NOT NULL,
  batch_no          TEXT,
  expiry_date       TEXT,
  value_delta       INTEGER,
  value             INTEGER,
  revalues_doc_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_movement_position ON stock_movement(item_id, warehouse_id, seq);
CREATE INDEX IF NOT EXISTS idx_movement_item ON stock_movement(item_id, seq);
CREATE INDEX IF NOT EXISTS idx_movement_warehouse ON stock_movement(warehouse_id, seq);
CREATE INDEX IF NOT EXISTS idx_movement_source ON stock_movement(source_doc_type, source_doc_id, seq);
CREATE INDEX IF NOT EXISTS idx_movement_source_doc ON stock_movement(source_doc_id, seq);
-- Every other index leads with an entity, so a report bounded only by date
-- (the movement report, the valuation-drift replay, a period close) had no
-- index to open and fell back to a full scan. seq trails the date so a range
-- scan still reads the ledger in its append order.
CREATE INDEX IF NOT EXISTS idx_movement_occurred ON stock_movement(occurred_at, seq);
-- The whole-ledger read the inventory reports share (Q-6): matching the
-- ORDER BY exactly turns it into an index scan rather than a sort of the table.
CREATE INDEX IF NOT EXISTS idx_movement_all_order ON stock_movement(item_id, warehouse_id, occurred_at, seq);

CREATE TABLE IF NOT EXISTS cost_layer (
  seq               INTEGER PRIMARY KEY AUTOINCREMENT,
  id                TEXT NOT NULL UNIQUE,
  item_id           TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  unit_cost         INTEGER NOT NULL,
  original_qty      INTEGER NOT NULL,
  remaining_qty     INTEGER NOT NULL,
  source_doc_type   TEXT NOT NULL,
  source_doc_id     TEXT NOT NULL,
  source_doc_number TEXT,
  created_at        TEXT NOT NULL,
  batch_no          TEXT,
  expiry_date       TEXT
);
CREATE INDEX IF NOT EXISTS idx_layer_position ON cost_layer(item_id, warehouse_id, seq);

CREATE TABLE IF NOT EXISTS wac_snapshot (
  item_id      TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  on_hand      INTEGER NOT NULL,
  total_value  INTEGER NOT NULL,
  average_cost INTEGER NOT NULL,
  PRIMARY KEY (item_id, warehouse_id)
);
`;

const CREATE_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS stock_movement_no_update
BEFORE UPDATE ON stock_movement
BEGIN
  SELECT RAISE(ABORT, 'stock_movement is append-only');
END;
CREATE TRIGGER IF NOT EXISTS stock_movement_no_delete
BEFORE DELETE ON stock_movement
BEGIN
  SELECT RAISE(ABORT, 'stock_movement is append-only');
END;

-- A layer's receipt-time unit cost is immutable; only remaining_qty may change.
CREATE TRIGGER IF NOT EXISTS cost_layer_immutable_cost
BEFORE UPDATE OF unit_cost, original_qty, item_id, warehouse_id ON cost_layer
WHEN NEW.unit_cost <> OLD.unit_cost
  OR NEW.original_qty <> OLD.original_qty
  OR NEW.item_id <> OLD.item_id
  OR NEW.warehouse_id <> OLD.warehouse_id
BEGIN
  SELECT RAISE(ABORT, 'cost_layer unit cost / origin is immutable');
END;
`;

const CREATE_TRIGGERS_POSTGRES = `
CREATE OR REPLACE FUNCTION stock_movement_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movement is append-only';
END;
$$;
CREATE OR REPLACE TRIGGER stock_movement_no_update BEFORE UPDATE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION stock_movement_append_only();
CREATE OR REPLACE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION stock_movement_append_only();
CREATE OR REPLACE TRIGGER stock_movement_no_truncate BEFORE TRUNCATE ON stock_movement
  FOR EACH STATEMENT EXECUTE FUNCTION stock_movement_append_only();
CREATE OR REPLACE FUNCTION cost_layer_immutable_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cost_layer unit cost / origin is immutable';
END;
$$;
CREATE OR REPLACE TRIGGER cost_layer_immutable_cost
  BEFORE UPDATE OF unit_cost, original_qty, item_id, warehouse_id ON cost_layer
  FOR EACH ROW
  WHEN (NEW.unit_cost <> OLD.unit_cost
    OR NEW.original_qty <> OLD.original_qty
    OR NEW.item_id <> OLD.item_id
    OR NEW.warehouse_id <> OLD.warehouse_id)
  EXECUTE FUNCTION cost_layer_immutable_cost();
`;

const CREATE_LATE_INDEXES = `CREATE INDEX IF NOT EXISTS idx_layer_expiry ON cost_layer(expiry_date, seq) WHERE expiry_date IS NOT NULL`;

/**
 * `batch_no` / `expiry_date` were added to both tables after they shipped;
 * CREATE TABLE IF NOT EXISTS will not widen an existing database, so add them
 * in place. Both stay NULLable: an existing layer has no batch and no expiry,
 * which is exactly the "not perishable" case FEFO must leave alone.
 *
 * The expiry index is created HERE and not in CREATE_TABLES — on a pre-existing
 * database the column does not exist until the ALTERs above have run.
 */
function addMissingColumns(sqlite: Database.Database): void {
  for (const table of ["stock_movement", "cost_layer"]) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    if (!has("batch_no")) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN batch_no TEXT`);
    if (!has("expiry_date")) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN expiry_date TEXT`);
  }
  // Value-only movements (landed costs) came later still, and only the ledger
  // carries them.
  const movementColumns = sqlite.prepare(`PRAGMA table_info(stock_movement)`).all() as { name: string }[];
  const hasMovementColumn = (name: string) => movementColumns.some((c) => c.name === name);
  if (!hasMovementColumn("value_delta")) sqlite.exec(`ALTER TABLE stock_movement ADD COLUMN value_delta INTEGER`);
  if (!hasMovementColumn("revalues_doc_id")) sqlite.exec(`ALTER TABLE stock_movement ADD COLUMN revalues_doc_id TEXT`);
  // INVARIANT: nullable and never backfilled in SQL. A row written before the
  // column reads NULL, which the domain reads as quantity × unit cost in exact
  // bigint arithmetic; multiplying the two scaled integers here would leave
  // SQLite's 64-bit range and round through a float.
  if (!hasMovementColumn("value")) sqlite.exec(`ALTER TABLE stock_movement ADD COLUMN value INTEGER`);
  sqlite.exec(CREATE_LATE_INDEXES);
}

interface MovementRow {
  id: string;
  item_id: string;
  warehouse_id: string;
  direction: string;
  qty: bigint;
  unit_cost: bigint;
  source_doc_type: string;
  source_doc_id: string;
  source_doc_number: string | null;
  reason: string | null;
  occurred_at: string;
  batch_no: string | null;
  expiry_date: string | null;
  value_delta: bigint | null;
  value: bigint | null;
  revalues_doc_id: string | null;
}

interface LayerRow {
  id: string;
  item_id: string;
  warehouse_id: string;
  unit_cost: bigint;
  original_qty: bigint;
  remaining_qty: bigint;
  source_doc_type: string;
  source_doc_id: string;
  source_doc_number: string | null;
  created_at: string;
  batch_no: string | null;
  expiry_date: string | null;
}

interface SnapshotRow {
  item_id: string;
  warehouse_id: string;
  on_hand: bigint;
  total_value: bigint;
  average_cost: bigint;
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    direction: row.direction as StockMovementDirection,
    qty: Qty.fromScaled(row.qty),
    unitCost: Money.fromScaled(row.unit_cost),
    sourceDocType: row.source_doc_type as StockSourceDocType,
    sourceDocId: row.source_doc_id,
    sourceDocNumber: row.source_doc_number,
    reason: row.reason as AdjustmentReason | null,
    occurredAt: row.occurred_at,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    valueDelta: row.value_delta === null ? null : Money.fromScaled(row.value_delta),
    value: row.value === null || row.value === undefined ? null : Money.fromScaled(row.value),
    revaluesSourceDocId: row.revalues_doc_id,
  };
}

function toLayer(row: LayerRow): CostLayer {
  return {
    id: row.id,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    unitCost: Money.fromScaled(row.unit_cost),
    originalQty: Qty.fromScaled(row.original_qty),
    remainingQty: Qty.fromScaled(row.remaining_qty),
    sourceDocType: row.source_doc_type as StockSourceDocType,
    sourceDocId: row.source_doc_id,
    sourceDocNumber: row.source_doc_number,
    createdAt: row.created_at,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
  };
}

function toSnapshot(row: SnapshotRow): WacSnapshot {
  return {
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    onHand: Qty.fromScaled(row.on_hand),
    totalValue: Money.fromScaled(row.total_value),
    averageCost: Money.fromScaled(row.average_cost),
  };
}

const MOVEMENT_COLUMNS =
  "id, item_id, warehouse_id, direction, qty, unit_cost, source_doc_type, source_doc_id, source_doc_number, reason, occurred_at, batch_no, expiry_date, value_delta, revalues_doc_id, value";

/**
 * Backing store over one connection. It does NOT `implements` the three port
 * interfaces directly — the ledger and the layers both expose a
 * `listByPosition` with a different return type — so the factory exposes
 * three typed facade objects that each bind to the right method.
 */
class SqlStockLedgerStore {
  constructor(private readonly db: SqlDb) {}

  private async movements(sql: string, params: readonly SqlValue[] = []): Promise<readonly StockMovement[]> {
    return (await this.db.all<MovementRow>(sql, params)).map(toMovement);
  }

  async append(movement: StockMovement): Promise<void> {
    await this.db.run(
      `INSERT INTO stock_movement (${MOVEMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movement.id,
        movement.itemId,
        movement.warehouseId,
        movement.direction,
        movement.qty.scaled,
        movement.unitCost.scaled,
        movement.sourceDocType,
        movement.sourceDocId,
        movement.sourceDocNumber,
        movement.reason,
        movement.occurredAt,
        movement.batchNo ?? null,
        movement.expiryDate ?? null,
        movement.valueDelta ? movement.valueDelta.scaled : null,
        movement.revaluesSourceDocId ?? null,
        movement.value ? movement.value.scaled : null,
      ],
    );
  }

  async listByPosition(itemId: string, warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement WHERE item_id = ? AND warehouse_id = ? ORDER BY occurred_at, seq`, [itemId, warehouseId]);
  }

  async latestStandingRevaluation(itemId: string, warehouseId: string): Promise<StandingStockRevaluation | null> {
    return latestStandingRevaluation(
      await this.movements(
        `SELECT * FROM stock_movement WHERE item_id = ? AND warehouse_id = ? AND value_delta IS NOT NULL AND value_delta <> 0 ORDER BY occurred_at, seq`,
        [itemId, warehouseId],
      ),
    );
  }

  async listByItem(itemId: string): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement WHERE item_id = ? ORDER BY occurred_at, seq`, [itemId]);
  }

  async listByWarehouse(warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement WHERE warehouse_id = ? ORDER BY occurred_at, seq`, [warehouseId]);
  }

  async listPositions(): Promise<readonly { itemId: string; warehouseId: string }[]> {
    const rows = await this.db.all<{ item_id: string; warehouse_id: string }>(
      `SELECT DISTINCT item_id, warehouse_id FROM stock_movement ORDER BY item_id, warehouse_id`,
    );
    return rows.map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id }));
  }

  // The ORDER BY is the contract: identical to listPositions() followed by a
  // listByPosition per position, which is what this replaces (Q-6).
  async listAllMovements(): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement ORDER BY item_id, warehouse_id, occurred_at, seq`);
  }

  async listBySourceDocType(sourceDocType: StockSourceDocType): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement WHERE source_doc_type = ? ORDER BY occurred_at, seq`, [sourceDocType]);
  }

  async listBySourceDoc(sourceDocId: string): Promise<readonly StockMovement[]> {
    return this.movements(`SELECT * FROM stock_movement WHERE source_doc_id = ? ORDER BY occurred_at, seq`, [sourceDocId]);
  }

  async add(layer: CostLayer): Promise<void> {
    await this.db.run(
      `INSERT INTO cost_layer
         (id, item_id, warehouse_id, unit_cost, original_qty, remaining_qty,
          source_doc_type, source_doc_id, source_doc_number, created_at,
          batch_no, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        layer.id,
        layer.itemId,
        layer.warehouseId,
        layer.unitCost.scaled,
        layer.originalQty.scaled,
        layer.remainingQty.scaled,
        layer.sourceDocType,
        layer.sourceDocId,
        layer.sourceDocNumber,
        layer.createdAt,
        layer.batchNo ?? null,
        layer.expiryDate ?? null,
      ],
    );
  }

  async updateRemaining(layerId: string, remainingQty: Qty): Promise<void> {
    await this.db.run(`UPDATE cost_layer SET remaining_qty = ? WHERE id = ?`, [remainingQty.scaled, layerId]);
  }

  async remove(layerId: string): Promise<void> {
    await this.db.run(`DELETE FROM cost_layer WHERE id = ?`, [layerId]);
  }

  async listLayersByPosition(itemId: string, warehouseId: string): Promise<readonly CostLayer[]> {
    return (await this.db.all<LayerRow>(`SELECT * FROM cost_layer WHERE item_id = ? AND warehouse_id = ? ORDER BY seq`, [itemId, warehouseId])).map(toLayer);
  }

  async listAllLayers(): Promise<readonly CostLayer[]> {
    return (await this.db.all<LayerRow>(`SELECT * FROM cost_layer ORDER BY item_id, warehouse_id, seq`)).map(toLayer);
  }

  async get(itemId: string, warehouseId: string): Promise<WacSnapshot | null> {
    const row = await this.db.get<SnapshotRow>(`SELECT * FROM wac_snapshot WHERE item_id = ? AND warehouse_id = ?`, [itemId, warehouseId]);
    return row ? toSnapshot(row) : null;
  }

  async save(snapshot: WacSnapshot): Promise<void> {
    await this.db.run(
      `INSERT INTO wac_snapshot (item_id, warehouse_id, on_hand, total_value, average_cost)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, warehouse_id) DO UPDATE SET
         on_hand = excluded.on_hand,
         total_value = excluded.total_value,
         average_cost = excluded.average_cost`,
      [snapshot.itemId, snapshot.warehouseId, snapshot.onHand.scaled, snapshot.totalValue.scaled, snapshot.averageCost.scaled],
    );
  }

  async list(): Promise<readonly WacSnapshot[]> {
    return (await this.db.all<SnapshotRow>(`SELECT * FROM wac_snapshot ORDER BY item_id, warehouse_id`)).map(toSnapshot);
  }
}

/**
 * The three repository views are the SAME object (one connection); the store's
 * `layers.listByPosition` needs a distinct name from the ledger's, so this
 * facade wires each port to the right method.
 */
export interface StockLedgerHandle {
  readonly ledger: StockLedgerRepository;
  readonly layers: CostLayerRepository;
  readonly snapshots: WacSnapshotRepository;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface SqliteStockLedgerHandle extends StockLedgerHandle {
  close(): void;
}

export async function ensureStockLedgerSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  await db.applySchema(CREATE_LATE_INDEXES);
  if (db.dialect === SqlDialect.Postgres) await db.exec(CREATE_TRIGGERS_POSTGRES);
}

export function createStockLedgerStore(db: SqlDb): StockLedgerHandle {
  const store = new SqlStockLedgerStore(db);

  const ledger: StockLedgerRepository = {
    append: (m) => store.append(m),
    listByPosition: (i, w) => store.listByPosition(i, w),
    listByItem: (i) => store.listByItem(i),
    listByWarehouse: (w) => store.listByWarehouse(w),
    listPositions: () => store.listPositions(),
    listBySourceDocType: (t) => store.listBySourceDocType(t),
    listBySourceDoc: (id) => store.listBySourceDoc(id),
    listAll: () => store.listAllMovements(),
  };
  const layers: CostLayerRepository = {
    add: (l) => store.add(l),
    listByPosition: (i, w) => store.listLayersByPosition(i, w),
    updateRemaining: (id, q) => store.updateRemaining(id, q),
    remove: (id) => store.remove(id),
    listAll: () => store.listAllLayers(),
  };
  const snapshots: WacSnapshotRepository = {
    get: (i, w) => store.get(i, w),
    save: (s) => store.save(s),
    list: () => store.list(),
  };

  return {
    ledger,
    layers,
    snapshots,
    transaction: (fn) => db.transaction(fn),
  };
}

export function createSqliteStockLedgerStore(path: SqliteConnectionInput = ":memory:"): SqliteStockLedgerHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  sqlite.exec(CREATE_TRIGGERS);
  addMissingColumns(sqlite);
  return { ...createStockLedgerStore(sqliteDb(sqlite)), close: () => { if (owned) sqlite.close(); } };
}
