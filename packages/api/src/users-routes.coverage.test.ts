import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "./app.js";
import { createUsersRoutes } from "./users-routes.js";
import {
  createSqliteUnitOfWork,
  createSqliteSettingsStore,
  createScryptHasher,
  type SqliteUnitOfWorkHandle,
  type SqliteSettingsStoreHandle,
} from "@mezan/persistence";
import { createAuthContext, ALL_SCOPE, createDefaultSettings } from "@mezan/domain";

const uowHandles: SqliteUnitOfWorkHandle[] = [];
const settingsHandles: SqliteSettingsStoreHandle[] = [];
afterEach(() => {
  for (const h of uowHandles.splice(0)) h.close();
  for (const h of settingsHandles.splice(0)) h.close();
});

function newApp(permissions: string[] = ["*"]) {
  const uow = createSqliteUnitOfWork(":memory:");
  uowHandles.push(uow);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return { app: createApp(uow, { resolveAuthContext: () => ctx }), users: uow.users, roles: uow.roles };
}

function newAppWithSettings(permissions: string[] = ["*"]) {
  const uow = createSqliteUnitOfWork(":memory:");
  uowHandles.push(uow);
  const settingsStore = createSqliteSettingsStore();
  settingsHandles.push(settingsStore);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return {
    app: createApp(uow, { resolveAuthContext: () => ctx, settingsStore }),
    users: uow.users,
    roles: uow.roles,
    settingsStore,
  };
}

async function json(res: Response) {
  return res.json();
}

const newUserBody = {
  nameAr: "محمد الشهابي",
  nameEn: null,
  email: "mohamed@cyag.test",
  phone: "+201000000000",
  password: "TempPass123",
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
};

describe("saveUser domain invariants surfaced as 400/409/422 over HTTP", () => {
  it("400s — INVALID_USER — creating a user with an empty branch scope list", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, branchScope: [] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "INVALID_USER" });
  });

  it("409s — DUPLICATE_USER_EMAIL — creating a second user with the same email", async () => {
    const { app } = newApp();
    await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    const second = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, id: "u-second" }),
      }),
    );
    expect(second.status).toBe(409);
    expect((await json(second)) as { error: string }).toMatchObject({ error: "DUPLICATE_USER_EMAIL" });
  });

  it("422s — EMAIL_DOMAIN_NOT_ALLOWED — with Arabic refusal text — creating a user outside the tenant's allowed email domains", async () => {
    const { app, settingsStore } = newAppWithSettings();
    await settingsStore.save(createDefaultSettings({ allowedEmailDomains: ["mezan.example"] }));

    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "mohamed@outside.test" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await json(res)) as { error: string; message: string };
    expect(body.error).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
    expect(body.message).toContain("نطاق البريد الإلكتروني غير مسموح");
  });

  it("still creates a user whose email matches an allowed domain", async () => {
    const { app, settingsStore } = newAppWithSettings();
    await settingsStore.save(createDefaultSettings({ allowedEmailDomains: ["mezan.example"] }));

    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "mohamed@mezan.example" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("PUT /:id rejects a body the wire contract does not allow", () => {
  it("400s on a body missing a required field", async () => {
    const { app, users } = newApp();
    await users.save({
      id: "u-1",
      nameAr: "اسم",
      nameEn: null,
      email: "u1@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const { nameAr: _nameAr, ...withoutName } = newUserBody;
    const res = await app.fetch(
      new Request("http://x/users/u-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withoutName),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "VALIDATION_ERROR" });
  });
});

describe("deactivate/activate against an unknown user id, ahead of the outranking check", () => {
  it("404s — USER_NOT_FOUND, in Arabic — deactivating a user id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(new Request("http://x/users/does-not-exist/deactivate", { method: "POST" }));
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: string; message: string };
    expect(body.error).toBe("USER_NOT_FOUND");
    expect(body.message).toBe("المستخدم غير موجود.");
  });

  it("404s activating a user id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(new Request("http://x/users/does-not-exist/activate", { method: "POST" }));
    expect(res.status).toBe(404);
  });
});

describe("deactivate/activate refuse a caller trying to act on an account that outranks them", () => {
  it("403s deactivating an account with wider authority than the caller, and it stays active", async () => {
    const { app, users, roles } = newApp(["admin.users.view", "admin.users.deactivate"]);
    await roles.save({
      id: "role-wide",
      code: "WIDE",
      name: "واسع",
      description: "",
      permissions: ["admin.users.view", "admin.users.deactivate", "sales.invoice.confirm"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await users.save({
      id: "u-outranking",
      nameAr: "حساب أعلى صلاحية",
      nameEn: null,
      email: "wide@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: "role-wide",
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.fetch(new Request("http://x/users/u-outranking/deactivate", { method: "POST" }));
    expect(res.status).toBe(403);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "PRIVILEGE_ESCALATION_DENIED" });
    expect((await users.findById("u-outranking"))?.status).toBe("active");
  });

  it("403s activating an outranking account too", async () => {
    const { app, users, roles } = newApp(["admin.users.view", "admin.users.edit"]);
    await roles.save({
      id: "role-wide",
      code: "WIDE",
      name: "واسع",
      description: "",
      permissions: ["admin.users.view", "admin.users.edit", "sales.invoice.confirm"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await users.save({
      id: "u-outranking",
      nameAr: "حساب أعلى صلاحية",
      nameEn: null,
      email: "wide2@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: "role-wide",
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "inactive",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.fetch(new Request("http://x/users/u-outranking/activate", { method: "POST" }));
    expect(res.status).toBe(403);
    expect((await users.findById("u-outranking"))?.status).toBe("inactive");
  });
});

describe("createUsersRoutes called directly with no email-domain policy supplied at all", () => {
  it("still creates a user — an absent policy function is treated as no restriction", async () => {
    const uow = createSqliteUnitOfWork(":memory:");
    uowHandles.push(uow);
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = createUsersRoutes(uow, createScryptHasher(), () => ctx);

    const res = await app.fetch(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(res.status).toBe(201);
  });
});
