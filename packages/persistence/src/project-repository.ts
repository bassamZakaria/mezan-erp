import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type Project, type ProjectRepository, type ProjectStatus } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS project (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name_ar        TEXT NOT NULL,
  name_en        TEXT,
  status         TEXT NOT NULL,
  customer_id    TEXT,
  manager_id     TEXT,
  start_date     TEXT,
  end_date       TEXT,
  budget         INTEGER NOT NULL,
  site_address   TEXT,
  notes          TEXT,
  cost_center_id TEXT NOT NULL
);
`;

const UPSERT = `
  INSERT INTO project (id, code, name_ar, name_en, status, customer_id, manager_id, start_date, end_date, budget, site_address, notes, cost_center_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    status = excluded.status,
    customer_id = excluded.customer_id,
    manager_id = excluded.manager_id,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    budget = excluded.budget,
    site_address = excluded.site_address,
    notes = excluded.notes,
    cost_center_id = excluded.cost_center_id`;

interface ProjectRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  status: string;
  customer_id: string | null;
  manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: bigint;
  site_address: string | null;
  notes: string | null;
  cost_center_id: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    status: row.status as ProjectStatus,
    customerId: row.customer_id,
    managerId: row.manager_id,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: Money.fromScaled(row.budget),
    siteAddress: row.site_address,
    notes: row.notes,
    costCenterId: row.cost_center_id,
  };
}

function params(p: Project): SqlValue[] {
  return [p.id, p.code, p.nameAr, p.nameEn, p.status, p.customerId, p.managerId, p.startDate, p.endDate, p.budget.scaled, p.siteAddress, p.notes, p.costCenterId];
}

class SqlProjectRepository implements ProjectRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Project | null> {
    const row = await this.db.get<ProjectRow>(`SELECT * FROM project WHERE id = ?`, [id]);
    return row ? toProject(row) : null;
  }

  async findByCode(code: string): Promise<Project | null> {
    const row = await this.db.get<ProjectRow>(`SELECT * FROM project WHERE code = ?`, [code]);
    return row ? toProject(row) : null;
  }

  async list(): Promise<Project[]> {
    return (await this.db.all<ProjectRow>(`SELECT * FROM project`)).map(toProject);
  }

  async create(project: Project): Promise<void> {
    await insertNew(this.db, project.id, UPSERT, params(project));
  }

  async update(project: Project): Promise<void> {
    await this.db.run(UPSERT, params(project));
  }
}

export interface SqliteProjectRepositoryHandle extends ProjectRepository {
  close(): void;
}

export async function ensureProjectSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createProjectRepository(db: SqlDb): ProjectRepository {
  return new SqlProjectRepository(db);
}

export function createSqliteProjectRepository(path: SqliteConnectionInput = ":memory:"): SqliteProjectRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createProjectRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteProjectRepositoryHandle;
}
