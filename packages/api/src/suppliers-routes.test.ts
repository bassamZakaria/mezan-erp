import { describe, it, expect, afterEach } from "vitest";
import { createSqliteSupplierRepository, type SqliteSupplierRepositoryHandle } from "@mezan/persistence";
import { createSuppliersRouter } from "./suppliers-routes.js";

const handles: SqliteSupplierRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteSupplierRepository();
  handles.push(repo);
  const app = createSuppliersRouter(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const VALID_PAYLOAD = { id: "s1", code: "S000001", nameAr: "جاري" };

describe("suppliers router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("purchases.supplier.view");
  });

  it("allows GET / with purchases.supplier.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "purchases.supplier.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.supplier.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
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

describe("suppliers router — CRUD", () => {
  it("creates a supplier and retrieves it by id, with Money serialized as a decimal string", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.supplier.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, openingBalance: "1250.75", addressCity: "الإسكندرية" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { openingBalance: string; addressCity: string };
    expect(created.openingBalance).toBe("1250.750000");
    expect(created.addressCity).toBe("الإسكندرية");

    const getRes = await app.fetch(req("/s1", { permissions: "purchases.supplier.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { id: string; code: string };
    expect(body).toMatchObject({ id: "s1", code: "S000001" });
  });

  it("404s for an unknown supplier", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "purchases.supplier.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.supplier.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "S1" }), // missing required id/nameAr
      }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate supplier code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "purchases.supplier.create", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_PAYLOAD) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.supplier.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, id: "s2" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH edits a supplier (e.g. deactivate) without clobbering the opening balance", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.supplier.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, openingBalance: "750.00" }),
      }),
    );
    const res = await app.fetch(
      req("/s1", {
        method: "PATCH",
        permissions: "purchases.supplier.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean; openingBalance: string };
    expect(body.active).toBe(false);
    expect(body.openingBalance).toBe("750.000000");
  });

  it("PATCH 404s an unknown supplier", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", {
        method: "PATCH",
        permissions: "purchases.supplier.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
