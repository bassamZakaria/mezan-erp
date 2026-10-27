import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { Branch, BranchRepository } from "@mezan/domain";
import { insertNew, refuseTakenIdAsync } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/** SQLite-backed BranchRepository (docs/archive/catalog/09 §"إدارة الفروع"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS branch (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  parent_branch_id  TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  is_main           INTEGER NOT NULL,
  active            INTEGER NOT NULL
);
`;

interface BranchRow {
  id: string;
  code: string;
  name: string;
  parent_branch_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_main: bigint;
  active: bigint;
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentBranchId: row.parent_branch_id,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isMain: Number(row.is_main) === 1,
    active: Number(row.active) === 1,
  };
}

const UPSERT_BRANCH = `INSERT INTO branch (id, code, name, parent_branch_id, phone, email, address, is_main, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name = excluded.name, parent_branch_id = excluded.parent_branch_id,
         phone = excluded.phone, email = excluded.email, address = excluded.address,
         is_main = excluded.is_main, active = excluded.active`;

function branchParams(branch: Branch): SqlValue[] {
  return [
    branch.id,
    branch.code,
    branch.name,
    branch.parentBranchId,
    branch.phone,
    branch.email,
    branch.address,
    branch.isMain ? 1 : 0,
    branch.active ? 1 : 0,
  ];
}

class SqlBranchStore implements BranchRepository {
  constructor(private readonly db: SqlDb) {}

  async findAll(): Promise<readonly Branch[]> {
    return (await this.db.all<BranchRow>(`SELECT * FROM branch ORDER BY code ASC`)).map(toBranch);
  }

  async findById(id: string): Promise<Branch | null> {
    const row = await this.db.get<BranchRow>(`SELECT * FROM branch WHERE id = ?`, [id]);
    return row ? toBranch(row) : null;
  }

  async save(branch: Branch): Promise<void> {
    await this.db.run(UPSERT_BRANCH, branchParams(branch));
  }

  async insert(branch: Branch): Promise<void> {
    // ORDERING: a resubmitted branch collides on its code too, and SQLite names that constraint first — the id is asked about before the write so the refusal is the id's.
    await refuseTakenIdAsync(this.db, "branch", branch.id);
    await insertNew(this.db, branch.id, UPSERT_BRANCH, branchParams(branch));
  }
}

export interface SqliteBranchStoreHandle extends BranchRepository {
  close(): void;
}

export async function ensureBranchSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createBranchStore(db: SqlDb): BranchRepository {
  return new SqlBranchStore(db);
}

/** Open a SQLite-backed BranchRepository. ":memory:" for tests, a path for real. */
export function createSqliteBranchStore(path: SqliteConnectionInput = ":memory:"): SqliteBranchStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createBranchStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
