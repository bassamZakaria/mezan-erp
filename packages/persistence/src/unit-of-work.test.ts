import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSqliteUnitOfWork, ensureUnitOfWorkSchema, type SqliteUnitOfWorkHandle } from "./unit-of-work.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import { openSqliteConnection } from "./sqlite-connection.js";
import type { Role, User } from "@mezan/domain";

const handles: SqliteUnitOfWorkHandle[] = [];
function uow() {
  const h = createSqliteUnitOfWork(":memory:");
  handles.push(h);
  return h;
}
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const sampleRole: Role = {
  id: "role-1",
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "دور المبيعات الميدانية",
  permissions: ["sales.invoice.view_own", "field.van_trip.open"],
  isSystem: false,
  createdAt: "2026-08-08T00:00:00.000Z",
};

const sampleUser: User = {
  id: "user-1",
  nameAr: "محمد الشهابي",
    nameEn: null,
  email: "mohamed@cyag.test",
  phone: "+201000000000",
  passwordHash: "scrypt$aa$bb",
  mustChangePassword: false,
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
  status: "active",
  photoUrl: null,
  lastLoginAt: null,
  createdAt: "2026-08-08T00:00:00.000Z",
  erasedAt: null,
  accessExpiresAt: null,
};

describe("SQLite RoleRepository", () => {
  it("round-trips a role, preserving the permission array", async () => {
    const db = uow();
    await db.roles.save(sampleRole);
    const found = await db.roles.findById("role-1");
    expect(found).toEqual(sampleRole);
    const byCode = await db.roles.findByCode("VAN_SALES");
    expect(byCode).toEqual(sampleRole);
  });

  it("upserts on save with the same id", async () => {
    const db = uow();
    await db.roles.save(sampleRole);
    await db.roles.save({ ...sampleRole, name: "اسم محدث" });
    const found = await db.roles.findById("role-1");
    expect(found?.name).toBe("اسم محدث");
    expect(await db.roles.list()).toHaveLength(1);
  });

  it("deletes a role", async () => {
    const db = uow();
    await db.roles.save(sampleRole);
    await db.roles.delete("role-1");
    expect(await db.roles.findById("role-1")).toBeNull();
  });
});

describe("SQLite UserRepository", () => {
  it("round-trips a user with '*' scope", async () => {
    const db = uow();
    await db.users.save(sampleUser);
    const found = await db.users.findById("user-1");
    expect(found).toEqual(sampleUser);
    const byEmail = await db.users.findByEmail("mohamed@cyag.test");
    expect(byEmail).toEqual(sampleUser);
  });

  it("round-trips a user with explicit branch/warehouse id lists", async () => {
    const db = uow();
    const scoped: User = {
      ...sampleUser,
      id: "user-2",
      email: "rep@cyag.test",
      isCompanyAdmin: false,
      roleId: "role-1",
      branchScope: ["MAIN"],
      warehouseScope: ["MAIN-WH", "VAN-1"],
    };
    await db.roles.save(sampleRole);
    await db.users.save(scoped);
    const found = await db.users.findById("user-2");
    expect(found?.branchScope).toEqual(["MAIN"]);
    expect(found?.warehouseScope).toEqual(["MAIN-WH", "VAN-1"]);
  });

  it("lists all users", async () => {
    const db = uow();
    await db.users.save(sampleUser);
    await db.users.save({ ...sampleUser, id: "user-2", email: "second@cyag.test" });
    expect(await db.users.list()).toHaveLength(2);
  });
});

describe("retiring the PIN column on an upgraded file", () => {
  function preRetirementFile(): Database.Database {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT, email TEXT NOT NULL, phone TEXT,
        password_hash TEXT NOT NULL, pin_hash TEXT, role_id TEXT, is_company_admin INTEGER NOT NULL,
        employee_id TEXT, branch_scope TEXT NOT NULL, warehouse_scope TEXT NOT NULL, status TEXT NOT NULL,
        photo_url TEXT, last_login_at TEXT, created_at TEXT NOT NULL, erased_at TEXT, access_expires_at TEXT
      );
      INSERT INTO user (id, name_ar, email, password_hash, pin_hash, is_company_admin, branch_scope, warehouse_scope, status, created_at)
      VALUES ('with-pin', 'أ', 'a@cyag.test', 'scrypt$pw', 'scrypt$pin', 1, '"*"', '"*"', 'active', '2026-01-01'),
             ('no-pin', 'ب', 'b@cyag.test', 'scrypt$pw', NULL, 1, '"*"', '"*"', 'active', '2026-01-01');
      CREATE TABLE auth_session (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL);
      INSERT INTO auth_session (token_hash, user_id) VALUES ('pre-upgrade', 'no-pin');
    `);
    return sqlite;
  }

  function columns(sqlite: Database.Database): string[] {
    return (sqlite.prepare(`PRAGMA table_info(user)`).all() as { name: string }[]).map((c) => c.name);
  }

  async function expectRetired(sqlite: Database.Database, read: (id: string) => Promise<User | null>) {
    expect(columns(sqlite)).not.toContain("pin_hash");
    const withPin = await read("with-pin");
    expect(withPin?.passwordHash).toBe("scrypt$pin");
    expect(withPin?.mustChangePassword).toBe(true);
    const noPin = await read("no-pin");
    expect(noPin?.passwordHash).toBe("scrypt$pw");
    expect(noPin?.mustChangePassword).toBe(true);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM auth_session`).get() as { n: number }).n).toBe(0);
  }

  it("createSqliteUnitOfWork turns each PIN hash into a temporary password, flags every user, ends every session and drops the column", async () => {
    const sqlite = preRetirementFile();
    const h = createSqliteUnitOfWork(sqlite);
    try {
      await expectRetired(sqlite, (id) => h.users.findById(id));
    } finally {
      sqlite.close();
    }
  });

  it("ensureUnitOfWorkSchema does the same on a SQLite SqlDb opened the way the app opens one", async () => {
    const sqlite = openSqliteConnection(preRetirementFile()).sqlite;
    try {
      const db = sqliteDb(sqlite);
      await ensureUnitOfWorkSchema(db);
      const h = createSqliteUnitOfWork(sqlite);
      await expectRetired(sqlite, (id) => h.users.findById(id));
    } finally {
      sqlite.close();
    }
  });
});
