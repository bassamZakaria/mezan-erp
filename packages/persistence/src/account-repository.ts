import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { DuplicateAccountCodeError, type Account, type AccountRepository, type AccountStatus, type AccountType, type NaturalBalance } from "@mezan/domain";
import { refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

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

const UPSERT = `
  INSERT INTO account (id, code, name_ar, name_en, type, natural_balance, parent_id, is_header, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    type = excluded.type,
    natural_balance = excluded.natural_balance,
    parent_id = excluded.parent_id,
    is_header = excluded.is_header,
    status = excluded.status`;

// A taken id or code must not raise on Postgres: one failed statement aborts the whole request transaction.
const INSERT_NEW = `${UPSERT.slice(0, UPSERT.indexOf("ON CONFLICT"))}ON CONFLICT DO NOTHING`;

interface AccountRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: string;
  natural_balance: string;
  parent_id: string | null;
  is_header: bigint;
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
    isHeader: Number(row.is_header) === 1,
    status: row.status as AccountStatus,
  };
}

function params(account: Account): SqlValue[] {
  return [
    account.id,
    account.code,
    account.nameAr,
    account.nameEn,
    account.type,
    account.naturalBalance,
    account.parentId,
    account.isHeader ? 1 : 0,
    account.status,
  ];
}

class SqlAccountRepository implements AccountRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Account | null> {
    const row = await this.db.get<AccountRow>(`SELECT * FROM account WHERE id = ?`, [id]);
    return row ? toAccount(row) : null;
  }

  async findByCode(code: string): Promise<Account | null> {
    const row = await this.db.get<AccountRow>(`SELECT * FROM account WHERE code = ?`, [code]);
    return row ? toAccount(row) : null;
  }

  async list(): Promise<Account[]> {
    return (await this.db.all<AccountRow>(`SELECT * FROM account`)).map(toAccount);
  }

  async create(account: Account): Promise<void> {
    if ((await this.db.run(INSERT_NEW, params(account))).changes > 0) return;
    const byCode = await this.findByCode(account.code);
    if (byCode && byCode.id !== account.id) throw new DuplicateAccountCodeError(account.code);
    refuseUnlessInserted(account.id, 0);
  }

  async update(account: Account): Promise<void> {
    await this.db.run(UPSERT, params(account));
  }
}

export interface SqliteAccountRepositoryHandle extends AccountRepository {
  close(): void;
}

export async function ensureAccountSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createAccountRepository(db: SqlDb): AccountRepository {
  return new SqlAccountRepository(db);
}

export function createSqliteAccountRepository(path: SqliteConnectionInput = ":memory:"): SqliteAccountRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createAccountRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteAccountRepositoryHandle;
}
