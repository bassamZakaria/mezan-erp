import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { DuplicateItemCodeError, Money, type AlternateUnit, type CostingMethod, type EtaCodeType, type Item, type ItemRepository, type ItemStatus, type ItemType, type ItemSpecificationValue } from "@mezan/domain";

/**
 * Self-contained SQLite-backed ItemRepository (docs/archive/catalog/03-inventory.md
 * "الأصناف"), following the same standalone-store pattern as
 * warehouse-store.ts / branch-store.ts — Items aren't part of the
 * journal-posting UnitOfWork, so this owns its own connection/table.
 *
 * Money fields (`sale_price`/`cost_price`) are stored as the same scaled
 * INTEGER convention as journal_line.debit/credit (docs/archive/plan.md §2.3) — never
 * REAL. `alternate_units` and `barcodes` are small, item-owned collections
 * with no independent query needs, so they're kept as JSON text columns
 * rather than child tables.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS item (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  name_ar              TEXT NOT NULL,
  name_en              TEXT,
  type                 TEXT NOT NULL,
  base_unit_code       TEXT NOT NULL,
  alternate_units      TEXT NOT NULL,
  barcodes             TEXT NOT NULL,
  category_id          TEXT,
  brand                TEXT,
  season_id            TEXT,
  description          TEXT,
  default_supplier_id  TEXT,
  specifications       TEXT NOT NULL DEFAULT '[]',
  costing_method       TEXT NOT NULL,
  sale_price           INTEGER,
  cost_price           INTEGER,
  tax_rate_percent     REAL NOT NULL,
  track_inventory      INTEGER NOT NULL,
  track_batches        INTEGER NOT NULL,
  track_expiry         INTEGER NOT NULL,
  reorder_point        REAL,
  image_attachment_id  TEXT,
  reorder_qty          REAL,
  revenue_account_id   TEXT,
  cogs_account_id      TEXT,
  inventory_account_id TEXT,
  eta_code_type        TEXT,
  eta_item_code        TEXT,
  gpc_code             TEXT,
  status               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_category ON item(category_id);
`;

interface ItemRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: string;
  base_unit_code: string;
  alternate_units: string;
  barcodes: string;
  category_id: string | null;
  brand: string | null;
  season_id: string | null;
  description: string | null;
  default_supplier_id: string | null;
  specifications: string | null;
  costing_method: string;
  sale_price: number | null;
  cost_price: number | null;
  tax_rate_percent: number;
  track_inventory: number;
  track_batches: number;
  track_expiry: number;
  reorder_point: number | null;
  image_attachment_id: string | null;
  reorder_qty: number | null;
  revenue_account_id: string | null;
  cogs_account_id: string | null;
  inventory_account_id: string | null;
  eta_code_type: string | null;
  eta_item_code: string | null;
  gpc_code: string | null;
  status: string;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    type: row.type as ItemType,
    baseUnitCode: row.base_unit_code,
    alternateUnits: JSON.parse(row.alternate_units) as AlternateUnit[],
    barcodes: JSON.parse(row.barcodes) as string[],
    categoryId: row.category_id,
    // `brand` is the column's original name; it holds a brand ID now (R5.10).
    brandId: row.brand,
    seasonId: row.season_id,
    description: row.description,
    defaultSupplierId: row.default_supplier_id,
    specifications: JSON.parse(row.specifications ?? "[]") as ItemSpecificationValue[],
    costingMethod: row.costing_method as CostingMethod,
    salePrice: row.sale_price === null ? null : Money.fromScaled(row.sale_price),
    costPrice: row.cost_price === null ? null : Money.fromScaled(row.cost_price),
    taxRatePercent: row.tax_rate_percent,
    trackInventory: row.track_inventory === 1,
    trackBatches: row.track_batches === 1,
    trackExpiry: row.track_expiry === 1,
    reorderPoint: row.reorder_point,
    imageAttachmentId: row.image_attachment_id ?? null,
    reorderQty: row.reorder_qty,
    revenueAccountId: row.revenue_account_id,
    cogsAccountId: row.cogs_account_id,
    inventoryAccountId: row.inventory_account_id,
    etaCodeType: row.eta_code_type as EtaCodeType | null,
    etaItemCode: row.eta_item_code,
    gpcCode: row.gpc_code,
    status: row.status as ItemStatus,
  };
}

class SqliteItemStore implements ItemRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO item (
        id, code, name_ar, name_en, type, base_unit_code, alternate_units, barcodes,
        category_id, brand, season_id, description, default_supplier_id, specifications, costing_method, sale_price, cost_price, tax_rate_percent,
        track_inventory, track_batches, track_expiry, reorder_point, image_attachment_id, reorder_qty,
        revenue_account_id, cogs_account_id, inventory_account_id,
        eta_code_type, eta_item_code, gpc_code, status
      ) VALUES (
        @id, @code, @name_ar, @name_en, @type, @base_unit_code, @alternate_units, @barcodes,
        @category_id, @brand, @season_id, @description, @default_supplier_id, @specifications, @costing_method, @sale_price, @cost_price, @tax_rate_percent,
        @track_inventory, @track_batches, @track_expiry, @reorder_point, @image_attachment_id, @reorder_qty,
        @revenue_account_id, @cogs_account_id, @inventory_account_id,
        @eta_code_type, @eta_item_code, @gpc_code, @status
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        type = excluded.type,
        base_unit_code = excluded.base_unit_code,
        alternate_units = excluded.alternate_units,
        barcodes = excluded.barcodes,
        category_id = excluded.category_id,
        brand = excluded.brand,
        season_id = excluded.season_id,
        description = excluded.description,
        default_supplier_id = excluded.default_supplier_id,
        specifications = excluded.specifications,
        costing_method = excluded.costing_method,
        sale_price = excluded.sale_price,
        cost_price = excluded.cost_price,
        tax_rate_percent = excluded.tax_rate_percent,
        track_inventory = excluded.track_inventory,
        track_batches = excluded.track_batches,
        track_expiry = excluded.track_expiry,
        reorder_point = excluded.reorder_point,
        image_attachment_id = excluded.image_attachment_id,
        reorder_qty = excluded.reorder_qty,
        revenue_account_id = excluded.revenue_account_id,
        cogs_account_id = excluded.cogs_account_id,
        inventory_account_id = excluded.inventory_account_id,
        eta_code_type = excluded.eta_code_type,
        eta_item_code = excluded.eta_item_code,
        gpc_code = excluded.gpc_code,
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM item WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM item WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM item`);
  }

  async findById(id: string): Promise<Item | null> {
    const row = this.selectById.get(id) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  async findByCode(code: string): Promise<Item | null> {
    const row = this.selectByCode.get(code) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  async list(): Promise<Item[]> {
    const rows = this.selectAll.all() as ItemRow[];
    return rows.map(toItem);
  }

  async create(item: Item): Promise<void> {
    this.write(item);
  }

  async update(item: Item): Promise<void> {
    this.write(item);
  }

  /**
   * `code` is the table's only UNIQUE column besides the `id` primary key
   * that `ON CONFLICT(id)` already handles, so any constraint failure here is
   * a code clash — surfaced as the same domain error the in-memory fake and
   * the pre-check throw, so `createItem`'s allocation retry can catch it
   * regardless of which layer won the race.
   */
  private write(item: Item): void {
    try {
      this.runUpsert(item);
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DuplicateItemCodeError(item.code);
      }
      throw err;
    }
  }

  private runUpsert(item: Item): void {
    this.upsert.run({
      id: item.id,
      code: item.code,
      name_ar: item.nameAr,
      name_en: item.nameEn,
      type: item.type,
      base_unit_code: item.baseUnitCode,
      alternate_units: JSON.stringify(item.alternateUnits),
      barcodes: JSON.stringify(item.barcodes),
      category_id: item.categoryId,
      brand: item.brandId,
      season_id: item.seasonId,
      description: item.description,
      default_supplier_id: item.defaultSupplierId,
      specifications: JSON.stringify(item.specifications),
      costing_method: item.costingMethod,
      sale_price: item.salePrice === null ? null : item.salePrice.toScaledNumber(),
      cost_price: item.costPrice === null ? null : item.costPrice.toScaledNumber(),
      tax_rate_percent: item.taxRatePercent,
      track_inventory: item.trackInventory ? 1 : 0,
      track_batches: item.trackBatches ? 1 : 0,
      track_expiry: item.trackExpiry ? 1 : 0,
      reorder_point: item.reorderPoint,
      image_attachment_id: item.imageAttachmentId,
      reorder_qty: item.reorderQty,
      revenue_account_id: item.revenueAccountId,
      cogs_account_id: item.cogsAccountId,
      inventory_account_id: item.inventoryAccountId,
      eta_code_type: item.etaCodeType,
      eta_item_code: item.etaItemCode,
      gpc_code: item.gpcCode,
      status: item.status,
    });
  }
}

export interface SqliteItemStoreHandle extends ItemRepository {
  close(): void;
}

/** Open a SQLite-backed ItemRepository. ":memory:" for tests, a path for real. */
export function createSqliteItemStore(path: SqliteConnectionInput = ":memory:"): SqliteItemStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteItemStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteItemStoreHandle;
}
