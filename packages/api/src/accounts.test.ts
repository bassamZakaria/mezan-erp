import { describe, it, expect, afterEach } from "vitest";
import { createSqliteAccountRepository, type SqliteAccountRepositoryHandle } from "@mezan/persistence";
import { seedStandardChartOfAccounts } from "@mezan/domain";
import { createAccountsRouter } from "./accounts.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteAccountRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteAccountRepository();
  handles.push(repo);
  const app = createAccountsRouter(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("accounts router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("accounting.coa.view");
  });

  it("allows GET / with accounting.coa.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "accounting.coa.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with accounting.coa.manage (which implies .view via the catalog dep)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/tree", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("accounts router — CRUD", () => {
  it("creates an account and retrieves it by id, including the movements stub", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }),
      }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await app.fetch(req("/1000", { permissions: "accounting.coa.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { movementsStubbed: boolean; movements: unknown[] };
    expect(body).toMatchObject({ id: "1000", code: "1000", isHeader: true, status: "active" });
    expect(body.movementsStubbed).toBe(true);
    expect(body.movements).toEqual([]);
  });

  it("404s for an unknown account", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "accounting.coa.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "1000" }), // missing required fields
      }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate account code", async () => {
    const { app } = newApp();
    const payload = { id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true };
    await app.fetch(req("/", { method: "POST", permissions: "accounting.coa.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, id: "1000-dup" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("422s creating a detail account under a non-header parent", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1200", code: "1200", nameAr: "المخزون", type: "asset", naturalBalance: "debit", isHeader: false }),
      }),
    );
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1200-1", code: "1200-1", nameAr: "فرعي", type: "asset", naturalBalance: "debit", parentId: "1200", isHeader: false }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH edits an account (e.g. deactivate)", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1000", code: "1000", nameAr: "الأصول", type: "asset", naturalBalance: "debit", isHeader: true }),
      }),
    );
    const res = await app.fetch(
      req("/1000", {
        method: "PATCH",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("inactive");
  });

  it("PATCH 404s an unknown account", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", {
        method: "PATCH",
        permissions: "accounting.coa.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /tree returns the nested hierarchy from a seeded COA", async () => {
    const { app, repo } = newApp();
    await seedStandardChartOfAccounts(repo);
    const res = await app.fetch(req("/tree", { permissions: "accounting.coa.view" }));
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{ code: string }>;
    expect(tree.map((n) => n.code)).toEqual(["1000", "2000", "3000", "4000", "5000"]);
  });
});
