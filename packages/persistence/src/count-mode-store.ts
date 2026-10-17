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
import { insertingNew } from "./insert-new.js";

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

interface ZoneRow {
  id: string;
  count_id: string;
  position: number;
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
  seq: number;
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

class SqliteCountModeStore implements CountModeRepository {
  private readonly insertZone: Database.Statement;
  private readonly updateZoneStmt: Database.Statement;
  private readonly insertScan: Database.Statement;
  private readonly voidStmt: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    sqlite.exec(CREATE_TABLES);
    this.insertZone = sqlite.prepare(`
      INSERT INTO physical_count_zone
        (id, count_id, position, name, kind, category_id, item_ids_json, counter_ids_json, status, submitted_at, submitted_by, approved_at, approved_by)
      VALUES
        (@id, @count_id, @position, @name, @kind, @category_id, @item_ids_json, @counter_ids_json, @status, @submitted_at, @submitted_by, @approved_at, @approved_by)
    `);
    this.updateZoneStmt = sqlite.prepare(`
      UPDATE physical_count_zone SET
        status = @status, submitted_at = @submitted_at, submitted_by = @submitted_by,
        approved_at = @approved_at, approved_by = @approved_by
      WHERE id = @id AND count_id = @count_id
    `);
    this.insertScan = sqlite.prepare(`
      INSERT INTO physical_count_scan
        (id, count_id, zone_id, item_id, barcode, outcome, source, qty, entered_qty, unit_code, user_id, scanned_at, seq, client_key, voided_at, voided_by, void_reason, note)
      VALUES
        (@id, @count_id, @zone_id, @item_id, @barcode, @outcome, @source, @qty, @entered_qty, @unit_code, @user_id, @scanned_at,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM physical_count_scan WHERE count_id = @count_id),
         @client_key, @voided_at, @voided_by, @void_reason, @note)
    `);
    this.voidStmt = sqlite.prepare(`
      UPDATE physical_count_scan SET voided_at = ?, voided_by = ?, void_reason = ?
      WHERE count_id = ? AND id = ? AND voided_at IS NULL
    `);
  }

  async saveZones(zones: readonly CountZone[]): Promise<void> {
    zones.forEach((zone, position) => {
      insertingNew(zone.id, () =>
        this.insertZone.run({
          id: zone.id,
          count_id: zone.countId,
          position,
          name: zone.name,
          kind: zone.kind,
          category_id: zone.categoryId,
          item_ids_json: JSON.stringify(zone.itemIds),
          counter_ids_json: JSON.stringify(zone.counterUserIds),
          status: zone.status,
          submitted_at: zone.submittedAt,
          submitted_by: zone.submittedBy,
          approved_at: zone.approvedAt,
          approved_by: zone.approvedBy,
        }),
      );
    });
  }

  async updateZone(zone: CountZone): Promise<void> {
    this.updateZoneStmt.run({
      id: zone.id,
      count_id: zone.countId,
      status: zone.status,
      submitted_at: zone.submittedAt,
      submitted_by: zone.submittedBy,
      approved_at: zone.approvedAt,
      approved_by: zone.approvedBy,
    });
  }

  async listZones(countId: string): Promise<readonly CountZone[]> {
    const rows = this.sqlite.prepare(`SELECT * FROM physical_count_zone WHERE count_id = ? ORDER BY position`).all(countId) as ZoneRow[];
    return rows.map(zoneFromRow);
  }

  async findZone(countId: string, zoneId: string): Promise<CountZone | null> {
    const row = this.sqlite.prepare(`SELECT * FROM physical_count_zone WHERE count_id = ? AND id = ?`).get(countId, zoneId) as ZoneRow | undefined;
    return row ? zoneFromRow(row) : null;
  }

  async zonesOfCounter(userId: string): Promise<readonly CountZone[]> {
    const rows = this.sqlite
      .prepare(
        `SELECT z.* FROM physical_count_zone z
         WHERE EXISTS (SELECT 1 FROM json_each(z.counter_ids_json) WHERE value = ?)
         ORDER BY z.count_id, z.position`,
      )
      .all(userId) as ZoneRow[];
    return rows.map(zoneFromRow);
  }

  async appendScan(scan: CountScan): Promise<void> {
    insertingNew(scan.id, () =>
      this.insertScan.run({
        id: scan.id,
        count_id: scan.countId,
        zone_id: scan.zoneId,
        item_id: scan.itemId,
        barcode: scan.barcode,
        outcome: scan.outcome,
        source: scan.source,
        qty: scan.qty.toString(),
        entered_qty: scan.enteredQty ? scan.enteredQty.toString() : null,
        unit_code: scan.unitCode,
        user_id: scan.userId,
        scanned_at: scan.scannedAt,
        client_key: scan.clientKey,
        voided_at: scan.voidedAt,
        voided_by: scan.voidedBy,
        void_reason: scan.voidReason,
        note: scan.note,
      }),
    );
  }

  async findScan(countId: string, scanId: string): Promise<CountScan | null> {
    const row = this.sqlite.prepare(`SELECT * FROM physical_count_scan WHERE count_id = ? AND id = ?`).get(countId, scanId) as ScanRow | undefined;
    return row ? scanFromRow(row) : null;
  }

  async findScanByClientKey(countId: string, clientKey: string): Promise<CountScan | null> {
    const row = this.sqlite.prepare(`SELECT * FROM physical_count_scan WHERE count_id = ? AND client_key = ?`).get(countId, clientKey) as ScanRow | undefined;
    return row ? scanFromRow(row) : null;
  }

  async voidScans(countId: string, scanIds: readonly string[], by: string, reason: CountScanVoidReason, at: string): Promise<void> {
    for (const id of scanIds) this.voidStmt.run(at, by, reason, countId, id);
  }

  async listScans(countId: string, filter: { readonly zoneId?: string; readonly itemId?: string; readonly userId?: string } = {}): Promise<readonly CountScan[]> {
    const clauses = ["count_id = ?"];
    const params: unknown[] = [countId];
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
    const rows = this.sqlite.prepare(`SELECT * FROM physical_count_scan WHERE ${clauses.join(" AND ")} ORDER BY seq`).all(...params) as ScanRow[];
    return rows.map(scanFromRow);
  }
}

export function createSqliteCountModeStore(sqlite: Database.Database): CountModeRepository {
  return new SqliteCountModeStore(sqlite);
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
export function createSqliteCountItemDirectory(sqlite: Database.Database): CountItemDirectory {
  const columns = `id, code, base_unit_code, alternate_units, barcodes`;
  const countable = `track_inventory = 1 AND status <> '${ItemStatusCode.Inactive}'`;
  return {
    async findByBarcode(code) {
      const trimmed = code.trim();
      if (trimmed === "") return null;
      const byBarcode = sqlite
        .prepare(`SELECT ${columns} FROM item WHERE ${countable} AND EXISTS (SELECT 1 FROM json_each(item.barcodes) WHERE value = ?) LIMIT 1`)
        .get(trimmed) as CountableItemRow | undefined;
      if (byBarcode) return itemFromRow(byBarcode);
      const byCode = sqlite.prepare(`SELECT ${columns} FROM item WHERE ${countable} AND code = ? LIMIT 1`).get(trimmed) as CountableItemRow | undefined;
      return byCode ? itemFromRow(byCode) : null;
    },
    async findById(id) {
      const row = sqlite.prepare(`SELECT ${columns} FROM item WHERE id = ?`).get(id) as CountableItemRow | undefined;
      return row ? itemFromRow(row) : null;
    },
    async itemsInCategory(categoryId) {
      const categories = sqlite.prepare(`SELECT id, parent_id FROM item_category`).all() as CategoryRow[];
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
      const rows = sqlite.prepare(`SELECT id, category_id FROM item WHERE ${countable} ORDER BY code`).all() as { id: string; category_id: string | null }[];
      return rows.filter((r) => r.category_id !== null && inTree.has(r.category_id)).map((r) => r.id);
    },
  };
}
