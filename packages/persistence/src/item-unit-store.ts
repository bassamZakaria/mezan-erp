import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { ItemUnit, ItemUnitRepository } from "@mezan/domain";

/** SQLite-backed ItemUnitRepository (docs/catalog/03 §"وحدات القياس"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS item_unit (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name_ar         TEXT NOT NULL,
  base_unit_code  TEXT,
  factor          REAL NOT NULL,
  active          INTEGER NOT NULL
);
`;

interface ItemUnitRow {
  id: string;
  code: string;
  name_ar: string;
  base_unit_code: string | null;
  factor: number;
  active: number;
}

function toItemUnit(row: ItemUnitRow): ItemUnit {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    baseUnitCode: row.base_unit_code,
    factor: row.factor,
    active: row.active === 1,
  };
}

class SqliteItemUnitStore implements ItemUnitRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO item_unit (id, code, name_ar, base_unit_code, factor, active)
       VALUES (@id, @code, @nameAr, @baseUnitCode, @factor, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, base_unit_code = @baseUnitCode,
         factor = @factor, active = @active`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM item_unit ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM item_unit WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM item_unit WHERE code = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM item_unit WHERE id = ?`);
  }

  async list(): Promise<ItemUnit[]> {
    return (this.selectAll.all() as ItemUnitRow[]).map(toItemUnit);
  }

  async findById(id: string): Promise<ItemUnit | null> {
    const row = this.selectById.get(id) as ItemUnitRow | undefined;
    return row ? toItemUnit(row) : null;
  }

  async findByCode(code: string): Promise<ItemUnit | null> {
    const row = this.selectByCode.get(code) as ItemUnitRow | undefined;
    return row ? toItemUnit(row) : null;
  }

  async save(unit: ItemUnit): Promise<void> {
    this.upsert.run({
      id: unit.id,
      code: unit.code,
      nameAr: unit.nameAr,
      baseUnitCode: unit.baseUnitCode,
      factor: unit.factor,
      active: unit.active ? 1 : 0,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

export interface SqliteItemUnitStoreHandle extends ItemUnitRepository {
  close(): void;
}

/** Open a SQLite-backed ItemUnitRepository. ":memory:" for tests, a path for real. */
export function createSqliteItemUnitStore(path: SqliteConnectionInput = ":memory:"): SqliteItemUnitStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteItemUnitStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteItemUnitStoreHandle;
}
