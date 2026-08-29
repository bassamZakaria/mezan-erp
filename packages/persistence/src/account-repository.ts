import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { Account, AccountRepository, AccountStatus, AccountType, NaturalBalance } from "@mezan/domain";

/**
 * SQLite-backed AccountRepository (docs/archive/catalog/04 "دليل الحسابات"). Standalone,
 * like {@link import("./sequence-store.js").createSqliteSequenceStore} — the
 * Chart of Accounts isn't part of the journal-posting UnitOfWork yet (movements
 * wiring is Phase 2), so it owns its own connection/table rather than folding
 * into `createSqliteUnitOfWork`.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS account (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name_ar        TEXT NOT NULL,
  name_en        TEXT,
  type           TEXT NOT NULL,
  natural_balance TEXT NOT NULL,
  parent_id      TEXT REFERENCES account(id),
  is_header      INTEGER NOT NULL,
  status         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_parent ON account(parent_id);
`;

interface AccountRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: string;
  natural_balance: string;
  parent_id: string | null;
  is_header: number;
  status: string;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    type: row.type as AccountType,
    naturalBalance: row.natural_balance as NaturalBalance,
    parentId: row.parent_id,
    isHeader: row.is_header === 1,
    status: row.status as AccountStatus,
  };
}

class SqliteAccountRepository implements AccountRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO account (id, code, name_ar, name_en, type, natural_balance, parent_id, is_header, status)
      VALUES (@id, @code, @name_ar, @name_en, @type, @natural_balance, @parent_id, @is_header, @status)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        type = excluded.type,
        natural_balance = excluded.natural_balance,
        parent_id = excluded.parent_id,
        is_header = excluded.is_header,
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM account WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM account WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM account`);
  }

  async findById(id: string): Promise<Account | null> {
    const row = this.selectById.get(id) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  async findByCode(code: string): Promise<Account | null> {
    const row = this.selectByCode.get(code) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  async list(): Promise<Account[]> {
    const rows = this.selectAll.all() as AccountRow[];
    return rows.map(toAccount);
  }

  async create(account: Account): Promise<void> {
    this.write(account);
  }

  async update(account: Account): Promise<void> {
    this.write(account);
  }

  private write(account: Account): void {
    this.upsert.run({
      id: account.id,
      code: account.code,
      name_ar: account.nameAr,
      name_en: account.nameEn,
      type: account.type,
      natural_balance: account.naturalBalance,
      parent_id: account.parentId,
      is_header: account.isHeader ? 1 : 0,
      status: account.status,
    });
  }
}

export interface SqliteAccountRepositoryHandle extends AccountRepository {
  close(): void;
}

/** Open a SQLite-backed AccountRepository. ":memory:" for tests, a path for real. */
export function createSqliteAccountRepository(path: SqliteConnectionInput = ":memory:"): SqliteAccountRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteAccountRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteAccountRepositoryHandle;
}
