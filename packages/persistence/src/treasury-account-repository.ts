import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type TreasuryAccount, type TreasuryAccountRepository, type TreasuryAccountStatus, type TreasuryAccountType } from "@mezan/domain";

/** SQLite-backed TreasuryAccountRepository (docs/archive/catalog/04 "حسابات الخزينة"). Standalone, mirroring `createSqliteAccountRepository`. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS treasury_account (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  name_en               TEXT,
  type                  TEXT NOT NULL,
  currency              TEXT NOT NULL,
  branch_id             TEXT NOT NULL,
  gl_account_id         TEXT,
  opening_balance       INTEGER NOT NULL,
  opening_balance_date  TEXT,
  guarantee_facility_limit INTEGER,
  status                TEXT NOT NULL
);
`;

interface TreasuryAccountRow {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  type: string;
  currency: string;
  branch_id: string;
  gl_account_id: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  guarantee_facility_limit: number | null;
  status: string;
}

function toTreasuryAccount(row: TreasuryAccountRow): TreasuryAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    type: row.type as TreasuryAccountType,
    currency: row.currency,
    branchId: row.branch_id,
    glAccountId: row.gl_account_id,
    openingBalance: Money.fromScaled(row.opening_balance),
    openingBalanceDate: row.opening_balance_date,
    guaranteeFacilityLimit: row.guarantee_facility_limit == null ? null : Money.fromScaled(row.guarantee_facility_limit),
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
      INSERT INTO treasury_account (id, code, name, name_en, type, currency, branch_id, gl_account_id, opening_balance, opening_balance_date, guarantee_facility_limit, status)
      VALUES (@id, @code, @name, @name_en, @type, @currency, @branch_id, @gl_account_id, @opening_balance, @opening_balance_date, @guarantee_facility_limit, @status)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        name_en = excluded.name_en,
        type = excluded.type,
        currency = excluded.currency,
        branch_id = excluded.branch_id,
        gl_account_id = excluded.gl_account_id,
        opening_balance = excluded.opening_balance,
        opening_balance_date = excluded.opening_balance_date,
        guarantee_facility_limit = excluded.guarantee_facility_limit,
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
      name_en: account.nameEn,
      type: account.type,
      currency: account.currency,
      branch_id: account.branchId,
      gl_account_id: account.glAccountId,
      opening_balance: account.openingBalance.toScaledNumber(),
      opening_balance_date: account.openingBalanceDate,
      guarantee_facility_limit: account.guaranteeFacilityLimit ? account.guaranteeFacilityLimit.toScaledNumber() : null,
      status: account.status,
    });
  }
}

/** حد تسهيلات خطابات الضمان arrived after the table shipped — an existing db gains the column in place. */
function migrateTreasuryAccountSchema(sqlite: Database.Database): void {
  const columns = new Set(
    (sqlite.prepare(`PRAGMA table_info(treasury_account)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("guarantee_facility_limit")) {
    sqlite.exec(`ALTER TABLE treasury_account ADD COLUMN guarantee_facility_limit INTEGER`);
  }
}

export interface SqliteTreasuryAccountRepositoryHandle extends TreasuryAccountRepository {
  close(): void;
}

/** Open a SQLite-backed TreasuryAccountRepository. ":memory:" for tests, a path for real. */
export function createSqliteTreasuryAccountRepository(path: SqliteConnectionInput = ":memory:"): SqliteTreasuryAccountRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  migrateTreasuryAccountSchema(sqlite);
  const repo = new SqliteTreasuryAccountRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteTreasuryAccountRepositoryHandle;
}
