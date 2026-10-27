import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  MAIN_WAREHOUSE_TYPE,
  Qty,
  evaluateLowStockCrossing,
  itemTypeTracksStock,
  resolveLowStockThreshold,
  type ItemType,
  type ItemWarehousePolicy,
  type ItemWarehousePolicyRepository,
} from "@mezan/domain";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS item_warehouse_policy (
  item_id       TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL,
  min_qty       INTEGER NOT NULL,
  max_qty       INTEGER NOT NULL,
  lead_days     INTEGER NOT NULL,
  pack_qty      INTEGER NOT NULL,
  supplier_id   TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  PRIMARY KEY (item_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_item_warehouse_policy_warehouse ON item_warehouse_policy(warehouse_id);

CREATE TABLE IF NOT EXISTS reorder_alert_state (
  item_id       TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL,
  armed         INTEGER NOT NULL,
  changed_at    TEXT NOT NULL,
  PRIMARY KEY (item_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS reorder_alert_outbox (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT NOT NULL UNIQUE,
  item_id       TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL,
  on_hand       INTEGER NOT NULL,
  threshold     INTEGER NOT NULL,
  detected_at   TEXT NOT NULL,
  published_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_reorder_alert_outbox_pending ON reorder_alert_outbox(published_at);
`;

interface PolicyRow {
  item_id: string;
  warehouse_id: string;
  min_qty: bigint;
  max_qty: bigint;
  lead_days: bigint;
  pack_qty: bigint;
  supplier_id: string | null;
  updated_at: string;
  updated_by: string;
}

function toPolicy(row: PolicyRow): ItemWarehousePolicy {
  return {
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    minQty: Qty.fromScaled(row.min_qty),
    maxQty: Qty.fromScaled(row.max_qty),
    leadDays: Number(row.lead_days),
    packQty: Qty.fromScaled(row.pack_qty),
    supplierId: row.supplier_id,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

class SqlPolicyRepository implements ItemWarehousePolicyRepository {
  constructor(private readonly db: SqlDb) {}

  async get(itemId: string, warehouseId: string): Promise<ItemWarehousePolicy | null> {
    const row = await this.db.get<PolicyRow>(`SELECT * FROM item_warehouse_policy WHERE item_id = ? AND warehouse_id = ?`, [itemId, warehouseId]);
    return row ? toPolicy(row) : null;
  }

  async list(): Promise<readonly ItemWarehousePolicy[]> {
    return (await this.db.all<PolicyRow>(`SELECT * FROM item_warehouse_policy ORDER BY item_id, warehouse_id`)).map(toPolicy);
  }

  async save(policy: ItemWarehousePolicy): Promise<void> {
    await this.db.run(
      `INSERT INTO item_warehouse_policy (item_id, warehouse_id, min_qty, max_qty, lead_days, pack_qty, supplier_id, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, warehouse_id) DO UPDATE SET
         min_qty = excluded.min_qty, max_qty = excluded.max_qty, lead_days = excluded.lead_days, pack_qty = excluded.pack_qty,
         supplier_id = excluded.supplier_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [
        policy.itemId,
        policy.warehouseId,
        policy.minQty.scaled,
        policy.maxQty.scaled,
        policy.leadDays,
        policy.packQty.scaled,
        policy.supplierId,
        policy.updatedAt,
        policy.updatedBy,
      ],
    );
    await this.db.run(`DELETE FROM reorder_alert_state WHERE item_id = ? AND warehouse_id = ?`, [policy.itemId, policy.warehouseId]);
  }

  async remove(itemId: string, warehouseId: string): Promise<void> {
    await this.db.run(`DELETE FROM item_warehouse_policy WHERE item_id = ? AND warehouse_id = ?`, [itemId, warehouseId]);
    await this.db.run(`DELETE FROM reorder_alert_state WHERE item_id = ? AND warehouse_id = ?`, [itemId, warehouseId]);
  }
}

export interface LowStockAlert {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemNameAr: string | null;
  readonly itemNameEn: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string | null;
  readonly branchId: string | null;
  readonly onHand: Qty;
  readonly threshold: Qty;
  readonly detectedAt: string;
}

export interface LowStockMove {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHandAfter: Qty;
  readonly at: string;
  readonly alertId: string;
}

interface AlertRow {
  id: string;
  item_id: string;
  item_code: string | null;
  item_name_ar: string | null;
  item_name_en: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  branch_id: string | null;
  on_hand: bigint;
  threshold: bigint;
  detected_at: string;
}

export interface LowStockMonitor {
  recordMove(move: LowStockMove): Promise<void>;
  pending(): Promise<readonly LowStockAlert[]>;
  markPublished(id: string, at: string): Promise<void>;
}

export function createLowStockMonitor(db: SqlDb): LowStockMonitor {
  async function thresholdFor(itemId: string, warehouseId: string): Promise<Qty | null> {
    const policy = await db.get<{ min_qty: bigint }>(`SELECT min_qty FROM item_warehouse_policy WHERE item_id = ? AND warehouse_id = ?`, [itemId, warehouseId]);
    if (policy) return Qty.fromScaled(policy.min_qty);
    const item = await db.get<{ type: string; track_inventory: bigint; reorder_point: number | null }>(
      `SELECT type, track_inventory, reorder_point FROM item WHERE id = ?`,
      [itemId],
    );
    if (!item || Number(item.track_inventory) !== 1 || !itemTypeTracksStock(item.type as ItemType)) return null;
    const warehouse = await db.get<{ type: string }>(`SELECT type FROM warehouse WHERE id = ?`, [warehouseId]);
    if (!warehouse || warehouse.type !== MAIN_WAREHOUSE_TYPE) return null;
    return resolveLowStockThreshold(null, { reorderPoint: item.reorder_point });
  }

  return {
    async recordMove(move) {
      const threshold = await thresholdFor(move.itemId, move.warehouseId);
      const stored = await db.get<{ armed: bigint }>(`SELECT armed FROM reorder_alert_state WHERE item_id = ? AND warehouse_id = ?`, [move.itemId, move.warehouseId]);
      if (threshold === null) {
        if (stored) await db.run(`DELETE FROM reorder_alert_state WHERE item_id = ? AND warehouse_id = ?`, [move.itemId, move.warehouseId]);
        return;
      }
      const wasArmed = stored ? Number(stored.armed) === 1 : true;
      const crossing = evaluateLowStockCrossing({ armed: wasArmed, onHandAfter: move.onHandAfter, threshold });
      if (crossing.armed !== wasArmed) {
        await db.run(
          `INSERT INTO reorder_alert_state (item_id, warehouse_id, armed, changed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(item_id, warehouse_id) DO UPDATE SET armed = excluded.armed, changed_at = excluded.changed_at`,
          [move.itemId, move.warehouseId, crossing.armed ? 1 : 0, move.at],
        );
      }
      if (crossing.fire) {
        await db.run(
          `INSERT INTO reorder_alert_outbox (id, item_id, warehouse_id, on_hand, threshold, detected_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [move.alertId, move.itemId, move.warehouseId, move.onHandAfter.scaled, threshold.scaled, move.at],
        );
      }
    },
    async pending() {
      const rows = await db.all<AlertRow>(
        `SELECT o.id AS id, o.item_id AS item_id, i.code AS item_code, i.name_ar AS item_name_ar, i.name_en AS item_name_en,
                o.warehouse_id AS warehouse_id, w.name AS warehouse_name, w.branch_id AS branch_id,
                o.on_hand AS on_hand, o.threshold AS threshold, o.detected_at AS detected_at
           FROM reorder_alert_outbox o
           LEFT JOIN item i ON i.id = o.item_id
           LEFT JOIN warehouse w ON w.id = o.warehouse_id
          WHERE o.published_at IS NULL ORDER BY o.seq LIMIT 200`,
      );
      return rows.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        itemCode: row.item_code,
        itemNameAr: row.item_name_ar,
        itemNameEn: row.item_name_en,
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        branchId: row.branch_id,
        onHand: Qty.fromScaled(row.on_hand),
        threshold: Qty.fromScaled(row.threshold),
        detectedAt: row.detected_at,
      }));
    },
    async markPublished(id, at) {
      await db.run(`UPDATE reorder_alert_outbox SET published_at = ? WHERE id = ?`, [at, id]);
    },
  };
}

export interface ReorderStoreHandle {
  readonly policies: ItemWarehousePolicyRepository;
  readonly lowStock: LowStockMonitor;
}

export interface SqliteReorderStoreHandle extends ReorderStoreHandle {
  close(): void;
}

export async function ensureReorderSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createReorderStore(db: SqlDb): ReorderStoreHandle {
  return { policies: new SqlPolicyRepository(db), lowStock: createLowStockMonitor(db) };
}

export function createSqliteReorderStore(path: SqliteConnectionInput = ":memory:"): SqliteReorderStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return Object.assign(createReorderStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  });
}
