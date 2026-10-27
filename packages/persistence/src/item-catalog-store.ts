import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type {
  ItemCatalogStatus,
  ItemCategory,
  ItemCategoryRepository,
  ItemUnit,
  ItemUnitRepository,
  ItemBrand,
  ItemBrandRepository,
  ItemSeason,
  ItemSeasonRepository,
} from "@mezan/domain";

/**
 * SQLite-backed item master-data catalogs (docs/archive/catalog/03 §"وحدة القياس" /
 * §"تصنيفات الأصناف"). One connection backs both tables, mirroring
 * `createSqliteInventoryOpsStore`'s shape.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS item_unit (
  code    TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  status  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_brand (
  id      TEXT PRIMARY KEY,
  code    TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  status  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_season (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  start_date TEXT,
  end_date   TEXT,
  status     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_category (
  id        TEXT PRIMARY KEY,
  name_ar   TEXT NOT NULL,
  name_en   TEXT,
  parent_id TEXT,
  status    TEXT NOT NULL
);
`;

interface UnitRow {
  code: string;
  name_ar: string;
  name_en: string | null;
  status: string;
}

interface CategoryRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  parent_id: string | null;
  status: string;
}

function toUnit(row: UnitRow): ItemUnit {
  return { code: row.code, nameAr: row.name_ar, nameEn: row.name_en, status: row.status as ItemCatalogStatus };
}

function toCategory(row: CategoryRow): ItemCategory {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    parentId: row.parent_id,
    status: row.status as ItemCatalogStatus,
  };
}

const UPSERT_UNIT = `INSERT INTO item_unit (code, name_ar, name_en, status)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    status = excluded.status`;

function createUnitRepository(db: SqlDb): ItemUnitRepository {
  async function write(unit: ItemUnit): Promise<void> {
    await db.run(UPSERT_UNIT, [unit.code, unit.nameAr, unit.nameEn, unit.status]);
  }

  return {
    async findByCode(code) {
      const row = await db.get<UnitRow>(`SELECT * FROM item_unit WHERE code = ?`, [code]);
      return row ? toUnit(row) : null;
    },
    async list() {
      return (await db.all<UnitRow>(`SELECT * FROM item_unit ORDER BY code`)).map(toUnit);
    },
    async create(unit) {
      await write(unit);
    },
    async update(unit) {
      await write(unit);
    },
  };
}

const UPSERT_CATEGORY = `INSERT INTO item_category (id, name_ar, name_en, parent_id, status)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    parent_id = excluded.parent_id,
    status = excluded.status`;

function createCategoryRepository(db: SqlDb): ItemCategoryRepository {
  const params = (category: ItemCategory) => [category.id, category.nameAr, category.nameEn, category.parentId, category.status];

  return {
    async findById(id) {
      const row = await db.get<CategoryRow>(`SELECT * FROM item_category WHERE id = ?`, [id]);
      return row ? toCategory(row) : null;
    },
    async list() {
      return (await db.all<CategoryRow>(`SELECT * FROM item_category ORDER BY name_ar`)).map(toCategory);
    },
    async create(category) {
      await insertNew(db, category.id, UPSERT_CATEGORY, params(category));
    },
    async update(category) {
      await db.run(UPSERT_CATEGORY, params(category));
    },
  };
}

interface BrandRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  status: string;
}

interface SeasonRow extends BrandRow {
  start_date: string | null;
  end_date: string | null;
}

function toBrand(row: BrandRow): ItemBrand {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    status: row.status as ItemCatalogStatus,
  };
}

function toSeason(row: SeasonRow): ItemSeason {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as ItemCatalogStatus,
  };
}

const UPSERT_BRAND = `INSERT INTO item_brand (id, code, name_ar, name_en, status)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    status = excluded.status`;

function createBrandRepository(db: SqlDb): ItemBrandRepository {
  const params = (brand: ItemBrand) => [brand.id, brand.code, brand.nameAr, brand.nameEn, brand.status];

  return {
    async findById(id) {
      const row = await db.get<BrandRow>(`SELECT * FROM item_brand WHERE id = ?`, [id]);
      return row ? toBrand(row) : null;
    },
    async list() {
      return (await db.all<BrandRow>(`SELECT * FROM item_brand ORDER BY name_ar`)).map(toBrand);
    },
    async create(brand) {
      await insertNew(db, brand.id, UPSERT_BRAND, params(brand));
    },
    async update(brand) {
      await db.run(UPSERT_BRAND, params(brand));
    },
    async delete(id) {
      await db.run(`DELETE FROM item_brand WHERE id = ?`, [id]);
    },
  };
}

const UPSERT_SEASON = `INSERT INTO item_season (id, code, name_ar, name_en, start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    status = excluded.status`;

function createSeasonRepository(db: SqlDb): ItemSeasonRepository {
  const params = (season: ItemSeason) => [season.id, season.code, season.nameAr, season.nameEn, season.startDate, season.endDate, season.status];

  return {
    async findById(id) {
      const row = await db.get<SeasonRow>(`SELECT * FROM item_season WHERE id = ?`, [id]);
      return row ? toSeason(row) : null;
    },
    async list() {
      return (await db.all<SeasonRow>(`SELECT * FROM item_season ORDER BY start_date DESC NULLS LAST, name_ar`)).map(toSeason);
    },
    async create(season) {
      await insertNew(db, season.id, UPSERT_SEASON, params(season));
    },
    async update(season) {
      await db.run(UPSERT_SEASON, params(season));
    },
    async delete(id) {
      await db.run(`DELETE FROM item_season WHERE id = ?`, [id]);
    },
  };
}

export interface SqliteItemCatalogStores {
  readonly units: ItemUnitRepository;
  readonly categories: ItemCategoryRepository;
  readonly brands: ItemBrandRepository;
  readonly seasons: ItemSeasonRepository;
}

export async function ensureItemCatalogSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createItemCatalogStores(db: SqlDb): SqliteItemCatalogStores {
  return {
    units: createUnitRepository(db),
    categories: createCategoryRepository(db),
    brands: createBrandRepository(db),
    seasons: createSeasonRepository(db),
  };
}

/** Build the item-catalog repositories on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteItemCatalogStores(sqlite: Database.Database): SqliteItemCatalogStores {
  sqlite.exec(CREATE_TABLES);
  return createItemCatalogStores(sqliteDb(sqlite));
}
export interface SqliteItemCatalogStoreHandle extends SqliteItemCatalogStores {
  close(): void;
}

/** Open a SQLite-backed item-catalog store. ":memory:" for tests, a path for real. */
export function createSqliteItemCatalogStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteItemCatalogStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  return {
    ...createSqliteItemCatalogStores(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
