import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import { SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  normalizeEmail,
  type JournalEntry,
  type JournalRepository,
  type UnitOfWork,
  type Role,
  type RoleRepository,
  type User,
  type UserRepository,
  type ScopeSelection,
} from "@mezan/domain";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS uow_journal_entry (
  id      TEXT PRIMARY KEY,
  date    TEXT NOT NULL,
  memo    TEXT NOT NULL,
  status  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uow_journal_line (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   TEXT NOT NULL REFERENCES uow_journal_entry(id),
  line_no    INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  debit      INTEGER NOT NULL,
  credit     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uow_journal_line_entry ON uow_journal_line(entry_id);
CREATE TABLE IF NOT EXISTS role (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  permissions  TEXT NOT NULL,
  is_system    INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_code ON role(code);
CREATE TABLE IF NOT EXISTS user (
  id                TEXT PRIMARY KEY,
  name_ar           TEXT NOT NULL,
  name_en           TEXT,
  email             TEXT NOT NULL,
  phone             TEXT,
  password_hash     TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  role_id           TEXT REFERENCES role(id),
  is_company_admin  INTEGER NOT NULL,
  employee_id       TEXT,
  branch_scope      TEXT NOT NULL,
  warehouse_scope   TEXT NOT NULL,
  status            TEXT NOT NULL,
  photo_url         TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  erased_at         TEXT,
  access_expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON user(email);
`;

/**
 * Brings a database up to email-as-login.
 *
 * A short-lived build gave users a separate `username` column; the login is
 * the email now, so the column and its index are removed rather than left as
 * dead schema for the next reader to wonder about. The index goes first —
 * SQLite refuses to drop a column an index still names.
 *
 * Emails are then normalised in place, because the column is now a credential:
 * `Admin@x.com` and `admin@x.com` would otherwise be two accounts, and only
 * one of them could ever sign in.
 */
function migrateUserLogin(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(user)`).all() as { name: string }[];
  if (columns.some((c) => c.name === "username")) {
    sqlite.exec(`DROP INDEX IF EXISTS idx_user_username`);
    sqlite.exec(`ALTER TABLE user DROP COLUMN username`);
  }
  sqlite.exec(`UPDATE user SET email = lower(trim(email)) WHERE email <> lower(trim(email))`);
  // Profile photos arrived after the table did; an install that predates them
  // must gain the column or every user read fails on a missing field.
  if (!columns.some((c) => c.name === "photo_url")) {
    sqlite.exec(`ALTER TABLE user ADD COLUMN photo_url TEXT`);
  }
  // One display name became two — Arabic (the record) and Latin (optional).
  // An install that predates the split keeps whatever it had as the Arabic
  // name, which is what it always was on an Arabic-first product.
  //
  // THE COLUMN IS ALREADY THERE BY NOW, AND EMPTY. `schema-sync` runs on the
  // CREATE TABLE above and adds any column the declaration has and the file
  // lacks — so on a pre-split database it adds `name_ar` as a nullable blank
  // beside the populated `full_name`, and a naive `if (!hasNameAr)` guard
  // reads that as "already migrated". Every user then loads with a null name,
  // which is exactly what the app did before this: it signed people in with
  // no name at all rather than failing. Copy the value across, THEN drop the
  // old column.
  const has = (name: string) => columns.some((c) => c.name === name);
  if (has("full_name")) {
    if (!has("name_ar")) {
      sqlite.exec(`ALTER TABLE user RENAME COLUMN full_name TO name_ar`);
    } else {
      sqlite.exec(`UPDATE user SET name_ar = full_name WHERE name_ar IS NULL OR trim(name_ar) = ''`);
      sqlite.exec(`ALTER TABLE user DROP COLUMN full_name`);
    }
  }
  // CONTRACT: the PIN was retired for password sign-in. A PIN hash is a valid
  // password hash, so it becomes a one-time password the user must replace —
  // nobody is locked out by the upgrade and no shared password is published.
  if (has("pin_hash")) {
    sqlite.exec(`UPDATE user SET password_hash = pin_hash, must_change_password = 1 WHERE pin_hash IS NOT NULL`);
    sqlite.exec(`ALTER TABLE user DROP COLUMN pin_hash`);
  }
  if (!has("name_en") && !columns.some((c) => c.name === "name_en")) {
    const after = sqlite.prepare(`PRAGMA table_info(user)`).all() as { name: string }[];
    if (!after.some((c) => c.name === "name_en")) sqlite.exec(`ALTER TABLE user ADD COLUMN name_en TEXT`);
  }
}

function scopeToJson(scope: ScopeSelection): string {
  return JSON.stringify(scope === "*" ? "*" : [...scope]);
}

function scopeFromJson(raw: string): ScopeSelection {
  const parsed = JSON.parse(raw) as "*" | string[];
  return parsed === "*" ? "*" : parsed;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: string;
  is_system: bigint;
  created_at: string;
}

const ROLE_COLUMNS = "id, code, name, description, permissions, is_system, created_at";

class SqlRoleRepository implements RoleRepository {
  constructor(private readonly db: SqlDb) {}

  async save(r: Role): Promise<void> {
    await this.db.run(
      `INSERT INTO role (id, code, name, description, permissions, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         code = excluded.code,
         name = excluded.name,
         description = excluded.description,
         permissions = excluded.permissions,
         is_system = excluded.is_system`,
      [r.id, r.code, r.name, r.description, JSON.stringify(r.permissions), r.isSystem ? 1 : 0, r.createdAt],
    );
  }

  async findById(id: string): Promise<Role | null> {
    const row = await this.db.get<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM role WHERE id = ?`, [id]);
    return row ? rowToRole(row) : null;
  }

  async findByCode(code: string): Promise<Role | null> {
    const row = await this.db.get<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM role WHERE code = ?`, [code]);
    return row ? rowToRole(row) : null;
  }

  async list(): Promise<readonly Role[]> {
    return (await this.db.all<RoleRow>(`SELECT ${ROLE_COLUMNS} FROM role`)).map(rowToRole);
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM role WHERE id = ?`, [id]);
  }
}

function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    permissions: JSON.parse(row.permissions) as string[],
    isSystem: Number(row.is_system) === 1,
    createdAt: row.created_at,
  };
}

interface UserRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  email: string;
  phone: string | null;
  password_hash: string;
  must_change_password: bigint | number;
  role_id: string | null;
  is_company_admin: bigint;
  employee_id: string | null;
  branch_scope: string;
  warehouse_scope: string;
  status: string;
  photo_url: string | null;
  last_login_at: string | null;
  created_at: string;
  erased_at: string | null;
  access_expires_at: string | null;
}

const USER_COLUMNS =
  "id, name_ar, name_en, email, phone, password_hash, must_change_password, role_id, is_company_admin, employee_id, branch_scope, warehouse_scope, status, photo_url, last_login_at, created_at, erased_at, access_expires_at";

class SqlUserRepository implements UserRepository {
  constructor(private readonly db: SqlDb) {}

  async save(u: User): Promise<void> {
    const params: SqlValue[] = [
      u.id,
      u.nameAr,
      u.nameEn,
      u.email,
      u.phone,
      u.passwordHash,
      u.mustChangePassword ? 1 : 0,
      u.roleId,
      u.isCompanyAdmin ? 1 : 0,
      u.employeeId,
      scopeToJson(u.branchScope),
      scopeToJson(u.warehouseScope),
      u.status,
      u.photoUrl,
      u.lastLoginAt,
      u.createdAt,
      u.erasedAt ?? null,
      u.accessExpiresAt ?? null,
    ];
    await this.db.run(
      `INSERT INTO "user" (${USER_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name_ar = excluded.name_ar,
         name_en = excluded.name_en,
         email = excluded.email,
         phone = excluded.phone,
         password_hash = excluded.password_hash,
         must_change_password = excluded.must_change_password,
         role_id = excluded.role_id,
         is_company_admin = excluded.is_company_admin,
         employee_id = excluded.employee_id,
         branch_scope = excluded.branch_scope,
         warehouse_scope = excluded.warehouse_scope,
         status = excluded.status,
         photo_url = excluded.photo_url,
         last_login_at = excluded.last_login_at,
         erased_at = excluded.erased_at,
         access_expires_at = excluded.access_expires_at`,
      params,
    );
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.get<UserRow>(`SELECT ${USER_COLUMNS} FROM "user" WHERE id = ?`, [id]);
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.get<UserRow>(`SELECT ${USER_COLUMNS} FROM "user" WHERE email = ?`, [normalizeEmail(email)]);
    return row ? rowToUser(row) : null;
  }

  async list(): Promise<readonly User[]> {
    return (await this.db.all<UserRow>(`SELECT ${USER_COLUMNS} FROM "user"`)).map(rowToUser);
  }
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    email: row.email,
    phone: row.phone,
    passwordHash: row.password_hash,
    mustChangePassword: Number(row.must_change_password) === 1,
    roleId: row.role_id,
    isCompanyAdmin: Number(row.is_company_admin) === 1,
    employeeId: row.employee_id,
    branchScope: scopeFromJson(row.branch_scope),
    warehouseScope: scopeFromJson(row.warehouse_scope),
    status: row.status as User["status"],
    photoUrl: row.photo_url,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    erasedAt: row.erased_at,
    accessExpiresAt: row.access_expires_at,
  };
}

class SqlJournalRepository implements JournalRepository {
  constructor(private readonly db: SqlDb) {}

  async save(entry: JournalEntry): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO uow_journal_entry (id, date, memo, status) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.date, entry.memo, entry.status],
    );
    refuseUnlessInserted(entry.id, inserted.changes);
    for (const [index, line] of entry.lines.entries()) {
      await this.db.run(
        `INSERT INTO uow_journal_line (entry_id, line_no, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)`,
        [entry.id, index, line.accountId, line.debit.scaled, line.credit.scaled],
      );
    }
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const header = await this.db.get<{ id: string; date: string; memo: string; status: string }>(
      `SELECT id, date, memo, status FROM uow_journal_entry WHERE id = ?`,
      [id],
    );
    if (!header) return null;
    const lineRows = await this.db.all<{ account_id: string; debit: bigint; credit: bigint }>(
      `SELECT account_id, debit, credit FROM uow_journal_line WHERE entry_id = ? ORDER BY line_no`,
      [id],
    );
    return {
      id: header.id,
      date: header.date,
      memo: header.memo,
      status: header.status as "posted",
      lines: lineRows.map((row) => ({
        accountId: row.account_id,
        debit: Money.fromScaled(row.debit),
        credit: Money.fromScaled(row.credit),
      })),
    };
  }
}

class SqlUnitOfWork implements UnitOfWork {
  readonly journal: JournalRepository;
  readonly roles: RoleRepository;
  readonly users: UserRepository;

  constructor(private readonly db: SqlDb) {
    this.journal = new SqlJournalRepository(db);
    this.roles = new SqlRoleRepository(db);
    this.users = new SqlUserRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return this.db.transaction(() => fn(this));
  }
}

export interface SqliteUnitOfWorkHandle extends UnitOfWork {
  close(): void;
}

export async function ensureUnitOfWorkSchema(db: SqlDb): Promise<void> {
  const ddl = db.dialect === SqlDialect.Postgres ? CREATE_TABLES.replace(/\buser\b(?=\s*\()/g, '"user"') : CREATE_TABLES;
  await db.applySchema(ddl);
  await retirePinColumn(db);
}

async function retirePinColumn(db: SqlDb): Promise<void> {
  const present =
    db.dialect === SqlDialect.Postgres
      ? await db.get(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name = 'pin_hash'`)
      : await db.get(`SELECT 1 AS x FROM pragma_table_info('user') WHERE name = 'pin_hash'`);
  if (!present) return;
  await db.transaction(async () => {
    await db.run(`UPDATE "user" SET password_hash = pin_hash, must_change_password = 1 WHERE pin_hash IS NOT NULL`);
    await db.exec(`ALTER TABLE "user" DROP COLUMN pin_hash`);
  });
}

export function createUnitOfWork(db: SqlDb): UnitOfWork {
  return new SqlUnitOfWork(db);
}

export function createSqliteUnitOfWork(
  path: SqliteConnectionInput = ":memory:",
): SqliteUnitOfWorkHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  migrateUserLogin(sqlite);
  return Object.assign(createUnitOfWork(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteUnitOfWorkHandle;
}
