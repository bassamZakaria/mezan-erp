import { describe, it, expect, afterEach } from "vitest";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "./unit-of-work.js";
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
  pinHash: null,
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
