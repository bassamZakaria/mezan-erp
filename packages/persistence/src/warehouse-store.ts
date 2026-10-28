import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { Warehouse, WarehouseRepository, WarehouseType } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/** SQLite-backed WarehouseRepository (docs/archive/catalog/09 §"إدارة المستودعات"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS warehouse (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_en     TEXT,
  branch_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  is_default  INTEGER NOT NULL,
  active      INTEGER NOT NULL,
  project_id       TEXT,
  custodian_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_warehouse_branch ON warehouse(branch_id);
`;

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  branch_id: string;
  type: string;
  is_default: bigint;
  active: bigint;
  project_id: string | null;
  custodian_user_id: string | null;
}

function toWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    branchId: row.branch_id,
    type: row.type as WarehouseType,
    isDefault: Number(row.is_default) === 1,
    active: Number(row.active) === 1,
    projectId: row.project_id ?? null,
    custodianUserId: row.custodian_user_id ?? null,
  };
}

const UPSERT_WAREHOUSE = `INSERT INTO warehouse (id, code, name, name_en, branch_id, type, is_default, active, project_id, custodian_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name = excluded.name, name_en = excluded.name_en, branch_id = excluded.branch_id,
         type = excluded.type, is_default = excluded.is_default, active = excluded.active,
         project_id = excluded.project_id, custodian_user_id = excluded.custodian_user_id`;

function warehouseParams(warehouse: Warehouse): SqlValue[] {
  return [
    warehouse.id,
    warehouse.code,
    warehouse.name,
    warehouse.nameEn ?? null,
    warehouse.branchId,
    warehouse.type,
    warehouse.isDefault ? 1 : 0,
    warehouse.active ? 1 : 0,
    warehouse.projectId ?? null,
    warehouse.custodianUserId ?? null,
  ];
}

class SqlWarehouseStore implements WarehouseRepository {
  constructor(private readonly db: SqlDb) {}

  async findAll(): Promise<readonly Warehouse[]> {
    return (await this.db.all<WarehouseRow>(`SELECT * FROM warehouse ORDER BY code ASC`)).map(toWarehouse);
  }

  async findByBranch(branchId: string): Promise<readonly Warehouse[]> {
    return (await this.db.all<WarehouseRow>(`SELECT * FROM warehouse WHERE branch_id = ? ORDER BY code ASC`, [branchId])).map(toWarehouse);
  }

  async findById(id: string): Promise<Warehouse | null> {
    const row = await this.db.get<WarehouseRow>(`SELECT * FROM warehouse WHERE id = ?`, [id]);
    return row ? toWarehouse(row) : null;
  }

  async save(warehouse: Warehouse): Promise<void> {
    await this.db.run(UPSERT_WAREHOUSE, warehouseParams(warehouse));
  }

  async insert(warehouse: Warehouse): Promise<void> {
    await insertNew(this.db, warehouse.id, UPSERT_WAREHOUSE, warehouseParams(warehouse));
  }
}

export interface SqliteWarehouseStoreHandle extends WarehouseRepository {
  close(): void;
}

export async function ensureWarehouseSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createWarehouseStore(db: SqlDb): WarehouseRepository {
  return new SqlWarehouseStore(db);
}

/** Open a SQLite-backed WarehouseRepository. ":memory:" for tests, a path for real. */
export function createSqliteWarehouseStore(path: SqliteConnectionInput = ":memory:"): SqliteWarehouseStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createWarehouseStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
