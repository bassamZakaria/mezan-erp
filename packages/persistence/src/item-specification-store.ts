import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { ItemSpecification, ItemSpecificationRepository, ItemSpecificationType } from "@mezan/domain";

/** SQLite-backed ItemSpecificationRepository (المواصفات — the catalog attribute registry). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS item_specification (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  type       TEXT NOT NULL,
  values_json TEXT NOT NULL,
  unit       TEXT,
  filterable INTEGER NOT NULL,
  active     INTEGER NOT NULL
);
`;

interface ItemSpecificationRow {
  id: string;
  code: string;
  name_ar: string;
  type: string;
  values_json: string;
  unit: string | null;
  filterable: number;
  active: number;
}

function toItemSpecification(row: ItemSpecificationRow): ItemSpecification {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    type: row.type as ItemSpecificationType,
    values: JSON.parse(row.values_json) as string[],
    unit: row.unit,
    filterable: row.filterable === 1,
    active: row.active === 1,
  };
}

class SqliteItemSpecificationStore implements ItemSpecificationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO item_specification (id, code, name_ar, type, values_json, unit, filterable, active)
       VALUES (@id, @code, @nameAr, @type, @values, @unit, @filterable, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, type = @type, values_json = @values,
         unit = @unit, filterable = @filterable, active = @active`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM item_specification ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM item_specification WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM item_specification WHERE code = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM item_specification WHERE id = ?`);
  }

  async list(): Promise<ItemSpecification[]> {
    return (this.selectAll.all() as ItemSpecificationRow[]).map(toItemSpecification);
  }

  async findById(id: string): Promise<ItemSpecification | null> {
    const row = this.selectById.get(id) as ItemSpecificationRow | undefined;
    return row ? toItemSpecification(row) : null;
  }

  async findByCode(code: string): Promise<ItemSpecification | null> {
    const row = this.selectByCode.get(code) as ItemSpecificationRow | undefined;
    return row ? toItemSpecification(row) : null;
  }

  async save(specification: ItemSpecification): Promise<void> {
    this.upsert.run({
      id: specification.id,
      code: specification.code,
      nameAr: specification.nameAr,
      type: specification.type,
      values: JSON.stringify(specification.values),
      unit: specification.unit,
      filterable: specification.filterable ? 1 : 0,
      active: specification.active ? 1 : 0,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

export interface SqliteItemSpecificationStoreHandle extends ItemSpecificationRepository {
  close(): void;
}

/** Open a SQLite-backed ItemSpecificationRepository. ":memory:" for tests, a path for real. */
export function createSqliteItemSpecificationStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteItemSpecificationStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteItemSpecificationStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteItemSpecificationStoreHandle;
}
