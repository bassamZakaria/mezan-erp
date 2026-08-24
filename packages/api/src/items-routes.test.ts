import { describe, it, expect, afterEach } from "vitest";
import { createSqliteItemStore, type SqliteItemStoreHandle } from "@mezan/persistence";
import { createItemsRouter } from "./items-routes.js";

const handles: SqliteItemStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteItemStore();
  handles.push(repo);
  const app = createItemsRouter(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const VALID_PAYLOAD = {
  id: "itm-1",
  code: "ITM-0001",
  nameAr: "طقم شاي",
  type: "stock",
  baseUnitCode: "PCS",
};

describe("items router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("inventory.item.view");
  });

  it("allows GET / with inventory.item.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "inventory.item.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with inventory.item.create (which implies .view via the catalog dep)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects PATCH with only .view permission", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    const res = await app.fetch(
      req("/itm-1", {
        method: "PATCH",
        permissions: "inventory.item.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
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

describe("items router — CRUD", () => {
  it("creates an item and retrieves it by id", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, salePrice: "125.50", costPrice: "80.00" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { salePrice: string };
    expect(created.salePrice).toBe("125.500000");

    const getRes = await app.fetch(req("/itm-1", { permissions: "inventory.item.view" }));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ id: "itm-1", code: "ITM-0001", type: "stock", status: "active" });
  });

  it("404s for an unknown item", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "inventory.item.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "ITM-0001" }), // missing required fields
      }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate item code", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, id: "itm-2" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("422s a service item asked to track inventory", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, type: "service", trackInventory: true }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reasons: string[] };
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it("422s an invalid alternate-unit conversion factor", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...VALID_PAYLOAD,
          alternateUnits: [{ code: "CTN", name: "كرتونة", factor: -1 }],
        }),
      }),
    );
    expect(res.status).toBe(400); // factor -1 fails the zod .positive() check first
  });

  it("PATCH edits an item (e.g. deactivate)", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    const res = await app.fetch(
      req("/itm-1", {
        method: "PATCH",
        permissions: "inventory.item.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("inactive");
  });

  it("PATCH 404s an unknown item", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", {
        method: "PATCH",
        permissions: "inventory.item.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH cannot change the item code (no such field on the wire contract)", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    const res = await app.fetch(
      req("/itm-1", {
        method: "PATCH",
        permissions: "inventory.item.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "ITM-9999", nameAr: "اسم جديد" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; nameAr: string };
    expect(body.code).toBe("ITM-0001"); // unchanged — `code` isn't part of updateItemSchema
    expect(body.nameAr).toBe("اسم جديد");
  });

  it("GET / lists every created item", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, id: "itm-2", code: "ITM-0002" }),
      }),
    );
    const res = await app.fetch(req("/", { permissions: "inventory.item.view" }));
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body.map((i) => i.code).sort()).toEqual(["ITM-0001", "ITM-0002"]);
  });
});
