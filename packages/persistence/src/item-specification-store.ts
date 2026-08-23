import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  ItemCatalogStatus,
  ItemSpecification,
  ItemSpecificationRepository,
  ItemSpecificationType,
} from "@mezan/domain";

/**
 * SQLite-backed المواصفات registry — the reusable specification/attribute
 * catalog over the item master data. Mirrors `createSqliteItemCatalogStores`'
 * shape: `code` is the primary key and the allowed-values list rides as JSON.
 * Nothing is seeded; an empty table is a real, correct state for a tenant.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS item_specification (
  code       TEXT PRIMARY KEY,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  type       TEXT NOT NULL,
  values_json TEXT NOT NULL,
  unit       TEXT,
  filterable INTEGER NOT NULL,
  status     TEXT NOT NULL
);
`;

interface SpecificationRow {
  code: string;
  name_ar: string;
  name_en: string | null;
  type: string;
  values_json: string;
  unit: string | null;
  filterable: number;
  status: string;
}

function toSpecification(row: SpecificationRow): ItemSpecification {
  return {
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    type: row.type as ItemSpecificationType,
    values: JSON.parse(row.values_json) as string[],
    unit: row.unit,
    filterable: row.filterable === 1,
    status: row.status as ItemCatalogStatus,
  };
}

class SqliteItemSpecificationRepository implements ItemSpecificationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly deleteByCode: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO item_specification (code, name_ar, name_en, type, values_json, unit, filterable, status)
      VALUES (@code, @name_ar, @name_en, @type, @values_json, @unit, @filterable, @status)
      ON CONFLICT(code) DO UPDATE SET
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        type = excluded.type,
        values_json = excluded.values_json,
        unit = excluded.unit,
        filterable = excluded.filterable,
        status = excluded.status
    `);
    this.selectByCode = sqlite.prepare(`SELECT * FROM item_specification WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM item_specification ORDER BY code`);
    this.deleteByCode = sqlite.prepare(`DELETE FROM item_specification WHERE code = ?`);
  }

  private write(specification: ItemSpecification): void {
    this.upsert.run({
      code: specification.code,
      name_ar: specification.nameAr,
      name_en: specification.nameEn,
      type: specification.type,
      values_json: JSON.stringify(specification.values),
      unit: specification.unit,
      filterable: specification.filterable ? 1 : 0,
      status: specification.status,
    });
  }

  async findByCode(code: string): Promise<ItemSpecification | null> {
    const row = this.selectByCode.get(code) as SpecificationRow | undefined;
    return row ? toSpecification(row) : null;
  }

  async list(): Promise<ItemSpecification[]> {
    return (this.selectAll.all() as SpecificationRow[]).map(toSpecification);
  }

  async create(specification: ItemSpecification): Promise<void> {
    this.write(specification);
  }

  async update(specification: ItemSpecification): Promise<void> {
    this.write(specification);
  }

  async delete(code: string): Promise<void> {
    this.deleteByCode.run(code);
  }
}

/** Build the registry on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteItemSpecificationRepository(sqlite: Database.Database): ItemSpecificationRepository {
  sqlite.exec(CREATE_TABLE);
  return new SqliteItemSpecificationRepository(sqlite);
}

export interface SqliteItemSpecificationStoreHandle {
  readonly specifications: ItemSpecificationRepository;
  close(): void;
}

/** Open a SQLite-backed المواصفات registry. ":memory:" for tests, a path for real. */
export function createSqliteItemSpecificationStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteItemSpecificationStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  return {
    specifications: createSqliteItemSpecificationRepository(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
