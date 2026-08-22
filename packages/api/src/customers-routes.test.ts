import { describe, it, expect, afterEach } from "vitest";
import { createSqliteCustomerRepository, type SqliteCustomerRepositoryHandle } from "@mezan/persistence";
import { createCustomersRouter } from "./customers-routes.js";

const handles: SqliteCustomerRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteCustomerRepository();
  handles.push(repo);
  const app = createCustomersRouter(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const VALID_PAYLOAD = { id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة" };

describe("customers router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("sales.customer.view");
  });

  it("allows GET / with sales.customer.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "sales.customer.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects PATCH with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("customers router — CRUD", () => {
  it("creates a customer and retrieves it by id, with Money serialized as decimal strings", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "5000.50", openingBalance: "-100.25" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { creditLimit: string; openingBalance: string };
    expect(created.creditLimit).toBe("5000.500000");
    expect(created.openingBalance).toBe("-100.250000");

    const getRes = await app.fetch(req("/c1", { permissions: "sales.customer.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { id: string; code: string; etaBuyerType: string };
    expect(body).toMatchObject({ id: "c1", code: "C000001", etaBuyerType: "auto" });
  });

  it("404s for an unknown customer", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "sales.customer.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "C1" }), // missing required id/nameAr
      }),
    );
    expect(res.status).toBe(400);
  });

  it("422s a negative credit limit", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "-1.00" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("409s a duplicate customer code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.customer.create", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_PAYLOAD) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, id: "c2" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH edits a customer (e.g. deactivate) without clobbering unrelated Money fields", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "3000.00" }),
      }),
    );
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean; creditLimit: string };
    expect(body.active).toBe(false);
    expect(body.creditLimit).toBe("3000.000000");
  });

  it("PATCH can update the credit limit itself", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.customer.create", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_PAYLOAD) }));
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creditLimit: "8000.00" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { creditLimit: string }).creditLimit).toBe("8000.000000");
  });

  it("PATCH 404s an unknown customer", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
