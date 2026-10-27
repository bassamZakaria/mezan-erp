import type Database from "better-sqlite3";
import {
  ItemStatusCode,
  Qty,
  type CountableItem,
  type CountItemDirectory,
  type CountModeRepository,
  type CountScan,
  type CountScanOutcome,
  type CountScanSource,
  type CountScanVoidReason,
  type CountZone,
  type CountZoneKind,
  type CountZoneStatus,
} from "@mezan/domain";
import { refuseUnlessInserted } from "./insert-new.js";
import { SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS physical_count_zone (
  id               TEXT PRIMARY KEY,
  count_id         TEXT NOT NULL,
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  category_id      TEXT,
  item_ids_json    TEXT NOT NULL,
  counter_ids_json TEXT NOT NULL,
  status           TEXT NOT NULL,
  submitted_at     TEXT,
  submitted_by     TEXT,
  approved_at      TEXT,
  approved_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_count_zone_count ON physical_count_zone(count_id, position);

CREATE TABLE IF NOT EXISTS physical_count_scan (
  id           TEXT PRIMARY KEY,
  count_id     TEXT NOT NULL,
  zone_id      TEXT,
  item_id      TEXT,
  barcode      TEXT,
  outcome      TEXT NOT NULL,
  source       TEXT NOT NULL,
  qty          TEXT NOT NULL,
  entered_qty  TEXT,
  unit_code    TEXT,
  user_id      TEXT NOT NULL,
  scanned_at   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  client_key   TEXT,
  voided_at    TEXT,
  voided_by    TEXT,
  void_reason  TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_count_scan_item ON physical_count_scan(count_id, item_id);
CREATE INDEX IF NOT EXISTS idx_physical_count_scan_zone ON physical_count_scan(count_id, zone_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_physical_count_scan_key ON physical_count_scan(count_id, client_key) WHERE client_key IS NOT NULL;
`;

const CREATE_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS physical_count_scan_no_delete
BEFORE DELETE ON physical_count_scan
BEGIN
  SELECT RAISE(ABORT, 'physical_count_scan is append-only');
END;

CREATE TRIGGER IF NOT EXISTS physical_count_scan_void_only
BEFORE UPDATE ON physical_count_scan
WHEN OLD.voided_at IS NOT NULL
  OR NEW.id IS NOT OLD.id OR NEW.count_id IS NOT OLD.count_id OR NEW.zone_id IS NOT OLD.zone_id
  OR NEW.item_id IS NOT OLD.item_id OR NEW.barcode IS NOT OLD.barcode OR NEW.outcome IS NOT OLD.outcome
  OR NEW.source IS NOT OLD.source OR NEW.qty IS NOT OLD.qty OR NEW.entered_qty IS NOT OLD.entered_qty
  OR NEW.unit_code IS NOT OLD.unit_code OR NEW.user_id IS NOT OLD.user_id OR NEW.scanned_at IS NOT OLD.scanned_at
  OR NEW.seq IS NOT OLD.seq OR NEW.client_key IS NOT OLD.client_key OR NEW.note IS NOT OLD.note
BEGIN
  SELECT RAISE(ABORT, 'physical_count_scan is append-only: a scan can only be voided');
END;
`;

const CREATE_TRIGGERS_POSTGRES = `
CREATE OR REPLACE FUNCTION physical_count_scan_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'physical_count_scan is append-only';
END;
$$;
CREATE OR REPLACE TRIGGER physical_count_scan_no_delete BEFORE DELETE ON physical_count_scan
  FOR EACH ROW EXECUTE FUNCTION physical_count_scan_no_delete();
CREATE OR REPLACE FUNCTION physical_count_scan_void_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'physical_count_scan is append-only: a scan can only be voided';
END;
$$;
CREATE OR REPLACE TRIGGER physical_count_scan_void_only BEFORE UPDATE ON physical_count_scan
  FOR EACH ROW
  WHEN (OLD.voided_at IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.count_id IS DISTINCT FROM OLD.count_id OR NEW.zone_id IS DISTINCT FROM OLD.zone_id
    OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.barcode IS DISTINCT FROM OLD.barcode OR NEW.outcome IS DISTINCT FROM OLD.outcome
    OR NEW.source IS DISTINCT FROM OLD.source OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.entered_qty IS DISTINCT FROM OLD.entered_qty
    OR NEW.unit_code IS DISTINCT FROM OLD.unit_code OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at
    OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.client_key IS DISTINCT FROM OLD.client_key OR NEW.note IS DISTINCT FROM OLD.note)
  EXECUTE FUNCTION physical_count_scan_void_only();
`;

function jsonArrayContains(db: SqlDb, column: string): string {
  return db.dialect === SqlDialect.Postgres
    ? `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${column}::jsonb) AS element(value) WHERE element.value = ?)`
    : `EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ?)`;
}

interface ZoneRow {
  id: string;
  count_id: string;
  position: bigint;
  name: string;
  kind: string;
  category_id: string | null;
  item_ids_json: string;
  counter_ids_json: string;
  status: string;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

interface ScanRow {
  id: string;
  count_id: string;
  zone_id: string | null;
  item_id: string | null;
  barcode: string | null;
  outcome: string;
  source: string;
  qty: string;
  entered_qty: string | null;
  unit_code: string | null;
  user_id: string;
  scanned_at: string;
  seq: bigint;
  client_key: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  note: string | null;
}

function zoneFromRow(row: ZoneRow): CountZone {
  return {
    id: row.id,
    countId: row.count_id,
    name: row.name,
    kind: row.kind as CountZoneKind,
    categoryId: row.category_id,
    itemIds: JSON.parse(row.item_ids_json) as string[],
    counterUserIds: JSON.parse(row.counter_ids_json) as string[],
    status: row.status as CountZoneStatus,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

function scanFromRow(row: ScanRow): CountScan {
  return {
    id: row.id,
    countId: row.count_id,
    zoneId: row.zone_id,
    itemId: row.item_id,
    barcode: row.barcode,
    outcome: row.outcome as CountScanOutcome,
    source: row.source as CountScanSource,
    qty: Qty.fromMajor(row.qty),
    enteredQty: row.entered_qty === null ? null : Qty.fromMajor(row.entered_qty),
    unitCode: row.unit_code,
    userId: row.user_id,
    scannedAt: row.scanned_at,
    clientKey: row.client_key,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason as CountScanVoidReason | null,
    note: row.note,
  };
}

class SqlCountModeStore implements CountModeRepository {
  constructor(private readonly db: SqlDb) {}

  async saveZones(zones: readonly CountZone[]): Promise<void> {
    for (const [position, zone] of zones.entries()) {
      const inserted = await this.db.run(
        `INSERT INTO physical_count_zone
           (id, count_id, position, name, kind, category_id, item_ids_json, counter_ids_json, status, submitted_at, submitted_by, approved_at, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [
          zone.id,
          zone.countId,
          position,
          zone.name,
          zone.kind,
          zone.categoryId,
          JSON.stringify(zone.itemIds),
          JSON.stringify(zone.counterUserIds),
          zone.status,
          zone.submittedAt,
          zone.submittedBy,
          zone.approvedAt,
          zone.approvedBy,
        ],
      );
      refuseUnlessInserted(zone.id, inserted.changes);
    }
  }

  async updateZone(zone: CountZone): Promise<void> {
    await this.db.run(
      `UPDATE physical_count_zone SET
         status = ?, submitted_at = ?, submitted_by = ?,
         approved_at = ?, approved_by = ?
       WHERE id = ? AND count_id = ?`,
      [zone.status, zone.submittedAt, zone.submittedBy, zone.approvedAt, zone.approvedBy, zone.id, zone.countId],
    );
  }

  async listZones(countId: string): Promise<readonly CountZone[]> {
    const rows = await this.db.all<ZoneRow>(`SELECT * FROM physical_count_zone WHERE count_id = ? ORDER BY position`, [countId]);
    return rows.map(zoneFromRow);
  }

  async findZone(countId: string, zoneId: string): Promise<CountZone | null> {
    const row = await this.db.get<ZoneRow>(`SELECT * FROM physical_count_zone WHERE count_id = ? AND id = ?`, [countId, zoneId]);
    return row ? zoneFromRow(row) : null;
  }

  async zonesOfCounter(userId: string): Promise<readonly CountZone[]> {
    const rows = await this.db.all<ZoneRow>(
      `SELECT z.* FROM physical_count_zone z
       WHERE ${jsonArrayContains(this.db, "z.counter_ids_json")}
       ORDER BY z.count_id, z.position`,
      [userId],
    );
    return rows.map(zoneFromRow);
  }

  async appendScan(scan: CountScan): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO physical_count_scan
         (id, count_id, zone_id, item_id, barcode, outcome, source, qty, entered_qty, unit_code, user_id, scanned_at, seq, client_key, voided_at, voided_by, void_reason, note)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          (SELECT COALESCE(MAX(seq), 0) + 1 FROM physical_count_scan WHERE count_id = ?),
          ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        scan.id,
        scan.countId,
        scan.zoneId,
        scan.itemId,
        scan.barcode,
        scan.outcome,
        scan.source,
        scan.qty.toString(),
        scan.enteredQty ? scan.enteredQty.toString() : null,
        scan.unitCode,
        scan.userId,
        scan.scannedAt,
        scan.countId,
        scan.clientKey,
        scan.voidedAt,
        scan.voidedBy,
        scan.voidReason,
        scan.note,
      ],
    );
    refuseUnlessInserted(scan.id, inserted.changes);
  }

  async findScan(countId: string, scanId: string): Promise<CountScan | null> {
    const row = await this.db.get<ScanRow>(`SELECT * FROM physical_count_scan WHERE count_id = ? AND id = ?`, [countId, scanId]);
    return row ? scanFromRow(row) : null;
  }

  async findScanByClientKey(countId: string, clientKey: string): Promise<CountScan | null> {
    const row = await this.db.get<ScanRow>(`SELECT * FROM physical_count_scan WHERE count_id = ? AND client_key = ?`, [countId, clientKey]);
    return row ? scanFromRow(row) : null;
  }

  async voidScans(countId: string, scanIds: readonly string[], by: string, reason: CountScanVoidReason, at: string): Promise<void> {
    for (const id of scanIds) {
      await this.db.run(
        `UPDATE physical_count_scan SET voided_at = ?, voided_by = ?, void_reason = ?
         WHERE count_id = ? AND id = ? AND voided_at IS NULL`,
        [at, by, reason, countId, id],
      );
    }
  }

  async listScans(countId: string, filter: { readonly zoneId?: string; readonly itemId?: string; readonly userId?: string } = {}): Promise<readonly CountScan[]> {
    const clauses = ["count_id = ?"];
    const params: SqlValue[] = [countId];
    if (filter.zoneId) {
      clauses.push("zone_id = ?");
      params.push(filter.zoneId);
    }
    if (filter.itemId) {
      clauses.push("item_id = ?");
      params.push(filter.itemId);
    }
    if (filter.userId) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    const rows = await this.db.all<ScanRow>(`SELECT * FROM physical_count_scan WHERE ${clauses.join(" AND ")} ORDER BY seq`, params);
    return rows.map(scanFromRow);
  }
}

export async function ensureCountModeSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  if (db.dialect === SqlDialect.Postgres) await db.exec(CREATE_TRIGGERS_POSTGRES);
}

export function createCountModeStore(db: SqlDb): CountModeRepository {
  return new SqlCountModeStore(db);
}

export function createSqliteCountModeStore(sqlite: Database.Database): CountModeRepository {
  sqlite.exec(CREATE_TABLES);
  sqlite.exec(CREATE_TRIGGERS);
  return createCountModeStore(sqliteDb(sqlite));
}

interface CountableItemRow {
  id: string;
  code: string;
  base_unit_code: string;
  alternate_units: string;
  barcodes: string;
}

interface CategoryRow {
  id: string;
  parent_id: string | null;
}

function itemFromRow(row: CountableItemRow): CountableItem {
  return {
    id: row.id,
    code: row.code,
    baseUnitCode: row.base_unit_code,
    alternateUnits: JSON.parse(row.alternate_units) as { code: string; factor: number }[],
    barcodes: JSON.parse(row.barcodes) as string[],
  };
}

/**
 * Barcode resolution for a count: an exact match on the item's stored
 * barcodes, then the item code (printed shelf labels encode it). Only
 * inventory-tracked items that are not inactive are countable.
 */
export function createCountItemDirectory(db: SqlDb): CountItemDirectory {
  const columns = `id, code, base_unit_code, alternate_units, barcodes`;
  const countable = `track_inventory = 1 AND status <> '${ItemStatusCode.Inactive}'`;
  return {
    async findByBarcode(code) {
      const trimmed = code.trim();
      if (trimmed === "") return null;
      const byBarcode = await db.get<CountableItemRow>(
        `SELECT ${columns} FROM item WHERE ${countable} AND ${jsonArrayContains(db, "item.barcodes")} LIMIT 1`,
        [trimmed],
      );
      if (byBarcode) return itemFromRow(byBarcode);
      const byCode = await db.get<CountableItemRow>(`SELECT ${columns} FROM item WHERE ${countable} AND code = ? LIMIT 1`, [trimmed]);
      return byCode ? itemFromRow(byCode) : null;
    },
    async findById(id) {
      const row = await db.get<CountableItemRow>(`SELECT ${columns} FROM item WHERE id = ?`, [id]);
      return row ? itemFromRow(row) : null;
    },
    async itemsInCategory(categoryId) {
      const categories = await db.all<CategoryRow>(`SELECT id, parent_id FROM item_category`);
      const inTree = new Set<string>([categoryId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const category of categories) {
          if (category.parent_id !== null && inTree.has(category.parent_id) && !inTree.has(category.id)) {
            inTree.add(category.id);
            grew = true;
          }
        }
      }
      const rows = await db.all<{ id: string; category_id: string | null }>(`SELECT id, category_id FROM item WHERE ${countable} ORDER BY code`);
      return rows.filter((r) => r.category_id !== null && inTree.has(r.category_id)).map((r) => r.id);
    },
  };
}

/**
 * Barcode resolution for a count: an exact match on the item's stored
 * barcodes, then the item code (printed shelf labels encode it). Only
 * inventory-tracked items that are not inactive are countable.
 */
export function createSqliteCountItemDirectory(sqlite: Database.Database): CountItemDirectory {
  return createCountItemDirectory(sqliteDb(sqlite));
}
