import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import { childRowsByParentAsync } from "./list-query.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type Promotion,
  type PromotionBundleComponent,
  type PromotionDayHourRestriction,
  type PromotionListFilter,
  type PromotionRepository,
  type PromotionScope,
  type PromotionScopeType,
  type PromotionType,
} from "@mezan/domain";

/**
 * SQLite-backed {@link PromotionRepository} — header + child-lines pattern
 * (mirrors sales-invoice-store.ts). Money/Qty columns are INTEGER at each
 * value object's fixed 1e-6 scale, never REAL. `scope.ids` and
 * `dayHourRestriction` are stored as JSON TEXT since they're small,
 * variable-shape blobs with no need for relational querying. Bundle
 * components get their own child table and are fully deleted + re-inserted
 * on update, like sales-invoice-store.ts's line-replace pattern.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS promotion (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  priority              INTEGER NOT NULL,
  name_ar               TEXT NOT NULL,
  name_en               TEXT,
  description           TEXT,
  type                  TEXT NOT NULL,
  percent_value         REAL,
  amount_value          INTEGER,
  min_invoice_value     INTEGER,
  buy_qty               INTEGER,
  get_qty               INTEGER,
  requires_coupon       INTEGER NOT NULL,
  day_hour_restriction  TEXT,
  scope_type            TEXT NOT NULL,
  scope_ids             TEXT NOT NULL,
  start_date            TEXT NOT NULL,
  end_date              TEXT NOT NULL,
  active                INTEGER NOT NULL,
  created_at            TEXT NOT NULL,
  min_qty               INTEGER,
  max_discount_amount   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_promotion_active ON promotion(active);
CREATE TABLE IF NOT EXISTS promotion_bundle_component (
  promotion_id TEXT NOT NULL REFERENCES promotion(id),
  line_no      INTEGER NOT NULL,
  item_id      TEXT NOT NULL,
  qty          INTEGER NOT NULL,
  PRIMARY KEY (promotion_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_promotion_bundle_component_promotion ON promotion_bundle_component(promotion_id);
`;

/** Columns added after the first release — an existing database keeps both null (no threshold, no cap). */
const ADDED_COLUMNS: readonly [string, string][] = [
  ["min_qty", "INTEGER"],
  ["max_discount_amount", "INTEGER"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(promotion)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE promotion ADD COLUMN ${name} ${type}`);
  }
}

interface PromotionRow {
  id: string;
  code: string;
  priority: bigint;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  type: string;
  percent_value: number | null;
  amount_value: bigint | null;
  min_invoice_value: bigint | null;
  min_qty: bigint | null;
  max_discount_amount: bigint | null;
  buy_qty: bigint | null;
  get_qty: bigint | null;
  requires_coupon: bigint;
  day_hour_restriction: string | null;
  scope_type: string;
  scope_ids: string;
  start_date: string;
  end_date: string;
  active: bigint;
  created_at: string;
}

interface BundleComponentRow {
  item_id: string;
  qty: bigint;
}

function toBundleComponent(row: BundleComponentRow): PromotionBundleComponent {
  return { itemId: row.item_id, qty: Qty.fromScaled(row.qty) };
}

function toPromotion(row: PromotionRow, bundleComponents: readonly PromotionBundleComponent[]): Promotion {
  const scope: PromotionScope = {
    type: row.scope_type as PromotionScopeType,
    ids: row.scope_ids ? (JSON.parse(row.scope_ids) as string[]) : [],
  };
  const dayHourRestriction: PromotionDayHourRestriction | null = row.day_hour_restriction
    ? (JSON.parse(row.day_hour_restriction) as PromotionDayHourRestriction)
    : null;

  return {
    id: row.id,
    code: row.code,
    priority: Number(row.priority),
    nameAr: row.name_ar,
    nameEn: row.name_en,
    description: row.description,
    type: row.type as PromotionType,
    percentValue: row.percent_value,
    amountValue: row.amount_value === null ? null : Money.fromScaled(row.amount_value),
    minInvoiceValue: row.min_invoice_value === null ? null : Money.fromScaled(row.min_invoice_value),
    minQty: row.min_qty === null || row.min_qty === undefined ? null : Qty.fromScaled(row.min_qty),
    maxDiscountAmount:
      row.max_discount_amount === null || row.max_discount_amount === undefined
        ? null
        : Money.fromScaled(row.max_discount_amount),
    buyQty: row.buy_qty === null ? null : Number(row.buy_qty),
    getQty: row.get_qty === null ? null : Number(row.get_qty),
    bundleComponents,
    requiresCoupon: Number(row.requires_coupon) === 1,
    dayHourRestriction,
    scope,
    startDate: row.start_date,
    endDate: row.end_date,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
  };
}

const PROMOTION_COLUMNS = [
  "code", "priority", "name_ar", "name_en", "description", "type", "percent_value", "amount_value",
  "min_invoice_value", "min_qty", "max_discount_amount", "buy_qty", "get_qty", "requires_coupon",
  "day_hour_restriction", "scope_type", "scope_ids", "start_date", "end_date", "active", "created_at",
] as const;

function promotionParams(promotion: Promotion): SqlValue[] {
  return [
    promotion.code,
    promotion.priority,
    promotion.nameAr,
    promotion.nameEn,
    promotion.description,
    promotion.type,
    promotion.percentValue,
    promotion.amountValue === null ? null : promotion.amountValue.scaled,
    promotion.minInvoiceValue === null ? null : promotion.minInvoiceValue.scaled,
    promotion.minQty === null ? null : promotion.minQty.scaled,
    promotion.maxDiscountAmount === null ? null : promotion.maxDiscountAmount.scaled,
    promotion.buyQty,
    promotion.getQty,
    promotion.requiresCoupon ? 1 : 0,
    promotion.dayHourRestriction === null ? null : JSON.stringify(promotion.dayHourRestriction),
    promotion.scope.type,
    JSON.stringify(promotion.scope.ids),
    promotion.startDate,
    promotion.endDate,
    promotion.active ? 1 : 0,
    promotion.createdAt,
    promotion.id,
  ];
}

const INSERT_PROMOTION = `INSERT INTO promotion (${PROMOTION_COLUMNS.join(", ")}, id)
  VALUES (${PROMOTION_COLUMNS.map(() => "?").join(", ")}, ?)
  ON CONFLICT (id) DO NOTHING`;
const UPDATE_PROMOTION = `UPDATE promotion SET ${PROMOTION_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`;

class SqlPromotionRepository implements PromotionRepository {
  constructor(private readonly db: SqlDb) {}

  async save(promotion: Promotion): Promise<void> {
    refuseUnlessInserted(promotion.id, (await this.db.run(INSERT_PROMOTION, promotionParams(promotion))).changes);
    await this.insertBundleComponents(promotion);
  }

  async update(promotion: Promotion): Promise<void> {
    await this.db.run(UPDATE_PROMOTION, promotionParams(promotion));
    await this.db.run(`DELETE FROM promotion_bundle_component WHERE promotion_id = ?`, [promotion.id]);
    await this.insertBundleComponents(promotion);
  }

  async findById(id: string): Promise<Promotion | null> {
    const row = await this.db.get<PromotionRow>(`SELECT * FROM promotion WHERE id = ?`, [id]);
    return row ? this.hydrate(row) : null;
  }

  async list(filter: PromotionListFilter = {}): Promise<readonly Promotion[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<PromotionRow>(`SELECT * FROM promotion ${where} ORDER BY created_at`, params);
    const componentsByPromotion = await childRowsByParentAsync<BundleComponentRow & { promotion_id: string }>(this.db, {
      table: "promotion_bundle_component",
      parentColumn: "promotion_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "promotion_id, line_no",
      columns: "promotion_id, item_id, qty",
    });
    return Promise.all(rows.map((row) => this.hydrate(row, componentsByPromotion.get(row.id) ?? [])));
  }

  private async insertBundleComponents(promotion: Promotion): Promise<void> {
    for (const [index, component] of promotion.bundleComponents.entries()) {
      await this.db.run(
        `INSERT INTO promotion_bundle_component (promotion_id, line_no, item_id, qty) VALUES (?, ?, ?, ?)`,
        [promotion.id, index, component.itemId, component.qty.scaled],
      );
    }
  }

  private async hydrate(row: PromotionRow, preloadedComponents?: readonly BundleComponentRow[]): Promise<Promotion> {
    const componentRows =
      preloadedComponents ??
      (await this.db.all<BundleComponentRow>(`SELECT item_id, qty FROM promotion_bundle_component WHERE promotion_id = ? ORDER BY line_no`, [row.id]));
    return toPromotion(row, componentRows.map(toBundleComponent));
  }
}

export interface SqlitePromotionStoreHandle extends PromotionRepository {
  close(): void;
}

export async function ensurePromotionSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createPromotionStore(db: SqlDb): PromotionRepository {
  return new SqlPromotionRepository(db);
}

/** Open a SQLite-backed PromotionRepository. ":memory:" for tests, a path for real. */
export function createSqlitePromotionStore(path: SqliteConnectionInput = ":memory:"): SqlitePromotionStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  return Object.assign(createPromotionStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
