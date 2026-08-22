import { describe, it, expect, afterEach } from "vitest";
import { createSqliteTreasuryAccountRepository, type SqliteTreasuryAccountRepositoryHandle } from "@mezan/persistence";
import { createTreasuryAccountsRoutes } from "./treasury-accounts-routes.js";

const handles: SqliteTreasuryAccountRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteTreasuryAccountRepository();
  handles.push(repo);
  const app = createTreasuryAccountsRoutes(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = { id: "ta1", code: "CASH-001", name: "صندوق نقدي", branchId: "b1" };

describe("treasury-accounts router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("treasury.account.view");
  });

  it("rejects POST / with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "treasury.account.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with treasury.account.manage", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });
});

describe("treasury-accounts router — CRUD", () => {
  it("creates a treasury account with a serialized decimal opening balance", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "treasury.account.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, openingBalance: "338.00" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { openingBalance: string };
    expect(created.openingBalance).toBe("338.000000");
  });

  it("404s for an unknown treasury account", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "treasury.account.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "CASH-001" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate treasury account code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "ta2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("422s a negative opening balance on a cash account", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, openingBalance: "-10.00" }) }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH supports 'إضافة رصيد افتتاحي' (adjusting the opening balance after creation)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/ta1", { method: "PATCH", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ openingBalance: "338.00" }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { openingBalance: string }).openingBalance).toBe("338.000000");
  });

  it("PATCH 404s an unknown treasury account", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", { method: "PATCH", permissions: "treasury.account.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" }) }),
    );
    expect(res.status).toBe(404);
  });
});
