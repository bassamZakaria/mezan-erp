import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, asc } from "drizzle-orm";
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
import { schema, journalEntry, journalLine, role, user } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

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
  pin_hash          TEXT,
  role_id           TEXT REFERENCES role(id),
  is_company_admin  INTEGER NOT NULL,
  employee_id       TEXT,
  branch_scope      TEXT NOT NULL,
  warehouse_scope   TEXT NOT NULL,
  status            TEXT NOT NULL,
  photo_url         TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL
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

class DrizzleRoleRepository implements RoleRepository {
  constructor(private readonly db: Db) {}

  async save(r: Role): Promise<void> {
    this.db
      .insert(role)
      .values({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: JSON.stringify(r.permissions),
        isSystem: r.isSystem,
        createdAt: r.createdAt,
      })
      .onConflictDoUpdate({
        target: role.id,
        set: {
          code: r.code,
          name: r.name,
          description: r.description,
          permissions: JSON.stringify(r.permissions),
          isSystem: r.isSystem,
        },
      })
      .run();
  }

  async findById(id: string): Promise<Role | null> {
    const row = this.db.select().from(role).where(eq(role.id, id)).get();
    return row ? rowToRole(row) : null;
  }

  async findByCode(code: string): Promise<Role | null> {
    const row = this.db.select().from(role).where(eq(role.code, code)).get();
    return row ? rowToRole(row) : null;
  }

  async list(): Promise<readonly Role[]> {
    return this.db.select().from(role).all().map(rowToRole);
  }

  async delete(id: string): Promise<void> {
    this.db.delete(role).where(eq(role.id, id)).run();
  }
}

function rowToRole(row: typeof role.$inferSelect): Role {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    permissions: JSON.parse(row.permissions) as string[],
    isSystem: row.isSystem,
    createdAt: row.createdAt,
  };
}

class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async save(u: User): Promise<void> {
    this.db
      .insert(user)
      .values({
        id: u.id,
        nameAr: u.nameAr,
        nameEn: u.nameEn,
        email: u.email,
        phone: u.phone,
        passwordHash: u.passwordHash,
        pinHash: u.pinHash,
        roleId: u.roleId,
        isCompanyAdmin: u.isCompanyAdmin,
        employeeId: u.employeeId,
        branchScope: scopeToJson(u.branchScope),
        warehouseScope: scopeToJson(u.warehouseScope),
        status: u.status,
        photoUrl: u.photoUrl,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          nameAr: u.nameAr,
        nameEn: u.nameEn,
          email: u.email,
          phone: u.phone,
          passwordHash: u.passwordHash,
          pinHash: u.pinHash,
          roleId: u.roleId,
          isCompanyAdmin: u.isCompanyAdmin,
          employeeId: u.employeeId,
          branchScope: scopeToJson(u.branchScope),
          warehouseScope: scopeToJson(u.warehouseScope),
          status: u.status,
          photoUrl: u.photoUrl,
          lastLoginAt: u.lastLoginAt,
        },
      })
      .run();
  }

  async findById(id: string): Promise<User | null> {
    const row = this.db.select().from(user).where(eq(user.id, id)).get();
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = this.db.select().from(user).where(eq(user.email, normalizeEmail(email))).get();
    return row ? rowToUser(row) : null;
  }

  async list(): Promise<readonly User[]> {
    return this.db.select().from(user).all().map(rowToUser);
  }
}

function rowToUser(row: typeof user.$inferSelect): User {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    pinHash: row.pinHash,
    roleId: row.roleId,
    isCompanyAdmin: row.isCompanyAdmin,
    employeeId: row.employeeId,
    branchScope: scopeFromJson(row.branchScope),
    warehouseScope: scopeFromJson(row.warehouseScope),
    status: row.status as User["status"],
    photoUrl: row.photoUrl,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

class DrizzleJournalRepository implements JournalRepository {
  constructor(private readonly db: Db) {}

  async save(entry: JournalEntry): Promise<void> {
    this.db
      .insert(journalEntry)
      .values({
        id: entry.id,
        date: entry.date,
        memo: entry.memo,
        status: entry.status,
      })
      .run();

    entry.lines.forEach((line, index) => {
      this.db
        .insert(journalLine)
        .values({
          entryId: entry.id,
          lineNo: index,
          accountId: line.accountId,
          debit: line.debit.toScaledNumber(),
          credit: line.credit.toScaledNumber(),
        })
        .run();
    });
  }

  async findById(id: string): Promise<JournalEntry | null> {
    const header = this.db
      .select()
      .from(journalEntry)
      .where(eq(journalEntry.id, id))
      .get();
    if (!header) return null;

    const lineRows = this.db
      .select()
      .from(journalLine)
      .where(eq(journalLine.entryId, id))
      .orderBy(asc(journalLine.lineNo))
      .all();

    return {
      id: header.id,
      date: header.date,
      memo: header.memo,
      status: header.status as "posted",
      lines: lineRows.map((row) => ({
        accountId: row.accountId,
        debit: Money.fromScaled(row.debit),
        credit: Money.fromScaled(row.credit),
      })),
    };
  }
}

/**
 * SQLite-backed UnitOfWork. better-sqlite3 is fully synchronous, so a manual
 * BEGIN/COMMIT/ROLLBACK is exact even behind the async port: the writes inside
 * `fn` execute synchronously between BEGIN and COMMIT.
 */
class SqliteUnitOfWork implements UnitOfWork {
  readonly journal: JournalRepository;
  readonly roles: RoleRepository;
  readonly users: UserRepository;

  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {
    this.journal = new DrizzleJournalRepository(db);
    this.roles = new DrizzleRoleRepository(db);
    this.users = new DrizzleUserRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, () => fn(this));
  }
}

export interface SqliteUnitOfWorkHandle extends UnitOfWork {
  close(): void;
}

/**
 * Create a SQLite-backed UnitOfWork. Pass ":memory:" for tests, or a file path
 * for a real (WAL) database — the desktop-edition shape.
 */
export function createSqliteUnitOfWork(
  path: SqliteConnectionInput = ":memory:",
): SqliteUnitOfWorkHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  migrateUserLogin(sqlite);

  const db = drizzle(sqlite, { schema });
  const uow = new SqliteUnitOfWork(db, sqlite);

  return Object.assign(uow, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteUnitOfWorkHandle;
}
