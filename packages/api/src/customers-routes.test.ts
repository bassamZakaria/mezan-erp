import { describe, it, expect, afterEach } from "vitest";
import { createSqliteCustomerRepository, type SqliteCustomerRepositoryHandle } from "@mezan/persistence";
import { Money } from "@mezan/domain";
import { createCustomersRouter } from "./customers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteCustomerRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteCustomerRepository();
  handles.push(repo);
  const app = createCustomersRouter(repo, insecureHeaderAuthContextResolver);
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

/**
 * guards B-2 — the opening balance was stored master data and nothing else:
 * never posted, added into this KPI and the browser statement, invisible to
 * `/reconciliation` and to the aging ladder. One fact, three figures.
 */
describe("customers router — the opening balance is posted, not counted twice", () => {
  function newAppWithPoster(outstanding: ReadonlyMap<string, string> = new Map()) {
    const repo = createSqliteCustomerRepository();
    handles.push(repo);
    const posted: { id: string; openingBalance: string }[] = [];
    const app = createCustomersRouter(
      repo,
      insecureHeaderAuthContextResolver,
      undefined,
      undefined,
      {
        outstandingByCustomer: async () =>
          new Map([...outstanding].map(([id, amount]) => [id, Money.fromMajor(amount)])),
      },
      { post: async (party) => void posted.push({ id: party.id, openingBalance: party.openingBalance.toString() }) },
    );
    return { app, repo, posted };
  }

  const create = (app: ReturnType<typeof newAppWithPoster>["app"], body: unknown) =>
    app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("posts the opening balance to the ledger when a customer is created", async () => {
    const { app, posted } = newAppWithPoster();
    expect((await create(app, { ...VALID_PAYLOAD, openingBalance: "5000.00" })).status).toBe(201);
    expect(posted).toEqual([{ id: "c1", openingBalance: "5000.000000" }]);
  });

  it("re-posts only when the opening balance actually changes", async () => {
    const { app, posted } = newAppWithPoster();
    await create(app, { ...VALID_PAYLOAD, openingBalance: "5000.00" });

    const patch = (body: unknown) =>
      app.fetch(
        req("/c1", {
          method: "PATCH",
          permissions: "sales.customer.edit",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await patch({ nameAr: "اسم آخر" })).status).toBe(200);
    expect(posted).toHaveLength(1);

    expect((await patch({ openingBalance: "7500.00" })).status).toBe(200);
    expect(posted).toHaveLength(2);
    expect(posted[1]!.openingBalance).toBe("7500.000000");
  });

  it("no longer adds the opening balance on top of the ledger's own receivable", async () => {
    const { app } = newAppWithPoster(new Map([["c1", "1200.00"]]));
    await create(app, { ...VALID_PAYLOAD, openingBalance: "5000.00" });

    const res = await app.fetch(req("/stats", { permissions: "sales.customer.view" }));
    expect(res.status).toBe(200);
    // 1,200.00 of live invoices — NOT 6,200.00. The 5,000 is in the ledger
    // already; counting it here too is what put this tile above the aging
    // ladder by Σ opening balances.
    expect((await res.json()) as { toCollect: string }).toMatchObject({ toCollect: "1200.000000" });
  });
});
