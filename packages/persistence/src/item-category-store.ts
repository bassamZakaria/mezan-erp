import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { ItemCategory, ItemCategoryRepository } from "@mezan/domain";

/** SQLite-backed ItemCategoryRepository (docs/catalog/03 §"تصنيفات الأصناف"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS item_category (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name_ar   TEXT NOT NULL,
  parent_id TEXT,
  active    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_category_parent ON item_category(parent_id);
`;

interface ItemCategoryRow {
  id: string;
  code: string;
  name_ar: string;
  parent_id: string | null;
  active: number;
}

function toItemCategory(row: ItemCategoryRow): ItemCategory {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    parentId: row.parent_id,
    active: row.active === 1,
  };
}

class SqliteItemCategoryStore implements ItemCategoryRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO item_category (id, code, name_ar, parent_id, active)
       VALUES (@id, @code, @nameAr, @parentId, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, parent_id = @parentId, active = @active`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM item_category ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM item_category WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM item_category WHERE code = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM item_category WHERE id = ?`);
  }

  async list(): Promise<ItemCategory[]> {
    return (this.selectAll.all() as ItemCategoryRow[]).map(toItemCategory);
  }

  async findById(id: string): Promise<ItemCategory | null> {
    const row = this.selectById.get(id) as ItemCategoryRow | undefined;
    return row ? toItemCategory(row) : null;
  }

  async findByCode(code: string): Promise<ItemCategory | null> {
    const row = this.selectByCode.get(code) as ItemCategoryRow | undefined;
    return row ? toItemCategory(row) : null;
  }

  async save(category: ItemCategory): Promise<void> {
    this.upsert.run({
      id: category.id,
      code: category.code,
      nameAr: category.nameAr,
      parentId: category.parentId,
      active: category.active ? 1 : 0,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

export interface SqliteItemCategoryStoreHandle extends ItemCategoryRepository {
  close(): void;
}

/** Open a SQLite-backed ItemCategoryRepository. ":memory:" for tests, a path for real. */
export function createSqliteItemCategoryStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteItemCategoryStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteItemCategoryStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteItemCategoryStoreHandle;
}
