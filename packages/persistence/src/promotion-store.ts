import Database from "better-sqlite3";
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
  created_at            TEXT NOT NULL
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

function promotionParams(promotion: Promotion) {
  return {
    id: promotion.id,
    code: promotion.code,
    priority: promotion.priority,
    name_ar: promotion.nameAr,
    name_en: promotion.nameEn,
    description: promotion.description,
    type: promotion.type,
    percent_value: promotion.percentValue,
    amount_value: promotion.amountValue === null ? null : promotion.amountValue.toScaledNumber(),
    min_invoice_value: promotion.minInvoiceValue === null ? null : promotion.minInvoiceValue.toScaledNumber(),
    buy_qty: promotion.buyQty,
    get_qty: promotion.getQty,
    requires_coupon: promotion.requiresCoupon ? 1 : 0,
    day_hour_restriction: promotion.dayHourRestriction === null ? null : JSON.stringify(promotion.dayHourRestriction),
    scope_type: promotion.scope.type,
    scope_ids: JSON.stringify(promotion.scope.ids),
    start_date: promotion.startDate,
    end_date: promotion.endDate,
    active: promotion.active ? 1 : 0,
    created_at: promotion.createdAt,
  };
}

class SqlitePromotionRepository implements PromotionRepository {
  private readonly insertPromotion: Database.Statement;
  private readonly updatePromotionStmt: Database.Statement;
  private readonly deleteBundleComponents: Database.Statement;
  private readonly insertBundleComponent: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectBundleComponents: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertPromotion = sqlite.prepare(`
      INSERT INTO promotion (
        id, code, priority, name_ar, name_en, description, type, percent_value, amount_value,
        min_invoice_value, buy_qty, get_qty, requires_coupon, day_hour_restriction, scope_type,
        scope_ids, start_date, end_date, active, created_at
      ) VALUES (
        @id, @code, @priority, @name_ar, @name_en, @description, @type, @percent_value, @amount_value,
        @min_invoice_value, @buy_qty, @get_qty, @requires_coupon, @day_hour_restriction, @scope_type,
        @scope_ids, @start_date, @end_date, @active, @created_at
      )
    `);
    this.updatePromotionStmt = sqlite.prepare(`
      UPDATE promotion SET
        code = @code,
        priority = @priority,
        name_ar = @name_ar,
        name_en = @name_en,
        description = @description,
        type = @type,
        percent_value = @percent_value,
        amount_value = @amount_value,
        min_invoice_value = @min_invoice_value,
        buy_qty = @buy_qty,
        get_qty = @get_qty,
        requires_coupon = @requires_coupon,
        day_hour_restriction = @day_hour_restriction,
        scope_type = @scope_type,
        scope_ids = @scope_ids,
        start_date = @start_date,
        end_date = @end_date,
        active = @active,
        created_at = @created_at
      WHERE id = @id
    `);
    this.deleteBundleComponents = sqlite.prepare(`DELETE FROM promotion_bundle_component WHERE promotion_id = ?`);
    this.insertBundleComponent = sqlite.prepare(`
      INSERT INTO promotion_bundle_component (promotion_id, line_no, item_id, qty)
      VALUES (@promotion_id, @line_no, @item_id, @qty)
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM promotion WHERE id = ?`).safeIntegers();
    this.selectBundleComponents = sqlite
      .prepare(`SELECT item_id, qty FROM promotion_bundle_component WHERE promotion_id = ? ORDER BY line_no`)
      .safeIntegers();
  }

  async save(promotion: Promotion): Promise<void> {
    this.insertPromotion.run(promotionParams(promotion));
    this.insertBundleComponents(promotion);
  }

  async update(promotion: Promotion): Promise<void> {
    this.updatePromotionStmt.run(promotionParams(promotion));
    this.deleteBundleComponents.run(promotion.id);
    this.insertBundleComponents(promotion);
  }

  async findById(id: string): Promise<Promotion | null> {
    const row = this.selectById.get(id) as PromotionRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter: PromotionListFilter = {}): Promise<readonly Promotion[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM promotion ${where} ORDER BY created_at`)
      .safeIntegers()
      .all(...params) as PromotionRow[];
    return rows.map((row) => this.hydrate(row));
  }

  private insertBundleComponents(promotion: Promotion): void {
    promotion.bundleComponents.forEach((component, index) => {
      this.insertBundleComponent.run({
        promotion_id: promotion.id,
        line_no: index,
        item_id: component.itemId,
        qty: component.qty.toScaledNumber(),
      });
    });
  }

  private hydrate(row: PromotionRow): Promotion {
    const componentRows = this.selectBundleComponents.all(row.id) as BundleComponentRow[];
    return toPromotion(row, componentRows.map(toBundleComponent));
  }
}

export interface SqlitePromotionStoreHandle extends PromotionRepository {
  close(): void;
}

/** Open a SQLite-backed PromotionRepository. ":memory:" for tests, a path for real. */
export function createSqlitePromotionStore(path = ":memory:"): SqlitePromotionStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  const repo = new SqlitePromotionRepository(sqlite);
  return Object.assign(repo, {
    close: () => sqlite.close(),
  }) as SqlitePromotionStoreHandle;
}
