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
  return { app: createApp(uow, { resolveAuthContext: () => ctx }), users: uow.users };
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

describe("who may make themselves a company admin (D86)", () => {
  const clerk = {
    ...newUserBody,
    nameAr: "منى عبد الله",
    email: "mona@cyag.test",
    roleId: null,
    isCompanyAdmin: false,
  };

  it("LIMITATION (D86): a caller holding only admin.users.edit can promote a user to company admin", async () => {
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

    expect(promoted.status).toBe(200);
    expect((await users.findById("u-clerk"))?.isCompanyAdmin).toBe(true);

    // When D86 is closed, this edit should be refused unless the caller is
    // themselves a company admin — that is the expectation to rewrite.
  });

  it("LIMITATION (D86): saveUser never sees the actor, so the ceiling cannot live in the domain", async () => {
    // (command, unitOfWork, hasher, options) — there is no actor in the
    // signature, so "you may not grant more than you hold" has to be enforced
    // by the route's gate, and today no gate distinguishes the two cases.
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

    expect(promoted.status).toBe(200);
    expect((await users.findById("u-self"))?.isCompanyAdmin).toBe(true);
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
