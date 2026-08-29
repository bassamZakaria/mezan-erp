import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type Project, type ProjectRepository, type ProjectStatus } from "@mezan/domain";

/** SQLite-backed ProjectRepository (docs/archive/catalog/07 "المشاريع والمقاولات"). Standalone, mirroring `createSqliteAccountRepository`. */

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
  budget: number;
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

class SqliteProjectRepository implements ProjectRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO project (id, code, name_ar, name_en, status, customer_id, manager_id, start_date, end_date, budget, site_address, notes, cost_center_id)
      VALUES (@id, @code, @name_ar, @name_en, @status, @customer_id, @manager_id, @start_date, @end_date, @budget, @site_address, @notes, @cost_center_id)
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
        cost_center_id = excluded.cost_center_id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM project WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM project WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM project`);
  }

  async findById(id: string): Promise<Project | null> {
    const row = this.selectById.get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  async findByCode(code: string): Promise<Project | null> {
    const row = this.selectByCode.get(code) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = this.selectAll.all() as ProjectRow[];
    return rows.map(toProject);
  }

  async create(project: Project): Promise<void> {
    this.write(project);
  }

  async update(project: Project): Promise<void> {
    this.write(project);
  }

  private write(project: Project): void {
    this.upsert.run({
      id: project.id,
      code: project.code,
      name_ar: project.nameAr,
      name_en: project.nameEn,
      status: project.status,
      customer_id: project.customerId,
      manager_id: project.managerId,
      start_date: project.startDate,
      end_date: project.endDate,
      budget: project.budget.toScaledNumber(),
      site_address: project.siteAddress,
      notes: project.notes,
      cost_center_id: project.costCenterId,
    });
  }
}

export interface SqliteProjectRepositoryHandle extends ProjectRepository {
  close(): void;
}

/** Open a SQLite-backed ProjectRepository. ":memory:" for tests, a path for real. */
export function createSqliteProjectRepository(path: SqliteConnectionInput = ":memory:"): SqliteProjectRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteProjectRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteProjectRepositoryHandle;
}
