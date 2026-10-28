import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { CostCenter, CostCenterRepository, CostCenterStatus, CostCenterType } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS cost_center (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  type          TEXT NOT NULL,
  department_id TEXT,
  branch_id     TEXT,
  parent_id     TEXT REFERENCES cost_center(id),
  notes         TEXT,
  status        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_center_parent ON cost_center(parent_id);
`;

const UPSERT = `
  INSERT INTO cost_center (id, code, name_ar, name_en, type, department_id, branch_id, parent_id, notes, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    type = excluded.type,
    department_id = excluded.department_id,
    branch_id = excluded.branch_id,
    parent_id = excluded.parent_id,
    notes = excluded.notes,
    status = excluded.status`;

interface CostCenterRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: string;
  department_id: string | null;
  branch_id: string | null;
  parent_id: string | null;
  notes: string | null;
  status: string;
}

function toCostCenter(row: CostCenterRow): CostCenter {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    type: row.type as CostCenterType,
    departmentId: row.department_id,
    branchId: row.branch_id,
    parentId: row.parent_id,
    notes: row.notes,
    status: row.status as CostCenterStatus,
  };
}

function params(c: CostCenter): SqlValue[] {
  return [c.id, c.code, c.nameAr, c.nameEn, c.type, c.departmentId, c.branchId, c.parentId, c.notes, c.status];
}

class SqlCostCenterRepository implements CostCenterRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<CostCenter | null> {
    const row = await this.db.get<CostCenterRow>(`SELECT * FROM cost_center WHERE id = ?`, [id]);
    return row ? toCostCenter(row) : null;
  }

  async findByCode(code: string): Promise<CostCenter | null> {
    const row = await this.db.get<CostCenterRow>(`SELECT * FROM cost_center WHERE code = ?`, [code]);
    return row ? toCostCenter(row) : null;
  }

  async list(): Promise<CostCenter[]> {
    return (await this.db.all<CostCenterRow>(`SELECT * FROM cost_center`)).map(toCostCenter);
  }

  async create(costCenter: CostCenter): Promise<void> {
    await insertNew(this.db, costCenter.id, UPSERT, params(costCenter));
  }

  async update(costCenter: CostCenter): Promise<void> {
    await this.db.run(UPSERT, params(costCenter));
  }
}

export interface SqliteCostCenterRepositoryHandle extends CostCenterRepository {
  close(): void;
}

export async function ensureCostCenterSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createCostCenterRepository(db: SqlDb): CostCenterRepository {
  return new SqlCostCenterRepository(db);
}

export function createSqliteCostCenterRepository(path: SqliteConnectionInput = ":memory:"): SqliteCostCenterRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createCostCenterRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteCostCenterRepositoryHandle;
}
