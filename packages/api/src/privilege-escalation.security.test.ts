import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "./app.js";
import { createSqliteUnitOfWork, type SqliteUnitOfWorkHandle } from "@mezan/persistence";
import { ALL_SCOPE, createAuthContext } from "@mezan/domain";

/**
 * The rule under test: a caller may never grant authority they do not
 * themselves hold, and may never write to an account whose authority exceeds
 * their own (packages/domain/src/permissions/escalation.ts).
 *
 * Every refusal is paired with a re-read of the store, and every describe
 * carries at least one grant that MUST still succeed — a rule that refuses
 * everything is not a rule, it is an outage.
 *
 * All callers share ONE unit of work: a refusal proved against a second, empty
 * database proves nothing, because the row it says was not written was never
 * there.
 */

const handles: SqliteUnitOfWorkHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function tenant() {
  const uow = createSqliteUnitOfWork(":memory:");
  handles.push(uow);
  function as(permissions: string[]) {
    const input = {
      userId: "caller",
      permissions,
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    };
    const ctx = createAuthContext(input);
    return createApp(uow, { resolveAuthContext: () => ctx });
  }
  return { as, roles: uow.roles, users: uow.users };
}

type App = ReturnType<ReturnType<typeof tenant>["as"]>;

function post(path: string, body: unknown) {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return new Request(`http://x${path}`, init);
}

function put(path: string, body: unknown) {
  const init = { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return new Request(`http://x${path}`, init);
}

/**
 * Both fixtures carry the ENH-051 acknowledgement. A wildcard role — and
 * `isCompanyAdmin`, which IS the wildcard — holds both sides of every
 * maker-checker pair, so the save is refused 409 until someone records why.
 * These tests are about ESCALATION, which is checked first and refuses 403
 * before the conflict is ever looked at; the acknowledgement only stops the
 * gate from standing in for the answer they are actually asserting.
 */
const SOD_ACK = { acknowledge: true, reason: "دور إداري في بيئة اختبار" };

async function makeRole(app: App, code: string, permissions: string[]) {
  const res = await app.fetch(post("/roles", { code, name: code, permissions, ...SOD_ACK }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; permissions: string[] };
}

function newUser(email: string, roleId: string | null, isCompanyAdmin: boolean) {
  return {
    nameAr: "كريم الشناوي",
    nameEn: null,
    email,
    phone: null,
    password: "TempPass123",
    roleId,
    isCompanyAdmin,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    ...SOD_ACK,
  };
}

async function escalationBody(res: Response) {
  return (await res.json()) as { error: string; permissions?: string[] };
}

describe("writing a role is a grant, not a curation", () => {
  it("lets a role manager create a role holding exactly what the manager holds", async () => {
    const { as, roles } = tenant();
    const role = await makeRole(as(["admin.roles.manage", "sales.invoice.view"]), "OPS", ["sales.invoice.view"]);
    expect((await roles.findById(role.id))?.permissions).toEqual(["sales.invoice.view"]);
  });

  it("refuses the wildcard to a role manager who does not hold it, and stores no role", async () => {
    const { as, roles } = tenant();
    const res = await as(["admin.roles.manage", "sales.invoice.view"]).fetch(
      post("/roles", { code: "SUPER", name: "SUPER", permissions: ["*"] }),
    );
    expect(res.status).toBe(403);
    const body = await escalationBody(res);
    expect(body.error).toBe("PRIVILEGE_ESCALATION_DENIED");
    expect(body.permissions).toEqual(["*"]);
    expect(await roles.list()).toHaveLength(0);
  });

  it("refuses a grant by its RESOLVED closure, so an implied prerequisite cannot be smuggled in", async () => {
    // sales.invoice.confirm implies sales.invoice.view_own. A caller holding
    // neither must be refused both, or the closure becomes a way to hand out a
    // permission the caller never names.
    const { as, roles } = tenant();
    const res = await as(["admin.roles.manage", "sales.invoice.view"]).fetch(
      post("/roles", { code: "OPS", name: "OPS", permissions: ["sales.invoice.confirm"] }),
    );
    expect(res.status).toBe(403);
    const body = await escalationBody(res);
    expect(body.permissions).toContain("sales.invoice.confirm");
    expect(body.permissions).toContain("sales.invoice.view_own");
    expect(await roles.list()).toHaveLength(0);
  });

  it("allows the same grant once the caller holds it, closure and all", async () => {
    const { as, roles } = tenant();
    const role = await makeRole(as(["admin.roles.manage", "sales.invoice.confirm"]), "OPS", ["sales.invoice.confirm"]);
    expect((await roles.findById(role.id))?.permissions).toEqual(["sales.invoice.confirm"]);
  });

  it("refuses to rewrite a role that already carries authority the caller lacks, and leaves it intact", async () => {
    const { as, roles } = tenant();
    const role = await makeRole(as(["*"]), "FINANCE", ["accounting.journal.post"]);

    // Stripping a permission off a role is a privilege change on every account
    // that carries it, so the BEFORE state is checked too.
    const res = await as(["admin.roles.manage", "sales.invoice.view"]).fetch(
      put(`/roles/${role.id}`, { code: "FINANCE", name: "FINANCE", permissions: ["sales.invoice.view"] }),
    );
    expect(res.status).toBe(403);
    expect((await escalationBody(res)).error).toBe("PRIVILEGE_ESCALATION_DENIED");
    expect((await roles.findById(role.id))?.permissions).toEqual(["accounting.journal.post"]);
  });

  it("still lets a tenant admin mint a wildcard role — only they hold the wildcard to give", async () => {
    const { as, roles } = tenant();
    const role = await makeRole(as(["*"]), "SUPER", ["*"]);
    expect((await roles.findById(role.id))?.permissions).toEqual(["*"]);
  });

  it("refuses a role code of * — the one shape that would turn a role into a workflow-approval bypass", async () => {
    // callerRoleCodes answers ["*"] for a tenant admin, and every workflow gate
    // treats a caller whose role codes include "*" as able to approve any step.
    // A CUSTOM role coded literally "*" would approve its own submissions. The
    // upper-snake-case contract is what stops it.
    const { as, roles } = tenant();
    const app = as(["*"]);
    for (const code of ["*", "a*", "admin*", "*ADMIN", ""]) {
      const res = await app.fetch(post("/roles", { code, name: "x", permissions: [] }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
    }
    expect(await roles.list()).toHaveLength(0);
  });

  it("refuses a permission code the catalogue does not define, and writes no role at all", async () => {
    const { as, roles } = tenant();
    const res = await as(["*"]).fetch(
      post("/roles", { code: "OPS", name: "x", permissions: ["sales.invoice.view", "sales.invoice.superpower"] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("UNKNOWN_PERMISSION");
    // Not partially written: the valid code in the same array is not stored either.
    expect(await roles.list()).toHaveLength(0);
  });

  it("refuses to delete a role that is still assigned, so nobody is silently stripped of their authority", async () => {
    const { as, roles, users } = tenant();
    const app = as(["*"]);
    const role = await makeRole(app, "OPS", ["sales.invoice.view"]);
    expect((await app.fetch(post("/users", newUser("k@shop.test", role.id, false)))).status).toBe(201);

    const del = await app.fetch(new Request(`http://x/roles/${role.id}`, { method: "DELETE" }));
    expect(del.status).toBe(409);
    expect(await roles.findById(role.id)).not.toBeNull();
    expect((await users.list())[0]?.roleId).toBe(role.id);
  });
});

describe("creating an account is a grant too", () => {
  it("refuses isCompanyAdmin to a caller who is not a tenant admin, and creates nobody", async () => {
    const { as, users } = tenant();
    const res = await as(["admin.users.create", "admin.users.view"]).fetch(
      post("/users", newUser("k@shop.test", null, true)),
    );
    expect(res.status).toBe(403);
    const body = await escalationBody(res);
    expect(body.error).toBe("PRIVILEGE_ESCALATION_DENIED");
    expect(body.permissions).toEqual(["*"]);
    expect(await users.list()).toHaveLength(0);
  });

  it("refuses an account placed on a role the caller could not have written, and creates nobody", async () => {
    const { as, users } = tenant();
    const strong = await makeRole(as(["*"]), "FINANCE", ["accounting.journal.post"]);
    const res = await as(["admin.users.create", "sales.invoice.view"]).fetch(
      post("/users", newUser("k@shop.test", strong.id, false)),
    );
    expect(res.status).toBe(403);
    expect((await escalationBody(res)).permissions).toContain("accounting.journal.post");
    expect(await users.list()).toHaveLength(0);
  });

  it("still creates a peer — an account on a role the caller holds in full", async () => {
    const { as, users } = tenant();
    const peer = await makeRole(as(["*"]), "CLERK", ["sales.invoice.view"]);
    const res = await as(["admin.users.create", "sales.invoice.view"]).fetch(
      post("/users", newUser("k@shop.test", peer.id, false)),
    );
    expect(res.status).toBe(201);
    expect((await users.list())[0]?.roleId).toBe(peer.id);
  });

  it("reads the granted authority from the ROLE STORE, so a request naming an unknown role id creates nothing", async () => {
    const { as, users } = tenant();
    const res = await as(["admin.users.create", "sales.invoice.view"]).fetch(
      post("/users", newUser("k@shop.test", "role-that-does-not-exist", false)),
    );
    expect(res.status).toBe(400);
    expect(await users.list()).toHaveLength(0);
  });
});

describe("editing an account the caller does not outrank", () => {
  async function seeded() {
    const t = tenant();
    const admin = t.as(["*"]);
    const clerk = await makeRole(admin, "CLERK", ["sales.invoice.view"]);
    const finance = await makeRole(admin, "FINANCE", ["accounting.journal.post"]);
    const peer = await admin.fetch(post("/users", newUser("peer@shop.test", clerk.id, false)));
    const boss = await admin.fetch(post("/users", newUser("boss@shop.test", null, true)));
    expect(peer.status).toBe(201);
    expect(boss.status).toBe(201);
    const peerId = ((await peer.json()) as { id: string }).id;
    const bossId = ((await boss.json()) as { id: string }).id;
    return { as: t.as, users: t.users, clerk, finance, peerId, bossId };
  }

  it("refuses to move an account onto a role the editor could not have written, leaving the assignment intact", async () => {
    const { as, users, clerk, finance, peerId } = await seeded();
    const res = await as(["admin.users.edit", "sales.invoice.view"]).fetch(
      put(`/users/${peerId}`, { ...newUser("peer@shop.test", finance.id, false), password: undefined }),
    );
    expect(res.status).toBe(403);
    expect((await escalationBody(res)).permissions).toContain("accounting.journal.post");
    expect((await users.findById(peerId))?.roleId).toBe(clerk.id);
  });

  it("refuses any write against a company admin, so a helpdesk tier cannot reset the owner password", async () => {
    const { as, users, bossId } = await seeded();
    const before = await users.findById(bossId);
    const res = await as(["admin.users.edit", "sales.invoice.view"]).fetch(
      put(`/users/${bossId}`, { ...newUser("boss@shop.test", null, true), password: "Taken0ver!" }),
    );
    expect(res.status).toBe(403);
    expect((await escalationBody(res)).error).toBe("PRIVILEGE_ESCALATION_DENIED");
    const stored = await users.findById(bossId);
    expect(stored?.isCompanyAdmin).toBe(true);
    expect(stored?.passwordHash).toBe(before?.passwordHash);
  });

  it("still edits a PEER, including resetting their password — that is the job the permission exists for", async () => {
    const { as, users, clerk, peerId } = await seeded();
    const before = await users.findById(peerId);
    const res = await as(["admin.users.edit", "sales.invoice.view"]).fetch(
      put(`/users/${peerId}`, { ...newUser("peer@shop.test", clerk.id, false), password: "ResetPass123" }),
    );
    expect(res.status).toBe(200);
    const stored = await users.findById(peerId);
    expect(stored?.passwordHash).not.toBe(before?.passwordHash);
    expect(stored?.mustChangePassword).toBe(true);
  });

  it("404s a PUT against an unknown id rather than creating that account behind a caller-chosen id", async () => {
    const { as, users } = await seeded();
    const before = (await users.list()).length;
    const res = await as(["*"]).fetch(
      put("/users/not-a-real-user", { ...newUser("ghost@shop.test", null, true), password: undefined }),
    );
    expect(res.status).toBe(404);
    expect((await users.list()).length).toBe(before);
  });

  it("keeps createdAt across an edit, so an edited account cannot be made to look new", async () => {
    const { as, users, clerk, peerId } = await seeded();
    const original = (await users.findById(peerId))?.createdAt;
    expect(original).toBeTruthy();
    const body = { ...newUser("peer@shop.test", clerk.id, false), nameAr: "كريم المعدل", password: undefined };
    const res = await as(["*"]).fetch(put(`/users/${peerId}`, body));
    expect(res.status).toBe(200);
    expect((await users.findById(peerId))?.createdAt).toBe(original);
  });

  it("refuses to deactivate an account that outranks the caller, and the account stays active", async () => {
    const { as, users, bossId } = await seeded();
    const res = await as(["admin.users.deactivate", "sales.invoice.view"]).fetch(
      post(`/users/${bossId}/deactivate`, {}),
    );
    expect(res.status).toBe(403);
    expect((await users.findById(bossId))?.status).toBe("active");
  });

  it("still deactivates a peer", async () => {
    const { as, users, peerId } = await seeded();
    const res = await as(["admin.users.deactivate", "sales.invoice.view"]).fetch(
      post(`/users/${peerId}/deactivate`, {}),
    );
    expect(res.status).toBe(200);
    expect((await users.findById(peerId))?.status).toBe("inactive");
  });
});
