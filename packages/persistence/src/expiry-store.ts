import type Database from "better-sqlite3";
import {
  DEFAULT_NEAR_EXPIRY_DAYS,
  Qty,
  type BatchTrailEntry,
  type BatchTrailRepository,
  type ExpiryAlertKind,
  type ExpiryAlertRecord,
  type ExpirySettings,
  type ExpiryStore,
  type StockSourceDocType,
} from "@mezan/domain";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stock_batch_trail (
  seq               INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id       TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  source_doc_type   TEXT NOT NULL,
  source_doc_id     TEXT NOT NULL,
  source_doc_number TEXT,
  batch_no          TEXT,
  expiry_date       TEXT,
  qty               TEXT NOT NULL,
  occurred_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_batch_trail_doc ON stock_batch_trail (source_doc_id);
CREATE INDEX IF NOT EXISTS stock_batch_trail_batch ON stock_batch_trail (batch_no, item_id);
CREATE TABLE IF NOT EXISTS expiry_settings (
  id                TEXT PRIMARY KEY CHECK (id = 'default'),
  near_expiry_days  INTEGER NOT NULL,
  updated_at        TEXT,
  updated_by        TEXT
);
CREATE TABLE IF NOT EXISTS expiry_alert_log (
  layer_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL,
  batch_no      TEXT,
  expiry_date   TEXT NOT NULL,
  qty           TEXT NOT NULL,
  emitted_at    TEXT NOT NULL,
  PRIMARY KEY (layer_id, kind)
);
CREATE INDEX IF NOT EXISTS expiry_alert_log_emitted ON expiry_alert_log (emitted_at);
CREATE TABLE IF NOT EXISTS expiry_flags (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface TrailRow {
  readonly movement_id: string;
  readonly item_id: string;
  readonly warehouse_id: string;
  readonly source_doc_type: string;
  readonly source_doc_id: string;
  readonly source_doc_number: string | null;
  readonly batch_no: string | null;
  readonly expiry_date: string | null;
  readonly qty: string;
  readonly occurred_at: string;
}

function trailFromRow(row: TrailRow): BatchTrailEntry {
  return {
    movementId: row.movement_id,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    sourceDocType: row.source_doc_type as StockSourceDocType,
    sourceDocId: row.source_doc_id,
    sourceDocNumber: row.source_doc_number,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    qty: Qty.fromMajor(row.qty),
    occurredAt: row.occurred_at,
  };
}

interface AlertRow {
  readonly layer_id: string;
  readonly kind: string;
  readonly item_id: string;
  readonly warehouse_id: string;
  readonly batch_no: string | null;
  readonly expiry_date: string;
  readonly qty: string;
  readonly emitted_at: string;
}

function alertFromRow(row: AlertRow): ExpiryAlertRecord {
  return {
    layerId: row.layer_id,
    kind: row.kind as ExpiryAlertKind,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    qty: row.qty,
    emittedAt: row.emitted_at,
  };
}

export function createSqliteBatchTrailStore(sqlite: Database.Database): BatchTrailRepository {
  sqlite.exec(SCHEMA);
  const insert = sqlite.prepare(
    `INSERT INTO stock_batch_trail
       (movement_id, item_id, warehouse_id, source_doc_type, source_doc_id, source_doc_number, batch_no, expiry_date, qty, occurred_at)
     VALUES (@movementId, @itemId, @warehouseId, @sourceDocType, @sourceDocId, @sourceDocNumber, @batchNo, @expiryDate, @qty, @occurredAt)`,
  );
  const byDoc = sqlite.prepare(`SELECT * FROM stock_batch_trail WHERE source_doc_id = ? ORDER BY seq`);
  const byBatch = sqlite.prepare(`SELECT * FROM stock_batch_trail WHERE batch_no = ? ORDER BY occurred_at, seq`);
  const byBatchItem = sqlite.prepare(`SELECT * FROM stock_batch_trail WHERE batch_no = ? AND item_id = ? ORDER BY occurred_at, seq`);
  return {
    async record(entries) {
      for (const e of entries) {
        insert.run({
          movementId: e.movementId,
          itemId: e.itemId,
          warehouseId: e.warehouseId,
          sourceDocType: e.sourceDocType,
          sourceDocId: e.sourceDocId,
          sourceDocNumber: e.sourceDocNumber,
          batchNo: e.batchNo,
          expiryDate: e.expiryDate,
          qty: e.qty.toString(),
          occurredAt: e.occurredAt,
        });
      }
    },
    async listBySourceDoc(sourceDocId) {
      return (byDoc.all(sourceDocId) as TrailRow[]).map(trailFromRow);
    },
    async listByBatch(batchNo, itemId) {
      const rows = (itemId ? byBatchItem.all(batchNo, itemId) : byBatch.all(batchNo)) as TrailRow[];
      return rows.map(trailFromRow);
    },
  };
}

export function createSqliteExpiryStore(sqlite: Database.Database): ExpiryStore {
  sqlite.exec(SCHEMA);
  const selectSettings = sqlite.prepare(`SELECT near_expiry_days, updated_at, updated_by FROM expiry_settings WHERE id = 'default'`);
  const upsertSettings = sqlite.prepare(
    `INSERT INTO expiry_settings (id, near_expiry_days, updated_at, updated_by) VALUES ('default', @days, @updatedAt, @updatedBy)
     ON CONFLICT(id) DO UPDATE SET near_expiry_days = @days, updated_at = @updatedAt, updated_by = @updatedBy`,
  );
  const selectAlert = sqlite.prepare(`SELECT 1 FROM expiry_alert_log WHERE layer_id = ? AND kind = ?`);
  const insertAlert = sqlite.prepare(
    `INSERT OR IGNORE INTO expiry_alert_log (layer_id, kind, item_id, warehouse_id, batch_no, expiry_date, qty, emitted_at)
     VALUES (@layerId, @kind, @itemId, @warehouseId, @batchNo, @expiryDate, @qty, @emittedAt)`,
  );
  const selectAlerts = sqlite.prepare(`SELECT * FROM expiry_alert_log ORDER BY emitted_at DESC, expiry_date LIMIT ?`);
  const selectFlag = sqlite.prepare(`SELECT value FROM expiry_flags WHERE key = ?`);
  const upsertFlag = sqlite.prepare(
    `INSERT INTO expiry_flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  return {
    async getSettings(): Promise<ExpirySettings> {
      const row = selectSettings.get() as { near_expiry_days: number; updated_at: string | null; updated_by: string | null } | undefined;
      if (!row) return { nearExpiryDays: DEFAULT_NEAR_EXPIRY_DAYS, updatedAt: null, updatedBy: null };
      return { nearExpiryDays: row.near_expiry_days, updatedAt: row.updated_at, updatedBy: row.updated_by };
    },
    async saveSettings(settings) {
      upsertSettings.run({ days: settings.nearExpiryDays, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy });
    },
    async hasAlert(layerId, kind) {
      return selectAlert.get(layerId, kind) !== undefined;
    },
    async recordAlert(alert) {
      return insertAlert.run(alert).changes > 0;
    },
    async listAlerts(limit) {
      return (selectAlerts.all(limit) as AlertRow[]).map(alertFromRow);
    },
    async getFlag(key) {
      const row = selectFlag.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
    async setFlag(key, value) {
      upsertFlag.run(key, value);
    },
  };
}
