import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type CostingMethod,
  type ProductTemplate,
  type ProductTemplateOption,
  type ProductTemplateRepository,
  type ProductTemplateStatus,
  type ProductTemplateVariant,
} from "@mezan/domain";

/**
 * SQLite-backed ProductTemplateRepository (قوالب المنتجات — the variant matrix).
 * Header row + one row per generated variant; the option matrix is a JSON
 * column (mirrors `configurable_product`'s `inputs`/`materials`). Prices are
 * INTEGER at Money's fixed 1e-6 scale, never REAL.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS product_template (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name_ar          TEXT NOT NULL,
  name_en          TEXT,
  base_unit_code   TEXT NOT NULL,
  category_id      TEXT,
  base_price       INTEGER,
  tax_rate_percent REAL NOT NULL,
  costing_method   TEXT NOT NULL,
  options_json     TEXT NOT NULL,
  status           TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_template_variant (
  template_id TEXT NOT NULL REFERENCES product_template(id),
  line_no     INTEGER NOT NULL,
  sku         TEXT NOT NULL,
  values_json TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  sale_price  INTEGER,
  item_id     TEXT,
  PRIMARY KEY (template_id, line_no)
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
  base_price: number | null;
  tax_rate_percent: number;
  costing_method: string;
  options_json: string;
  status: string;
  created_at: string;
}

interface ProductTemplateVariantRow {
  sku: string;
  values_json: string;
  name_ar: string;
  sale_price: number | null;
  item_id: string | null;
}

function toVariant(row: ProductTemplateVariantRow): ProductTemplateVariant {
  return {
    sku: row.sku,
    values: JSON.parse(row.values_json) as string[],
    nameAr: row.name_ar,
    salePrice: row.sale_price === null ? null : Money.fromScaled(row.sale_price),
    itemId: row.item_id,
  };
}

function toTemplate(row: ProductTemplateRow, variants: ProductTemplateVariant[]): ProductTemplate {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    baseUnitCode: row.base_unit_code,
    categoryId: row.category_id,
    basePrice: row.base_price === null ? null : Money.fromScaled(row.base_price),
    taxRatePercent: row.tax_rate_percent,
    costingMethod: row.costing_method as CostingMethod,
    options: JSON.parse(row.options_json) as ProductTemplateOption[],
    variants,
    status: row.status as ProductTemplateStatus,
    createdAt: row.created_at,
  };
}

class SqliteProductTemplateStore implements ProductTemplateRepository {
  private readonly upsert: Database.Statement;
  private readonly deleteVariants: Database.Statement;
  private readonly insertVariant: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectVariants: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO product_template
        (id, code, name_ar, name_en, base_unit_code, category_id, base_price,
         tax_rate_percent, costing_method, options_json, status, created_at)
      VALUES
        (@id, @code, @nameAr, @nameEn, @baseUnitCode, @categoryId, @basePrice,
         @taxRatePercent, @costingMethod, @options, @status, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        code = @code, name_ar = @nameAr, name_en = @nameEn,
        base_unit_code = @baseUnitCode, category_id = @categoryId,
        base_price = @basePrice, tax_rate_percent = @taxRatePercent,
        costing_method = @costingMethod, options_json = @options, status = @status
    `);
    this.deleteVariants = sqlite.prepare(`DELETE FROM product_template_variant WHERE template_id = ?`);
    this.insertVariant = sqlite.prepare(`
      INSERT INTO product_template_variant (template_id, line_no, sku, values_json, name_ar, sale_price, item_id)
      VALUES (@templateId, @lineNo, @sku, @values, @nameAr, @salePrice, @itemId)
    `);
    this.selectAll = sqlite.prepare(`SELECT * FROM product_template ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM product_template WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM product_template WHERE code = ?`);
    this.selectVariants = sqlite.prepare(
      `SELECT sku, values_json, name_ar, sale_price, item_id
       FROM product_template_variant WHERE template_id = ? ORDER BY line_no ASC`,
    );
    this.deleteById = sqlite.prepare(`DELETE FROM product_template WHERE id = ?`);
  }

  private variantsOf(templateId: string): ProductTemplateVariant[] {
    return (this.selectVariants.all(templateId) as ProductTemplateVariantRow[]).map(toVariant);
  }

  async list(): Promise<ProductTemplate[]> {
    return (this.selectAll.all() as ProductTemplateRow[]).map((row) =>
      toTemplate(row, this.variantsOf(row.id)),
    );
  }

  async findById(id: string): Promise<ProductTemplate | null> {
    const row = this.selectById.get(id) as ProductTemplateRow | undefined;
    return row ? toTemplate(row, this.variantsOf(row.id)) : null;
  }

  async findByCode(code: string): Promise<ProductTemplate | null> {
    const row = this.selectByCode.get(code) as ProductTemplateRow | undefined;
    return row ? toTemplate(row, this.variantsOf(row.id)) : null;
  }

  async save(template: ProductTemplate): Promise<void> {
    const write = this.sqlite.transaction(() => {
      this.upsert.run({
        id: template.id,
        code: template.code,
        nameAr: template.nameAr,
        nameEn: template.nameEn,
        baseUnitCode: template.baseUnitCode,
        categoryId: template.categoryId,
        basePrice: template.basePrice === null ? null : template.basePrice.toScaledNumber(),
        taxRatePercent: template.taxRatePercent,
        costingMethod: template.costingMethod,
        options: JSON.stringify(template.options),
        status: template.status,
        createdAt: template.createdAt,
      });
      this.deleteVariants.run(template.id);
      template.variants.forEach((variant, index) => {
        this.insertVariant.run({
          templateId: template.id,
          lineNo: index + 1,
          sku: variant.sku,
          values: JSON.stringify(variant.values),
          nameAr: variant.nameAr,
          salePrice: variant.salePrice === null ? null : variant.salePrice.toScaledNumber(),
          itemId: variant.itemId,
        });
      });
    });
    write();
  }

  async delete(id: string): Promise<void> {
    const remove = this.sqlite.transaction(() => {
      this.deleteVariants.run(id);
      this.deleteById.run(id);
    });
    remove();
  }
}

export interface SqliteProductTemplateStoreHandle extends ProductTemplateRepository {
  close(): void;
}

/** Open a SQLite-backed ProductTemplateRepository. ":memory:" for tests, a path for real. */
export function createSqliteProductTemplateStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteProductTemplateStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const store = new SqliteProductTemplateStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteProductTemplateStoreHandle;
}
