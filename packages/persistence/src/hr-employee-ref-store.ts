import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { EmployeeDirectory, EmployeeRef } from "@mezan/domain";

/**
 * SQLite-backed `EmployeeDirectory` — the minimal, decoupled implementation of
 * `packages/domain/src/hr-shared/employee-ref.ts`'s port, backed by its OWN
 * `hr_employee_ref` table rather than assuming a shape for `hr/master-data`'s
 * not-yet-merged `employee` table. `seed()`/`upsert()` are the extra write
 * methods a composition root or the backend seed script uses to populate it;
 * `EmployeeDirectory` itself (findById/list) is read-only, matching the port.
 *
 * When `hr/master-data` lands, swap this file's factory for one backed by the
 * real employee repository — every hr-* domain module only ever depends on
 * the `EmployeeDirectory` port, so nothing else needs to change.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS hr_employee_ref (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL,
  department_id TEXT,
  active        INTEGER NOT NULL
);
`;

interface EmployeeRefRow {
  id: string;
  code: string;
  name_ar: string;
  department_id: string | null;
  active: number;
}

function toEmployeeRef(row: EmployeeRefRow): EmployeeRef {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    departmentId: row.department_id,
    active: row.active === 1,
  };
}

export interface SqliteEmployeeRefRepositoryHandle extends EmployeeDirectory {
  /** Create or replace one directory entry — used by seed scripts / manual data entry until the real Employee model lands. */
  upsert(ref: EmployeeRef): Promise<void>;
  close(): void;
}

export function createSqliteEmployeeRefRepository(path: SqliteConnectionInput = ":memory:"): SqliteEmployeeRefRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);

  const upsertStmt: Database.Statement = sqlite.prepare(`
    INSERT INTO hr_employee_ref (id, code, name_ar, department_id, active)
    VALUES (@id, @code, @name_ar, @department_id, @active)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      name_ar = excluded.name_ar,
      department_id = excluded.department_id,
      active = excluded.active
  `);
  const selectById: Database.Statement = sqlite.prepare(`SELECT * FROM hr_employee_ref WHERE id = ?`);
  const selectAll: Database.Statement = sqlite.prepare(`SELECT * FROM hr_employee_ref`);

  return {
    async findById(id) {
      const row = selectById.get(id) as EmployeeRefRow | undefined;
      return row ? toEmployeeRef(row) : null;
    },
    async list(filter) {
      const rows = selectAll.all() as EmployeeRefRow[];
      return rows
        .map(toEmployeeRef)
        .filter((e) => (filter?.departmentId ? e.departmentId === filter.departmentId : true))
        .filter((e) => (filter?.activeOnly ? e.active : true));
    },
    async upsert(ref) {
      upsertStmt.run({
        id: ref.id,
        code: ref.code,
        name_ar: ref.nameAr,
        department_id: ref.departmentId,
        active: ref.active ? 1 : 0,
      });
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
