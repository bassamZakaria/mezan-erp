import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type CostingMethod,
  type ProductTemplate,
  type ProductTemplateAttribute,
  type ProductTemplateRepository,
  type ProductTemplateStatus,
  type ProductTemplateVariant,
  type ProductTemplateVariantRepository,
} from "@mezan/domain";

/**
 * SQLite-backed store for Product Templates (docs/archive/catalog/03-inventory.md
 * §"قوالب المنتجات"): the template row (scalar fields + an `attributes` JSON
 * column, mirroring how `depreciation_run.lines` is stored) and the generated
 * variants table (one row per real Item the generator has produced). Money
 * is stored as scaled INTEGER, round-tripped via `.toString()`/`Money.fromMajor`
 * — never floats.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS product_template (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name_ar             TEXT NOT NULL,
  name_en             TEXT,
  base_unit_code      TEXT NOT NULL,
  category_id         TEXT,
  brand               TEXT,
  costing_method      TEXT NOT NULL,
  default_sale_price  INTEGER,
  default_cost        INTEGER,
  tax_rate_percent    REAL NOT NULL,
  attributes          TEXT NOT NULL,
  status              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_template_variant (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  item_code    TEXT NOT NULL,
  values_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_template_variant_template ON product_template_variant(template_id);
`;

interface ProductTemplateRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  base_unit_code: string;
  category_id: string | null;
  brand: string | null;
  costing_method: string;
  default_sale_price: bigint | null;
  default_cost: bigint | null;
  tax_rate_percent: number;
  attributes: string;
  status: string;
}

function toProductTemplate(row: ProductTemplateRow): ProductTemplate {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    baseUnitCode: row.base_unit_code,
    categoryId: row.category_id,
    brandId: row.brand,
    costingMethod: row.costing_method as CostingMethod,
    defaultSalePrice: row.default_sale_price === null ? null : Money.fromScaled(row.default_sale_price),
    defaultCost: row.default_cost === null ? null : Money.fromScaled(row.default_cost),
    taxRatePercent: row.tax_rate_percent,
    attributes: (JSON.parse(row.attributes) as ProductTemplateAttribute[]).map((attribute) => ({
      ...attribute,
      specificationCode: attribute.specificationCode ?? null,
    })),
    status: row.status as ProductTemplateStatus,
  };
}

const UPSERT_TEMPLATE = `INSERT INTO product_template (id, code, name_ar, name_en, base_unit_code, category_id, brand, costing_method, default_sale_price, default_cost, tax_rate_percent, attributes, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    base_unit_code = excluded.base_unit_code,
    category_id = excluded.category_id,
    brand = excluded.brand,
    costing_method = excluded.costing_method,
    default_sale_price = excluded.default_sale_price,
    default_cost = excluded.default_cost,
    tax_rate_percent = excluded.tax_rate_percent,
    attributes = excluded.attributes,
    status = excluded.status`;

function templateParams(template: ProductTemplate): SqlValue[] {
  return [
    template.id,
    template.code,
    template.nameAr,
    template.nameEn,
    template.baseUnitCode,
    template.categoryId,
    template.brandId,
    template.costingMethod,
    template.defaultSalePrice === null ? null : template.defaultSalePrice.scaled,
    template.defaultCost === null ? null : template.defaultCost.scaled,
    template.taxRatePercent,
    JSON.stringify(template.attributes),
    template.status,
  ];
}

class SqlProductTemplateRepository implements ProductTemplateRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<ProductTemplate | null> {
    const row = await this.db.get<ProductTemplateRow>(`SELECT * FROM product_template WHERE id = ?`, [id]);
    return row ? toProductTemplate(row) : null;
  }

  async findByCode(code: string): Promise<ProductTemplate | null> {
    const row = await this.db.get<ProductTemplateRow>(`SELECT * FROM product_template WHERE code = ?`, [code]);
    return row ? toProductTemplate(row) : null;
  }

  async list(): Promise<ProductTemplate[]> {
    return (await this.db.all<ProductTemplateRow>(`SELECT * FROM product_template`)).map(toProductTemplate);
  }

  async create(template: ProductTemplate): Promise<void> {
    await insertNew(this.db, template.id, UPSERT_TEMPLATE, templateParams(template));
  }

  async update(template: ProductTemplate): Promise<void> {
    await this.db.run(UPSERT_TEMPLATE, templateParams(template));
  }
}

interface ProductTemplateVariantRow {
  id: string;
  template_id: string;
  item_id: string;
  item_code: string;
  values_json: string;
  created_at: string;
}

function toVariant(row: ProductTemplateVariantRow): ProductTemplateVariant {
  return {
    id: row.id,
    templateId: row.template_id,
    itemId: row.item_id,
    itemCode: row.item_code,
    values: JSON.parse(row.values_json) as Record<string, string>,
    createdAt: row.created_at,
  };
}

class SqlProductTemplateVariantRepository implements ProductTemplateVariantRepository {
  constructor(private readonly db: SqlDb) {}

  async listByTemplate(templateId: string): Promise<readonly ProductTemplateVariant[]> {
    return (await this.db.all<ProductTemplateVariantRow>(`SELECT * FROM product_template_variant WHERE template_id = ?`, [templateId])).map(toVariant);
  }

  async create(variant: ProductTemplateVariant): Promise<void> {
    await this.db.run(
      `INSERT INTO product_template_variant (id, template_id, item_id, item_code, values_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [variant.id, variant.templateId, variant.itemId, variant.itemCode, JSON.stringify(variant.values), variant.createdAt],
    );
  }
}

export interface ProductTemplateStoreHandle {
  readonly templates: ProductTemplateRepository;
  readonly variants: ProductTemplateVariantRepository;
}

export interface SqliteProductTemplateStoreHandle extends ProductTemplateStoreHandle {
  close(): void;
}

export async function ensureProductTemplateSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createProductTemplateStore(db: SqlDb): ProductTemplateStoreHandle {
  return { templates: new SqlProductTemplateRepository(db), variants: new SqlProductTemplateVariantRepository(db) };
}

/** Open a SQLite-backed Product Template store. ":memory:" for tests, a path for real. */
export function createSqliteProductTemplateStore(path: SqliteConnectionInput = ":memory:"): SqliteProductTemplateStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    ...createProductTemplateStore(sqliteDb(sqlite)),
    close: () => { if (owned) sqlite.close(); },
  };
}
