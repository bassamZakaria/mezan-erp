import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { Branch, BranchRepository } from "@mezan/domain";
import { insertingNew, prepareInsertOnly, refusingTakenId } from "./insert-new.js";

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
  is_main: number;
  active: number;
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
    isMain: row.is_main === 1,
    active: row.active === 1,
  };
}

class SqliteBranchStore implements BranchRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO branch (id, code, name, parent_branch_id, phone, email, address, is_main, active)
       VALUES (@id, @code, @name, @parentBranchId, @phone, @email, @address, @isMain, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name = @name, parent_branch_id = @parentBranchId,
         phone = @phone, email = @email, address = @address,
         is_main = @isMain, active = @active`,
    );
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectAll = sqlite.prepare(`SELECT * FROM branch ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM branch WHERE id = ?`);
  }

  async findAll(): Promise<readonly Branch[]> {
    return (this.selectAll.all() as BranchRow[]).map(toBranch);
  }

  async findById(id: string): Promise<Branch | null> {
    const row = this.selectById.get(id) as BranchRow | undefined;
    return row ? toBranch(row) : null;
  }

  async save(branch: Branch): Promise<void> {
    this.write(branch);
  }

  async insert(branch: Branch): Promise<void> {
    // ORDERING: a resubmitted branch collides on its code too, and SQLite names that constraint first — the id is asked about before the write so the refusal is the id's.
    refusingTakenId(this.sqlite, "branch", branch.id);
    insertingNew(branch.id, () => this.write(branch, this.insertOnly));
  }

  private write(branch: Branch, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      parentBranchId: branch.parentBranchId,
      phone: branch.phone,
      email: branch.email,
      address: branch.address,
      isMain: branch.isMain ? 1 : 0,
      active: branch.active ? 1 : 0,
    });
  }
}

export interface SqliteBranchStoreHandle extends BranchRepository {
  close(): void;
}

/** Open a SQLite-backed BranchRepository. ":memory:" for tests, a path for real. */
export function createSqliteBranchStore(path: SqliteConnectionInput = ":memory:"): SqliteBranchStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteBranchStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteBranchStoreHandle;
}
