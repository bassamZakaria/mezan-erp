import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "./app.js";
import type { UserEmailChange } from "./users-routes.js";
import { createSqliteUnitOfWork, createSqliteSettingsStore, type SqliteSettingsStoreHandle, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { createAuthContext, createDefaultSettings, createEntitlements, ALL_SCOPE } from "@mezan/domain";

const handles: (SqliteUnitOfWorkHandle | SqliteSettingsStoreHandle)[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp(permissions: string[] = ["*"]) {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return createApp(uow, { resolveAuthContext: () => ctx });
}

function newAppWithStore(permissions: string[] = ["*"]) {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return { app: createApp(uow, { resolveAuthContext: () => ctx }), users: uow.users, roles: uow.roles };
}

/** The same store, but the CALLER is confined to one branch and one warehouse. */
function newAppScoped(
  permissions: string[],
  branchScope: readonly string[] | typeof ALL_SCOPE,
  warehouseScope: readonly string[] | typeof ALL_SCOPE,
) {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope, warehouseScope });
  return { app: createApp(uow, { resolveAuthContext: () => ctx }), users: uow.users, roles: uow.roles };
}

async function json(res: Response) {
  return res.json();
}

/**
 * A company-admin grant IS the wildcard, so it trips every segregation-of-duties
 * pair at once (ENH-051) and the route refuses it until someone records why.
 * These tests are about the seat, not about the gate — the gate has its own
 * describe below — so they carry the acknowledgement a real admin would tick.
 */
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
  acknowledge: true,
  reason: "مدير المنشأة",
};

describe("users routes", () => {
  it("creates a user without leaking the password hash, then lists it", async () => {
    const app = newApp();
    const createRes = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as Record<string, unknown>;
    expect(created.passwordHash).toBeUndefined();
    expect(created.pinHash).toBeUndefined();
    expect(created.hasPin).toBe(false);

    const listRes = await app.fetch(new Request("http://x/users"));
    expect(((await json(listRes)) as unknown[]).length).toBe(1);
  });

  it("rejects a user with an unknown role", async () => {
    const app = newApp();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, isCompanyAdmin: false, roleId: "ghost", branchScope: ["MAIN"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "UNKNOWN_ROLE" });
  });

  it("rejects malformed input (contract-level) with 400", async () => {
    const app = newApp();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("deactivates then reactivates a user", async () => {
    const app = newApp();
    // Two admins on purpose: deactivating the LAST active company admin is
    // refused (D117), and this test is about the status transition itself.
    await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "keeper@cyag.test" }),
      }),
    );
    const createRes = await app.fetch(
      new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newUserBody) }),
    );
    const created = (await json(createRes)) as { id: string };

    const deactivateRes = await app.fetch(new Request(`http://x/users/${created.id}/deactivate`, { method: "POST" }));
    expect(deactivateRes.status).toBe(200);
    expect(((await json(deactivateRes)) as { status: string }).status).toBe("inactive");

    const activateRes = await app.fetch(new Request(`http://x/users/${created.id}/activate`, { method: "POST" }));
    expect(((await json(activateRes)) as { status: string }).status).toBe("active");
  });

  it("denies access without admin.users.view", async () => {
    const app = newApp([]);
    const res = await app.fetch(new Request("http://x/users"));
    expect(res.status).toBe(403);
  });

  it("keeps the password hash stable across an update that omits password", async () => {
    const { app, users } = newAppWithStore();
    const createRes = await app.fetch(
      new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newUserBody) }),
    );
    const created = (await json(createRes)) as { id: string };
    const hashBefore = (await users.findById(created.id))?.passwordHash;
    expect(hashBefore).toBeTruthy();

    const { password: _password, ...withoutPassword } = newUserBody;
    const updateRes = await app.fetch(
      new Request(`http://x/users/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...withoutPassword, nameAr: "محمد الشهابي (محدث)", nameEn: null }),
      }),
    );
    expect(updateRes.status).toBe(200);
    expect(((await json(updateRes)) as { nameAr: string }).nameAr).toBe("محمد الشهابي (محدث)");
    expect((await users.findById(created.id))?.passwordHash).toBe(hashBefore);
  });
});

describe("seat cap (A3: seat, branch and warehouse caps)", () => {
  function newAppWithSeats(seats: number) {
    const uow = createSqliteUnitOfWork(":memory:");
    handles.push(uow);
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const resolveEntitlements = () =>
      createEntitlements({ plan: "core", activeModules: [], features: {}, seats, expiresAt: null });
    return { app: createApp(uow, { resolveAuthContext: () => ctx, resolveEntitlements }), users: uow.users };
  }

  it("refuses POST /users past the seat cap with SEAT_LIMIT_REACHED", async () => {
    const { app } = newAppWithSeats(1);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);

    const second = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "second@cyag.test" }),
      }),
    );
    expect(second.status).toBe(409);
    expect((await json(second)) as { error: string }).toMatchObject({
      error: "SEAT_LIMIT_REACHED",
      message: "وصلتم إلى الحد الأقصى للمستخدمين في باقتكم",
    });
  });

  it("allows POST /users when seats have room", async () => {
    const { app } = newAppWithSeats(2);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);

    const second = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newUserBody, email: "second@cyag.test" }),
      }),
    );
    expect(second.status).toBe(201);
  });

  it("does not count an inactive user against the seat cap", async () => {
    const { app, users } = newAppWithSeats(1);
    await users.save({
      id: "u-inactive",
      nameAr: "غير نشط",
      nameEn: null,
      email: "inactive@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: true,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "inactive",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(res.status).toBe(201);
  });

  async function seedInactiveUser(users: ReturnType<typeof newAppWithSeats>["users"], id: string, email: string) {
    await users.save({
      id,
      nameAr: "غير نشط",
      nameEn: null,
      email,
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "inactive",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
  }

  it("refuses POST /users/:id/activate past the seat cap, and leaves the account inactive", async () => {
    const { app, users } = newAppWithSeats(1);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);
    await seedInactiveUser(users, "u-inactive-1", "inactive1@cyag.test");

    const res = await app.fetch(new Request("http://x/users/u-inactive-1/activate", { method: "POST" }));
    expect(res.status).toBe(409);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "SEAT_LIMIT_REACHED" });
    expect((await users.findById("u-inactive-1"))?.status).toBe("inactive");
  });

  it("allows POST /users/:id/activate when seats have room", async () => {
    const { app, users } = newAppWithSeats(2);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);
    await seedInactiveUser(users, "u-inactive-2", "inactive2@cyag.test");

    const res = await app.fetch(new Request("http://x/users/u-inactive-2/activate", { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await users.findById("u-inactive-2"))?.status).toBe("active");
  });

  it("refuses a PUT that reactivates an inactive user past the seat cap, and leaves them inactive", async () => {
    const { app, users } = newAppWithSeats(1);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);
    await seedInactiveUser(users, "u-inactive-3", "inactive3@cyag.test");

    const res = await app.fetch(
      new Request("http://x/users/u-inactive-3", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...newUserBody,
          email: "inactive3@cyag.test",
          isCompanyAdmin: true,
          roleId: null,
          status: "active",
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "SEAT_LIMIT_REACHED" });
    expect((await users.findById("u-inactive-3"))?.status).toBe("inactive");
  });

  it("a PUT that keeps a user inactive is unaffected by the seat cap", async () => {
    const { app, users } = newAppWithSeats(1);
    const first = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newUserBody),
      }),
    );
    expect(first.status).toBe(201);
    await seedInactiveUser(users, "u-inactive-4", "inactive4@cyag.test");

    const res = await app.fetch(
      new Request("http://x/users/u-inactive-4", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...newUserBody,
          email: "inactive4@cyag.test",
          isCompanyAdmin: true,
          roleId: null,
          status: "inactive",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await users.findById("u-inactive-4"))?.status).toBe("inactive");
  });
});

describe("who may make themselves a company admin (D86 — closed by PR #54, S2)", () => {
  const clerk = {
    ...newUserBody,
    nameAr: "منى عبد الله",
    email: "mona@cyag.test",
    roleId: null,
    isCompanyAdmin: false,
  };

  it("refuses a caller holding only admin.users.edit who tries to promote a user to company admin", async () => {
    // The caller is NOT an admin: they hold exactly the two codes the edit
    // route gates on, and nothing else.
    const { app, users } = newAppWithStore(["admin.users.view", "admin.users.edit"]);

    const created = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clerk, id: "u-clerk" }),
      }),
    );
    // Creating needs its own permission, which this caller does not hold.
    expect(created.status).toBe(403);

    // But EDITING does not check what the editor themselves holds. Seed the
    // user directly, then edit it up to company admin over HTTP.
    await users.save({
      id: "u-clerk",
      nameAr: "منى عبد الله",
      nameEn: null,
      email: "mona@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const promoted = await app.fetch(
      new Request("http://x/users/u-clerk", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clerk, roleId: null, isCompanyAdmin: true }),
      }),
    );

    // D86 is closed: a caller may not grant authority they do not hold, and
    // `isCompanyAdmin: true` is the wildcard by another name. Only a tenant
    // admin has `"*"` to give.
    expect(promoted.status).toBe(403);
    expect(((await promoted.json()) as { error: string }).error).toBe("PRIVILEGE_ESCALATION_DENIED");
    // And the refusal is a refusal to WRITE, not only to answer: re-read the
    // store. A 403 that still promoted the account would be the same defect
    // with a different status code on it.
    expect((await users.findById("u-clerk"))?.isCompanyAdmin).toBe(false);
  });

  it("refuses the shortest path of all — the caller editing THEIR OWN record up to company admin", async () => {
    // `saveUser(command, unitOfWork, hasher, options)` still has no actor in
    // its signature, so the domain cannot enforce this and never could. The
    // ceiling lives in the route, in `refuseIfEscalating`, which is why this
    // test drives it over HTTP rather than calling the domain directly.
    const { app, users } = newAppWithStore(["admin.users.view", "admin.users.edit"]);
    await users.save({
      id: "u-self",
      nameAr: "المستخدم نفسه",
      nameEn: null,
      email: "self@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // The caller edits THEIR OWN record — the shortest path in the product.
    const promoted = await app.fetch(
      new Request("http://x/users/u-self", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...clerk,
          email: "self@cyag.test",
          roleId: null,
          isCompanyAdmin: true,
        }),
      }),
    );

    expect(promoted.status).toBe(403);
    expect((await users.findById("u-self"))?.isCompanyAdmin).toBe(false);
  });

  it("still lets a clerk edit a PEER — the job the permission exists for (negative control)", async () => {
    // Without this, every assertion above is satisfied by a guard that refuses
    // all edits, which would break user administration rather than secure it.
    const { app, users, roles } = newAppWithStore(["admin.users.view", "admin.users.edit"]);
    // An account carries exactly one authority: a role OR the admin flag. The
    // peer therefore needs a role, and it must be one the clerk could itself
    // grant — otherwise this would be testing the outranking guard rather than
    // the ordinary edit it is meant to prove still works.
    await roles.save({
      id: "role-peer",
      code: "PEER",
      name: "زميل",
      description: "",
      permissions: ["admin.users.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await users.save({
      id: "u-peer",
      nameAr: "زميل",
      nameEn: null,
      email: "peer@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: "role-peer",
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const edited = await app.fetch(
      new Request("http://x/users/u-peer", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...clerk,
          nameAr: "زميل معدَّل",
          email: "peer@cyag.test",
          roleId: "role-peer",
          isCompanyAdmin: false,
        }),
      }),
    );

    expect(edited.status).toBe(200);
    expect((await users.findById("u-peer"))?.nameAr).toBe("زميل معدَّل");
  });

  it("a tenant admin CAN still mint another tenant admin — somebody has to be able to", async () => {
    const { app, users } = newAppWithStore(["*"]);
    await users.save({
      id: "u-next",
      nameAr: "المدير التالي",
      nameEn: null,
      email: "next@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const promoted = await app.fetch(
      new Request("http://x/users/u-next", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clerk, email: "next@cyag.test", roleId: null, isCompanyAdmin: true, acknowledge: true, reason: "مدير المنشأة" }),
      }),
    );

    expect(promoted.status).toBe(200);
    expect((await users.findById("u-next"))?.isCompanyAdmin).toBe(true);
  });

  it("still refuses the caller with no user permissions at all", async () => {
    const { app } = newAppWithStore(["sales.invoice.view"]);
    const res = await app.fetch(
      new Request("http://x/users/u-any", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clerk, isCompanyAdmin: true }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("still enforces the one-authority rule: a role AND company admin together is refused", async () => {
    const { app } = newAppWithStore();
    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clerk, id: "u-both", roleId: "role-x", isCompanyAdmin: true }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("scope self-widening and the last admin (D118, D117)", () => {
  const scoped = {
    ...newUserBody,
    nameAr: "منى عبد الله",
    email: "mona@cyag.test",
    roleId: null,
    isCompanyAdmin: false,
  };

  async function seedUser(
    users: ReturnType<typeof newAppWithStore>["users"],
    overrides: Record<string, unknown> = {},
  ) {
    await users.save({
      id: "u-scoped",
      nameAr: "منى عبد الله",
      nameEn: null,
      email: "mona@cyag.test",
      phone: null,
      passwordHash: "hashed:x",
      pinHash: null,
      roleId: null,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: ["BR-CAIRO"],
      warehouseScope: ["WH-MAIN"],
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    } as never);
  }

  async function clerkRole(roles: ReturnType<typeof newAppWithStore>["roles"]) {
    await roles.save({
      id: "role-clerk",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: ["admin.users.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
  }

  it("D118: a caller confined to one branch cannot widen a scope to every branch", async () => {
    const { app, users, roles } = newAppScoped(["admin.users.view", "admin.users.edit"], ["BR-CAIRO"], ["WH-MAIN"]);
    await clerkRole(roles);
    await seedUser(users, { roleId: "role-clerk" });
    expect((await users.findById("u-scoped"))?.branchScope).toEqual(["BR-CAIRO"]);

    const widened = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...scoped, roleId: "role-clerk", branchScope: "*", warehouseScope: "*" }),
      }),
    );

    expect(widened.status).toBe(403);
    expect((await widened.json()) as { error: string }).toMatchObject({ error: "PRIVILEGE_ESCALATION_DENIED" });

    // Every scope-narrowing control proven elsewhere reads THIS field, so a 403
    // that still wrote it would defeat all of them at once.
    const after = await users.findById("u-scoped");
    expect(after?.branchScope).toEqual(["BR-CAIRO"]);
    expect(after?.warehouseScope).toEqual(["WH-MAIN"]);
  });

  it("D118: naming a branch the caller does not hold is refused just as an explicit list", async () => {
    const { app, users, roles } = newAppScoped(["admin.users.view", "admin.users.edit"], ["BR-CAIRO"], ["WH-MAIN"]);
    await clerkRole(roles);
    await seedUser(users, { roleId: "role-clerk" });

    const res = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          roleId: "role-clerk",
          branchScope: ["BR-CAIRO", "BR-ALEX"],
          warehouseScope: ["WH-MAIN"],
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()) as { scopes: string[] }).toMatchObject({ scopes: ["branch:BR-ALEX"] });
    expect((await users.findById("u-scoped"))?.branchScope).toEqual(["BR-CAIRO"]);
  });

  it("D118: the warehouse dimension is guarded too, not just the branch", async () => {
    const { app, users, roles } = newAppScoped(["admin.users.view", "admin.users.edit"], ["BR-CAIRO"], ["WH-MAIN"]);
    await clerkRole(roles);
    await seedUser(users, { roleId: "role-clerk" });

    const res = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...scoped, roleId: "role-clerk", branchScope: ["BR-CAIRO"], warehouseScope: "*" }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await users.findById("u-scoped"))?.warehouseScope).toEqual(["WH-MAIN"]);
  });

  it("D118 negative control: a caller with `*` scope may still set another user's scope to `*`", async () => {
    const { app, users, roles } = newAppScoped(["admin.users.view", "admin.users.edit"], ALL_SCOPE, ALL_SCOPE);
    await clerkRole(roles);
    await seedUser(users, { roleId: "role-clerk" });

    const res = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...scoped, roleId: "role-clerk", branchScope: "*", warehouseScope: "*" }),
      }),
    );

    expect(res.status).toBe(200);
    const after = await users.findById("u-scoped");
    expect(after?.branchScope).toBe("*");
    expect(after?.warehouseScope).toBe("*");
  });

  it("D118 negative control: a scoped caller may still edit within the scope they hold", async () => {
    const { app, users, roles } = newAppScoped(["admin.users.view", "admin.users.edit"], ["BR-CAIRO", "BR-ALEX"], ["WH-MAIN"]);
    await clerkRole(roles);
    await seedUser(users, { roleId: "role-clerk" });

    const res = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          roleId: "role-clerk",
          nameAr: "منى عبد الله المصري",
          branchScope: ["BR-ALEX"],
          warehouseScope: ["WH-MAIN"],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const after = await users.findById("u-scoped");
    expect(after?.branchScope).toEqual(["BR-ALEX"]);
    expect(after?.nameAr).toBe("منى عبد الله المصري");
  });

  it("D118: the same guard holds on CREATE — a scoped caller cannot mint a `*`-scoped account", async () => {
    const { app, users, roles } = newAppScoped(
      ["admin.users.view", "admin.users.create"],
      ["BR-CAIRO"],
      ["WH-MAIN"],
    );
    await clerkRole(roles);

    const res = await app.fetch(
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          id: "u-new",
          email: "new@cyag.test",
          password: "TempPass123",
          roleId: "role-clerk",
          branchScope: "*",
          warehouseScope: "*",
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(await users.findByEmail("new@cyag.test")).toBeNull();
  });

  it("D117: demoting the ONLY company admin is refused, and the admin flag survives", async () => {
    const { app, users, roles } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });
    await clerkRole(roles);

    expect((await users.list()).filter((u) => u.isCompanyAdmin)).toHaveLength(1);

    const demoted = await app.fetch(
      new Request("http://x/users/u-admin", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          email: "admin@cyag.test",
          roleId: "role-clerk",
          isCompanyAdmin: false,
          branchScope: "*",
          warehouseScope: "*",
        }),
      }),
    );

    expect(demoted.status).toBe(409);
    expect((await demoted.json()) as { error: string }).toMatchObject({ error: "LAST_COMPANY_ADMIN" });

    // A 409 that still wrote the demotion would lock the shop out just the same.
    const after = await users.findById("u-admin");
    expect(after?.isCompanyAdmin).toBe(true);
    expect(after?.roleId).toBeNull();
    expect((await users.list()).filter((u) => u.isCompanyAdmin)).toHaveLength(1);
  });

  it("D117: deactivating the ONLY company admin is refused, and they stay active", async () => {
    const { app, users } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });

    const res = await app.fetch(new Request("http://x/users/u-admin/deactivate", { method: "POST" }));

    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "LAST_COMPANY_ADMIN" });
    expect((await users.findById("u-admin"))?.status).toBe("active");
    expect((await users.list()).filter((u) => u.isCompanyAdmin && u.status === "active")).toHaveLength(1);
  });

  it("D117: setting the last admin's status to inactive through PUT is refused as well", async () => {
    const { app, users } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });

    const res = await app.fetch(
      new Request("http://x/users/u-admin", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          email: "admin@cyag.test",
          roleId: null,
          isCompanyAdmin: true,
          status: "inactive",
          branchScope: "*",
          warehouseScope: "*",
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect((await users.findById("u-admin"))?.status).toBe("active");
  });

  it("D117 negative control: a NON-last admin can still be deactivated and demoted", async () => {
    const { app, users, roles } = newAppWithStore();
    await clerkRole(roles);
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });
    await seedUser(users, { id: "u-admin-2", isCompanyAdmin: true, email: "admin2@cyag.test", branchScope: "*", warehouseScope: "*" });

    const deactivated = await app.fetch(new Request("http://x/users/u-admin-2/deactivate", { method: "POST" }));
    expect(deactivated.status).toBe(200);
    expect((await users.findById("u-admin-2"))?.status).toBe("inactive");

    // u-admin is now the only ACTIVE admin, so demoting it must be refused —
    // an inactive admin is not a way back into the books.
    const demoted = await app.fetch(
      new Request("http://x/users/u-admin", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          email: "admin@cyag.test",
          roleId: "role-clerk",
          isCompanyAdmin: false,
          branchScope: "*",
          warehouseScope: "*",
        }),
      }),
    );
    expect(demoted.status).toBe(409);
    expect((await users.findById("u-admin"))?.isCompanyAdmin).toBe(true);
  });

  it("D117 negative control: deactivating a plain user is untouched by the guard", async () => {
    const { app, users } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });
    await seedUser(users);

    const res = await app.fetch(new Request("http://x/users/u-scoped/deactivate", { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await users.findById("u-scoped"))?.status).toBe("inactive");
  });

  it("D117: an admin who is ALREADY inactive can be demoted — the guard counts active admins only", async () => {
    const { app, users, roles } = newAppWithStore();
    await clerkRole(roles);
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });
    await seedUser(users, {
      id: "u-old-admin",
      isCompanyAdmin: true,
      status: "inactive",
      email: "old@cyag.test",
      branchScope: "*",
      warehouseScope: "*",
    });

    const res = await app.fetch(
      new Request("http://x/users/u-old-admin", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...scoped,
          email: "old@cyag.test",
          roleId: "role-clerk",
          isCompanyAdmin: false,
          status: "inactive",
          branchScope: "*",
          warehouseScope: "*",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect((await users.findById("u-old-admin"))?.isCompanyAdmin).toBe(false);
  });
});

describe("ENH-051 — the segregation-of-duties gate on a user's grant", () => {
  const adminGrant = { ...newUserBody, acknowledge: undefined, reason: undefined };

  function post(app: ReturnType<typeof newApp>, body: unknown) {
    return app.fetch(
      new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  }

  it("refuses a company-admin grant with 409 SOD_CONFLICT, naming every pair it trips in Arabic", async () => {
    const res = await post(newApp(), adminGrant);
    expect(res.status).toBe(409);
    const body = (await json(res)) as { error: string; conflicts: { ruleId: string; labelAr: string }[] };
    expect(body.error).toBe("SOD_CONFLICT");
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts.every((c) => c.labelAr.trim() !== "")).toBe(true);
  });

  it("treats a tick with no reason as no acknowledgement — the reason IS the record", async () => {
    const res = await post(newApp(), { ...adminGrant, acknowledge: true });
    expect(res.status).toBe(409);
  });

  it("grants the seat once the conflict is acknowledged with a reason", async () => {
    const res = await post(newApp(), newUserBody);
    expect(res.status).toBe(201);
  });

  /**
   * INVARIANT the route depends on: a refusal the caller CAN acknowledge past
   * must never come first. A 409 asking for an override, in front of a 422 no
   * override can satisfy, makes an audited override the price of discovering
   * the address was never allowed.
   */
  it("answers the domain policy before the conflict, when a request breaks both", async () => {
    const uow = createSqliteUnitOfWork(":memory:");
    const settingsStore = createSqliteSettingsStore() as SqliteSettingsStoreHandle;
    handles.push(uow, settingsStore);
    await settingsStore.save(createDefaultSettings({ allowedEmailDomains: ["cyag.test"] }));
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = createApp(uow, { settingsStore, resolveAuthContext: () => ctx });

    const outside = await post(app, { ...adminGrant, email: "someone@gmail.com" });
    expect(outside.status).toBe(422);
    expect(((await json(outside)) as { error: string }).error).toBe("EMAIL_DOMAIN_NOT_ALLOWED");

    const inside = await post(app, newUserBody);
    expect(inside.status).toBe(201);
  });
});

describe("announcing an email change", () => {
  function appWithAnnouncer(options: { failCommit?: () => boolean; announcerThrows?: boolean } = {}) {
    const uow = createSqliteUnitOfWork(":memory:");
    handles.push(uow);
    const commits = Object.create(uow) as typeof uow;
    commits.transaction = (fn) =>
      uow.transaction(async (tx) => {
        const result = await fn(tx);
        if (options.failCommit?.()) throw new Error("the commit failed after the row was written");
        return result;
      });
    const announced: UserEmailChange[] = [];
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = createApp(commits, {
      resolveAuthContext: () => ctx,
      onUserEmailChanged: async (change) => {
        announced.push(change);
        if (options.announcerThrows) throw new Error("the platform is down");
      },
    });
    return { app, announced, users: uow.users };
  }

  async function createdUser(app: ReturnType<typeof newApp>) {
    const res = await app.fetch(new Request("http://x/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newUserBody) }));
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown>;
  }

  const rename = (app: ReturnType<typeof newApp>, user: Record<string, unknown>, email: string) =>
    app.fetch(new Request(`http://x/users/${String(user["id"])}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...user, email }) }));

  it("announces the change once, after the save, naming who made it", async () => {
    const { app, announced } = appWithAnnouncer();
    const user = await createdUser(app);

    expect((await rename(app, user, "moved@cyag.test")).status).toBe(200);

    expect(announced).toEqual([{ userId: user["id"], before: "mohamed@cyag.test", after: "moved@cyag.test", actorId: "u1" }]);
  });

  it("announces nothing when the save's transaction fails after the row was written", async () => {
    let failing = false;
    const { app, announced, users } = appWithAnnouncer({ failCommit: () => failing });
    const user = await createdUser(app);

    failing = true;
    const res = await rename(app, user, "moved@cyag.test");

    expect(res.status).toBe(500);
    expect(announced).toEqual([]);
    expect((await users.findById(String(user["id"])))?.email).toBe("mohamed@cyag.test");
  });

  it("keeps the saved change and answers 200 when the announcement itself fails", async () => {
    const { app, users } = appWithAnnouncer({ announcerThrows: true });
    const user = await createdUser(app);

    expect((await rename(app, user, "moved@cyag.test")).status).toBe(200);
    expect((await users.findById(String(user["id"])))?.email).toBe("moved@cyag.test");
  });

  it("announces nothing for an edit that leaves the email alone", async () => {
    const { app, announced } = appWithAnnouncer();
    const user = await createdUser(app);

    expect((await rename(app, { ...user, phone: "+201111111111" }, "mohamed@cyag.test")).status).toBe(200);
    expect(announced).toEqual([]);
  });
});

