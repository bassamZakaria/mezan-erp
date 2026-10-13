import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { CostCenter, CostCenterRepository, CostCenterStatus, CostCenterType } from "@mezan/domain";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";

/** SQLite-backed CostCenterRepository (docs/archive/catalog/04 "مراكز التكلفة"). Standalone, mirroring `createSqliteAccountRepository`. */

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

class SqliteCostCenterRepository implements CostCenterRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO cost_center (id, code, name_ar, name_en, type, department_id, branch_id, parent_id, notes, status)
      VALUES (@id, @code, @name_ar, @name_en, @type, @department_id, @branch_id, @parent_id, @notes, @status)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        type = excluded.type,
        department_id = excluded.department_id,
        branch_id = excluded.branch_id,
        parent_id = excluded.parent_id,
        notes = excluded.notes,
        status = excluded.status
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM cost_center WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM cost_center WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM cost_center`);
  }

  async findById(id: string): Promise<CostCenter | null> {
    const row = this.selectById.get(id) as CostCenterRow | undefined;
    return row ? toCostCenter(row) : null;
  }

  async findByCode(code: string): Promise<CostCenter | null> {
    const row = this.selectByCode.get(code) as CostCenterRow | undefined;
    return row ? toCostCenter(row) : null;
  }

  async list(): Promise<CostCenter[]> {
    const rows = this.selectAll.all() as CostCenterRow[];
    return rows.map(toCostCenter);
  }

  async create(costCenter: CostCenter): Promise<void> {
    insertingNew(costCenter.id, () => this.write(costCenter, this.insertOnly));
  }

  async update(costCenter: CostCenter): Promise<void> {
    this.write(costCenter);
  }

  private write(costCenter: CostCenter, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: costCenter.id,
      code: costCenter.code,
      name_ar: costCenter.nameAr,
      name_en: costCenter.nameEn,
      type: costCenter.type,
      department_id: costCenter.departmentId,
      branch_id: costCenter.branchId,
      parent_id: costCenter.parentId,
      notes: costCenter.notes,
      status: costCenter.status,
    });
  }
}

export interface SqliteCostCenterRepositoryHandle extends CostCenterRepository {
  close(): void;
}

/** Open a SQLite-backed CostCenterRepository. ":memory:" for tests, a path for real. */
export function createSqliteCostCenterRepository(path: SqliteConnectionInput = ":memory:"): SqliteCostCenterRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteCostCenterRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteCostCenterRepositoryHandle;
}
