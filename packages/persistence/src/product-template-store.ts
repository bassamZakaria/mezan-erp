import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  default_sale_price: number | null;
  default_cost: number | null;
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

class SqliteProductTemplateRepository implements ProductTemplateRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO product_template (id, code, name_ar, name_en, base_unit_code, category_id, brand, costing_method, default_sale_price, default_cost, tax_rate_percent, attributes, status)
      VALUES (@id, @code, @name_ar, @name_en, @base_unit_code, @category_id, @brand, @costing_method, @default_sale_price, @default_cost, @tax_rate_percent, @attributes, @status)
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
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM product_template WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM product_template WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM product_template`);
  }

  async findById(id: string): Promise<ProductTemplate | null> {
    const row = this.selectById.get(id) as ProductTemplateRow | undefined;
    return row ? toProductTemplate(row) : null;
  }

  async findByCode(code: string): Promise<ProductTemplate | null> {
    const row = this.selectByCode.get(code) as ProductTemplateRow | undefined;
    return row ? toProductTemplate(row) : null;
  }

  async list(): Promise<ProductTemplate[]> {
    return (this.selectAll.all() as ProductTemplateRow[]).map(toProductTemplate);
  }

  async create(template: ProductTemplate): Promise<void> {
    this.write(template);
  }

  async update(template: ProductTemplate): Promise<void> {
    this.write(template);
  }

  private write(template: ProductTemplate): void {
    this.upsert.run({
      id: template.id,
      code: template.code,
      name_ar: template.nameAr,
      name_en: template.nameEn,
      base_unit_code: template.baseUnitCode,
      category_id: template.categoryId,
      brand: template.brandId,
      costing_method: template.costingMethod,
      default_sale_price: template.defaultSalePrice === null ? null : template.defaultSalePrice.toScaledNumber(),
      default_cost: template.defaultCost === null ? null : template.defaultCost.toScaledNumber(),
      tax_rate_percent: template.taxRatePercent,
      attributes: JSON.stringify(template.attributes),
      status: template.status,
    });
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

class SqliteProductTemplateVariantRepository implements ProductTemplateVariantRepository {
  private readonly insert: Database.Statement;
  private readonly selectByTemplate: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO product_template_variant (id, template_id, item_id, item_code, values_json, created_at)
      VALUES (@id, @template_id, @item_id, @item_code, @values_json, @created_at)
    `);
    this.selectByTemplate = sqlite.prepare(`SELECT * FROM product_template_variant WHERE template_id = ?`);
  }

  async listByTemplate(templateId: string): Promise<readonly ProductTemplateVariant[]> {
    return (this.selectByTemplate.all(templateId) as ProductTemplateVariantRow[]).map(toVariant);
  }

  async create(variant: ProductTemplateVariant): Promise<void> {
    this.insert.run({
      id: variant.id,
      template_id: variant.templateId,
      item_id: variant.itemId,
      item_code: variant.itemCode,
      values_json: JSON.stringify(variant.values),
      created_at: variant.createdAt,
    });
  }
}

export interface SqliteProductTemplateStoreHandle {
  readonly templates: ProductTemplateRepository;
  readonly variants: ProductTemplateVariantRepository;
  close(): void;
}

/** Open a SQLite-backed Product Template store. ":memory:" for tests, a path for real. */
export function createSqliteProductTemplateStore(path: SqliteConnectionInput = ":memory:"): SqliteProductTemplateStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    templates: new SqliteProductTemplateRepository(sqlite),
    variants: new SqliteProductTemplateVariantRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
