import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
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
  filterable: bigint;
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
    filterable: Number(row.filterable) === 1,
    status: row.status as ItemCatalogStatus,
  };
}

const UPSERT_SPECIFICATION = `INSERT INTO item_specification (code, name_ar, name_en, type, values_json, unit, filterable, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    type = excluded.type,
    values_json = excluded.values_json,
    unit = excluded.unit,
    filterable = excluded.filterable,
    status = excluded.status`;

class SqlItemSpecificationRepository implements ItemSpecificationRepository {
  constructor(private readonly db: SqlDb) {}

  private async write(specification: ItemSpecification): Promise<void> {
    await this.db.run(UPSERT_SPECIFICATION, [
      specification.code,
      specification.nameAr,
      specification.nameEn,
      specification.type,
      JSON.stringify(specification.values),
      specification.unit,
      specification.filterable ? 1 : 0,
      specification.status,
    ]);
  }

  async findByCode(code: string): Promise<ItemSpecification | null> {
    const row = await this.db.get<SpecificationRow>(`SELECT * FROM item_specification WHERE code = ?`, [code]);
    return row ? toSpecification(row) : null;
  }

  async list(): Promise<ItemSpecification[]> {
    return (await this.db.all<SpecificationRow>(`SELECT * FROM item_specification ORDER BY code`)).map(toSpecification);
  }

  async create(specification: ItemSpecification): Promise<void> {
    await this.write(specification);
  }

  async update(specification: ItemSpecification): Promise<void> {
    await this.write(specification);
  }

  async delete(code: string): Promise<void> {
    await this.db.run(`DELETE FROM item_specification WHERE code = ?`, [code]);
  }
}

export async function ensureItemSpecificationSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createItemSpecificationRepository(db: SqlDb): ItemSpecificationRepository {
  return new SqlItemSpecificationRepository(db);
}

/** Build the registry on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteItemSpecificationRepository(sqlite: Database.Database): ItemSpecificationRepository {
  sqlite.exec(CREATE_TABLE);
  return createItemSpecificationRepository(sqliteDb(sqlite));
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
