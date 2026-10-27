import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type TreasuryAccount, type TreasuryAccountRepository, type TreasuryAccountStatus, type TreasuryAccountType } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS treasury_account (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  name_en               TEXT,
  type                  TEXT NOT NULL,
  currency              TEXT NOT NULL,
  bank_account_number   TEXT,
  branch_id             TEXT,
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
  bank_account_number: string | null;
  branch_id: string | null;
  gl_account_id: string | null;
  opening_balance: bigint;
  opening_balance_date: string | null;
  guarantee_facility_limit: bigint | null;
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
    bankAccountNumber: row.bank_account_number ?? null,
    branchId: row.branch_id,
    glAccountId: row.gl_account_id,
    openingBalance: Money.fromScaled(row.opening_balance),
    openingBalanceDate: row.opening_balance_date,
    guaranteeFacilityLimit: row.guarantee_facility_limit == null ? null : Money.fromScaled(row.guarantee_facility_limit),
    status: row.status as TreasuryAccountStatus,
  };
}

const UPSERT = `
  INSERT INTO treasury_account (id, code, name, name_en, type, currency, bank_account_number, branch_id, gl_account_id, opening_balance, opening_balance_date, guarantee_facility_limit, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name = excluded.name,
    name_en = excluded.name_en,
    type = excluded.type,
    currency = excluded.currency,
    bank_account_number = excluded.bank_account_number,
    branch_id = excluded.branch_id,
    gl_account_id = excluded.gl_account_id,
    opening_balance = excluded.opening_balance,
    opening_balance_date = excluded.opening_balance_date,
    guarantee_facility_limit = excluded.guarantee_facility_limit,
    status = excluded.status`;

function params(account: TreasuryAccount): SqlValue[] {
  return [
    account.id,
    account.code,
    account.name,
    account.nameEn,
    account.type,
    account.currency,
    account.bankAccountNumber,
    account.branchId ?? null,
    account.glAccountId,
    account.openingBalance.scaled,
    account.openingBalanceDate,
    account.guaranteeFacilityLimit ? account.guaranteeFacilityLimit.scaled : null,
    account.status,
  ];
}

class SqlTreasuryAccountRepository implements TreasuryAccountRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<TreasuryAccount | null> {
    const row = await this.db.get<TreasuryAccountRow>(`SELECT * FROM treasury_account WHERE id = ?`, [id]);
    return row ? toTreasuryAccount(row) : null;
  }

  async findByCode(code: string): Promise<TreasuryAccount | null> {
    const row = await this.db.get<TreasuryAccountRow>(`SELECT * FROM treasury_account WHERE code = ?`, [code]);
    return row ? toTreasuryAccount(row) : null;
  }

  async list(): Promise<TreasuryAccount[]> {
    return (await this.db.all<TreasuryAccountRow>(`SELECT * FROM treasury_account`)).map(toTreasuryAccount);
  }

  async create(account: TreasuryAccount): Promise<void> {
    await insertNew(this.db, account.id, UPSERT, params(account));
  }

  async update(account: TreasuryAccount): Promise<void> {
    await this.db.run(UPSERT, params(account));
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
  if (!columns.has("bank_account_number")) {
    sqlite.exec(`ALTER TABLE treasury_account ADD COLUMN bank_account_number TEXT`);
  }
  makeBranchNullable(sqlite);
}

const HELD_ROWS = "treasury_account_held";
const COLUMNS = [
  "id",
  "code",
  "name",
  "name_en",
  "type",
  "currency",
  "bank_account_number",
  "branch_id",
  "gl_account_id",
  "opening_balance",
  "opening_balance_date",
  "guarantee_facility_limit",
  "status",
] as const;

/**
 * INVARIANT: an account no branch owns is stored as NULL. A database installed
 * before that held `branch_id TEXT NOT NULL` and wrote '' for it; SQLite cannot
 * drop NOT NULL in place, so the table is rebuilt in ONE transaction and
 * anything that does not hold throws and leaves the installed table as it was.
 *
 * THE ORDER IS LOAD-BEARING. The rows go back into a table that already bears
 * the name `treasury_account`: a deferred foreign key from another table is
 * only satisfied again by an insert into the parent it names, never by a
 * rename. Triggers return after the rows, so none fires on the copy.
 */
function makeBranchNullable(sqlite: Database.Database): void {
  const branch = (sqlite.prepare(`PRAGMA table_info(treasury_account)`).all() as { name: string; notnull: number }[]).find((c) => c.name === "branch_id");
  if (!branch || branch.notnull === 0) return;
  const attached = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE tbl_name = 'treasury_account' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type`)
    .all() as { sql: string }[];
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const unresolved = () => JSON.stringify(sqlite.pragma("foreign_key_check"));
  sqlite.transaction(() => {
    sqlite.pragma("defer_foreign_keys = ON");
    const before = count("treasury_account");
    const unresolvedBefore = unresolved();
    sqlite.exec(
      `CREATE TEMP TABLE ${HELD_ROWS} AS SELECT ${COLUMNS.map((c) => (c === "branch_id" ? "NULLIF(branch_id, '') AS branch_id" : c)).join(", ")} FROM treasury_account`,
    );
    if (count(HELD_ROWS) !== before) throw new Error("treasury_account rebuild: the copy does not hold every row");
    sqlite.exec(`DROP TABLE treasury_account`);
    sqlite.exec(CREATE_TABLE);
    sqlite.exec(`INSERT INTO treasury_account (${COLUMNS.join(", ")}) SELECT ${COLUMNS.join(", ")} FROM ${HELD_ROWS}`);
    if (count("treasury_account") !== before) throw new Error("treasury_account rebuild: the rebuilt table does not hold every row");
    sqlite.exec(`DROP TABLE ${HELD_ROWS}`);
    for (const { sql } of attached) sqlite.exec(sql);
    if (unresolved() !== unresolvedBefore) throw new Error("treasury_account rebuild: a foreign key no longer resolves");
  })();
}

export interface SqliteTreasuryAccountRepositoryHandle extends TreasuryAccountRepository {
  close(): void;
}

export async function ensureTreasuryAccountSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createTreasuryAccountRepository(db: SqlDb): TreasuryAccountRepository {
  return new SqlTreasuryAccountRepository(db);
}

export function createSqliteTreasuryAccountRepository(path: SqliteConnectionInput = ":memory:"): SqliteTreasuryAccountRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  migrateTreasuryAccountSchema(sqlite);
  return Object.assign(createTreasuryAccountRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteTreasuryAccountRepositoryHandle;
}
