import Database from "better-sqlite3";
import type { Warehouse, WarehouseRepository, WarehouseType } from "@mezan/domain";

/** SQLite-backed WarehouseRepository (docs/catalog/09 §"إدارة المستودعات"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS warehouse (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  branch_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  is_default  INTEGER NOT NULL,
  active      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warehouse_branch ON warehouse(branch_id);
`;

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  branch_id: string;
  type: string;
  is_default: number;
  active: number;
}

function toWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    branchId: row.branch_id,
    type: row.type as WarehouseType,
    isDefault: row.is_default === 1,
    active: row.active === 1,
  };
}

class SqliteWarehouseStore implements WarehouseRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByBranch: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO warehouse (id, code, name, branch_id, type, is_default, active)
       VALUES (@id, @code, @name, @branchId, @type, @isDefault, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name = @name, branch_id = @branchId,
         type = @type, is_default = @isDefault, active = @active`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM warehouse ORDER BY code ASC`);
    this.selectByBranch = sqlite.prepare(`SELECT * FROM warehouse WHERE branch_id = ? ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM warehouse WHERE id = ?`);
  }

  async findAll(): Promise<readonly Warehouse[]> {
    return (this.selectAll.all() as WarehouseRow[]).map(toWarehouse);
  }

  async findByBranch(branchId: string): Promise<readonly Warehouse[]> {
    return (this.selectByBranch.all(branchId) as WarehouseRow[]).map(toWarehouse);
  }

  async findById(id: string): Promise<Warehouse | null> {
    const row = this.selectById.get(id) as WarehouseRow | undefined;
    return row ? toWarehouse(row) : null;
  }

  async save(warehouse: Warehouse): Promise<void> {
    this.upsert.run({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      branchId: warehouse.branchId,
      type: warehouse.type,
      isDefault: warehouse.isDefault ? 1 : 0,
      active: warehouse.active ? 1 : 0,
    });
  }
}

export interface SqliteWarehouseStoreHandle extends WarehouseRepository {
  close(): void;
}

/** Open a SQLite-backed WarehouseRepository. ":memory:" for tests, a path for real. */
export function createSqliteWarehouseStore(path = ":memory:"): SqliteWarehouseStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteWarehouseStore(sqlite);
  return Object.assign(store, {
    close: () => sqlite.close(),
  }) as SqliteWarehouseStoreHandle;
}
