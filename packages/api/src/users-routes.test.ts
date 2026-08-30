import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "./app.js";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { createAuthContext, ALL_SCOPE } from "@mezan/domain";

const handles: SqliteUnitOfWorkHandle[] = [];
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
        body: JSON.stringify({ ...clerk, email: "next@cyag.test", roleId: null, isCompanyAdmin: true }),
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

  it("LIMITATION (D118): a caller scoped to one branch can widen their own scope to every branch", async () => {
    const { app, users, roles } = newAppWithStore(["admin.users.view", "admin.users.edit"]);
    await roles.save({
      id: "role-clerk",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: ["admin.users.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    await seedUser(users, { roleId: "role-clerk" });
    expect((await users.findById("u-scoped"))?.branchScope).toEqual(["BR-CAIRO"]);

    const widened = await app.fetch(
      new Request("http://x/users/u-scoped", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...scoped, roleId: "role-clerk", branchScope: "*", warehouseScope: "*" }),
      }),
    );

    expect(widened.status).toBe(200);
    const after = await users.findById("u-scoped");
    expect(after?.branchScope).toBe("*");
    expect(after?.warehouseScope).toBe("*");

    // Every scope-narrowing control proven elsewhere reads THIS field, so
    // widening it here defeats all of them at once. When D118 is closed the
    // edit should be refused unless the caller already holds the wider scope.
  });

  it("LIMITATION (D117): the only company admin can be demoted, leaving the tenant with none", async () => {
    const { app, users, roles } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });

    const admins = (await users.list()).filter((u) => u.isCompanyAdmin);
    expect(admins).toHaveLength(1);

    // Demoting the last one needs a role to move to, since a user must hold
    // exactly one authority — but nothing checks that an admin remains.
    await roles.save({
      id: "role-clerk",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: ["admin.users.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);

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

    expect(demoted.status).toBe(200);
    expect((await users.list()).filter((u) => u.isCompanyAdmin)).toHaveLength(0);

    // The tenant now has no company admin and no way back through the product.
  });

  it("LIMITATION (D117): the only company admin can be deactivated just as easily", async () => {
    const { app, users } = newAppWithStore();
    await seedUser(users, { id: "u-admin", isCompanyAdmin: true, email: "admin@cyag.test", branchScope: "*", warehouseScope: "*" });

    const res = await app.fetch(new Request("http://x/users/u-admin/deactivate", { method: "POST" }));
    expect(res.status).toBe(200);

    const remaining = (await users.list()).filter((u) => u.isCompanyAdmin && u.status === "active");
    expect(remaining).toHaveLength(0);
  });
});
