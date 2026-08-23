import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  ItemCatalogStatus,
  ItemCategory,
  ItemCategoryRepository,
  ItemUnit,
  ItemUnitRepository,
} from "@mezan/domain";

/**
 * SQLite-backed item master-data catalogs (docs/catalog/03 §"وحدة القياس" /
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

function createUnitRepository(sqlite: Database.Database): ItemUnitRepository {
  const upsert = sqlite.prepare(`
    INSERT INTO item_unit (code, name_ar, name_en, status)
    VALUES (@code, @name_ar, @name_en, @status)
    ON CONFLICT(code) DO UPDATE SET
      name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      status = excluded.status
  `);
  const selectByCode = sqlite.prepare(`SELECT * FROM item_unit WHERE code = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM item_unit ORDER BY code`);

  function write(unit: ItemUnit): void {
    upsert.run({ code: unit.code, name_ar: unit.nameAr, name_en: unit.nameEn, status: unit.status });
  }

  return {
    async findByCode(code) {
      const row = selectByCode.get(code) as UnitRow | undefined;
      return row ? toUnit(row) : null;
    },
    async list() {
      return (selectAll.all() as UnitRow[]).map(toUnit);
    },
    async create(unit) {
      write(unit);
    },
    async update(unit) {
      write(unit);
    },
  };
}

function createCategoryRepository(sqlite: Database.Database): ItemCategoryRepository {
  const upsert = sqlite.prepare(`
    INSERT INTO item_category (id, name_ar, name_en, parent_id, status)
    VALUES (@id, @name_ar, @name_en, @parent_id, @status)
    ON CONFLICT(id) DO UPDATE SET
      name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      parent_id = excluded.parent_id,
      status = excluded.status
  `);
  const selectById = sqlite.prepare(`SELECT * FROM item_category WHERE id = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM item_category ORDER BY name_ar`);

  function write(category: ItemCategory): void {
    upsert.run({
      id: category.id,
      name_ar: category.nameAr,
      name_en: category.nameEn,
      parent_id: category.parentId,
      status: category.status,
    });
  }

  return {
    async findById(id) {
      const row = selectById.get(id) as CategoryRow | undefined;
      return row ? toCategory(row) : null;
    },
    async list() {
      return (selectAll.all() as CategoryRow[]).map(toCategory);
    },
    async create(category) {
      write(category);
    },
    async update(category) {
      write(category);
    },
  };
}

export interface SqliteItemCatalogStores {
  readonly units: ItemUnitRepository;
  readonly categories: ItemCategoryRepository;
}

/** Build the item-catalog repositories on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteItemCatalogStores(sqlite: Database.Database): SqliteItemCatalogStores {
  sqlite.exec(CREATE_TABLES);
  return { units: createUnitRepository(sqlite), categories: createCategoryRepository(sqlite) };
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
