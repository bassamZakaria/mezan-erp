import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, asc } from "drizzle-orm";
import {
  Money,
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
  full_name         TEXT NOT NULL,
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
  last_login_at     TEXT,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON user(email);
`;

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
        fullName: u.fullName,
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
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          fullName: u.fullName,
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
    const row = this.db.select().from(user).where(eq(user.email, email)).get();
    return row ? rowToUser(row) : null;
  }

  async list(): Promise<readonly User[]> {
    return this.db.select().from(user).all().map(rowToUser);
  }
}

function rowToUser(row: typeof user.$inferSelect): User {
  return {
    id: row.id,
    fullName: row.fullName,
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

  const db = drizzle(sqlite, { schema });
  const uow = new SqliteUnitOfWork(db, sqlite);

  return Object.assign(uow, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteUnitOfWorkHandle;
}
