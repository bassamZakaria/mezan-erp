import Database from "better-sqlite3";
import { Money, type TreasuryAccount, type TreasuryAccountRepository, type TreasuryAccountStatus, type TreasuryAccountType } from "@mezan/domain";

/** SQLite-backed TreasuryAccountRepository (docs/catalog/04 "حسابات الخزينة"). Standalone, mirroring `createSqliteAccountRepository`. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS treasury_account (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,
  currency              TEXT NOT NULL,
  branch_id             TEXT NOT NULL,
  gl_account_id         TEXT,
  opening_balance       INTEGER NOT NULL,
  opening_balance_date  TEXT,
  status                TEXT NOT NULL
);
`;

interface TreasuryAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  branch_id: string;
  gl_account_id: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  status: string;
}

function toTreasuryAccount(row: TreasuryAccountRow): TreasuryAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as TreasuryAccountType,
    currency: row.currency,
    branchId: row.branch_id,
    glAccountId: row.gl_account_id,
    openingBalance: Money.fromScaled(row.opening_balance),
    openingBalanceDate: row.opening_balance_date,
    status: row.status as TreasuryAccountStatus,
  };
}

class SqliteTreasuryAccountRepository implements TreasuryAccountRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO treasury_account (id, code, name, type, currency, branch_id, gl_account_id, opening_balance, opening_balance_date, status)
      VALUES (@id, @code, @name, @type, @currency, @branch_id, @gl_account_id, @opening_balance, @opening_balance_date, @status)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        type = excluded.type,
        currency = excluded.currency,
        branch_id = excluded.branch_id,
        gl_account_id = excluded.gl_account_id,
        opening_balance = excluded.opening_balance,
        opening_balance_date = excluded.opening_balance_date,
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM treasury_account WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM treasury_account WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM treasury_account`);
  }

  async findById(id: string): Promise<TreasuryAccount | null> {
    const row = this.selectById.get(id) as TreasuryAccountRow | undefined;
    return row ? toTreasuryAccount(row) : null;
  }

  async findByCode(code: string): Promise<TreasuryAccount | null> {
    const row = this.selectByCode.get(code) as TreasuryAccountRow | undefined;
    return row ? toTreasuryAccount(row) : null;
  }

  async list(): Promise<TreasuryAccount[]> {
    const rows = this.selectAll.all() as TreasuryAccountRow[];
    return rows.map(toTreasuryAccount);
  }

  async create(account: TreasuryAccount): Promise<void> {
    this.write(account);
  }

  async update(account: TreasuryAccount): Promise<void> {
    this.write(account);
  }

  private write(account: TreasuryAccount): void {
    this.upsert.run({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currency: account.currency,
      branch_id: account.branchId,
      gl_account_id: account.glAccountId,
      opening_balance: account.openingBalance.toScaledNumber(),
      opening_balance_date: account.openingBalanceDate,
      status: account.status,
    });
  }
}

export interface SqliteTreasuryAccountRepositoryHandle extends TreasuryAccountRepository {
  close(): void;
}

/** Open a SQLite-backed TreasuryAccountRepository. ":memory:" for tests, a path for real. */
export function createSqliteTreasuryAccountRepository(path = ":memory:"): SqliteTreasuryAccountRepositoryHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteTreasuryAccountRepository(sqlite);
  return Object.assign(repo, {
    close: () => sqlite.close(),
  }) as SqliteTreasuryAccountRepositoryHandle;
}
