import { describe, it, expect, afterEach } from "vitest";
import { createSqlitePriceListStore, type SqlitePriceListStoreHandle } from "@mezan/persistence";
import { createPriceListsRoutes } from "./price-lists-routes.js";
import { auditChangesOf, type AuditEvent, type AuditSink, type AuditStream } from "@mezan/domain";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqlitePriceListStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqlitePriceListStore();
  handles.push(repo);
  const app = createPriceListsRoutes(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = { id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" };

describe("price-lists router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("sales.price_list.view");
  });

  it("allows GET / with sales.price_list.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "sales.price_list.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with sales.price_list.manage", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("price-lists router — CRUD", () => {
  it("creates a price list and retrieves it by id, with Money serialized as a string", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.price_list.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, lines: [{ itemId: "item-1", price: "100.50" }] }),
      }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await app.fetch(req("/pl1", { permissions: "sales.price_list.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { code: string; lines: { itemId: string; price: string }[] };
    expect(body).toMatchObject({ id: "pl1", code: "RETAIL", isBase: false, active: true });
    expect(body.lines).toEqual([{ itemId: "item-1", price: "100.500000", minQty: "0.000000", unitCode: null }]);
  });

  it("generates an id when the create payload omits one", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "WHOLESALE", nameAr: "قائمة الجملة" }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();
  });

  it("404s for an unknown price list", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "sales.price_list.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "RETAIL" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate price list code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "pl2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("422s an invalid price list (empty nameAr)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "pl2", code: "BAD", nameAr: "   " }) }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH edits a price list (e.g. rename)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/pl1", { method: "PATCH", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameAr: "قائمة معدلة" }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { nameAr: string }).nameAr).toBe("قائمة معدلة");
  });

  it("PATCH 404s an unknown price list", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", { method: "PATCH", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameAr: "x" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH 409s when renaming the code to one already in use by another list", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "pl2", code: "WHOLESALE", nameAr: "قائمة الجملة" }) }));
    const res = await app.fetch(
      req("/pl2", { method: "PATCH", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "RETAIL" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("POST /:id/deactivate and /:id/activate flip the active flag", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

    const deactivateRes = await app.fetch(req("/pl1/deactivate", { method: "POST", permissions: "sales.price_list.manage" }));
    expect(deactivateRes.status).toBe(200);
    expect(((await deactivateRes.json()) as { active: boolean }).active).toBe(false);

    const activateRes = await app.fetch(req("/pl1/activate", { method: "POST", permissions: "sales.price_list.manage" }));
    expect(activateRes.status).toBe(200);
    expect(((await activateRes.json()) as { active: boolean }).active).toBe(true);
  });

  it("GET /?active=true filters to active-only price lists", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.price_list.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    await app.fetch(req("/pl1/deactivate", { method: "POST", permissions: "sales.price_list.manage" }));

    const res = await app.fetch(req("/?active=true", { permissions: "sales.price_list.view" }));
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });
});

describe("POST /resolve-price — applying a price list to a line", () => {
  async function withLine() {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.price_list.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, lines: [{ itemId: "ITEM-A", price: "80.00" }] }),
      }),
    );
    return app;
  }

  it("returns the price list's line override when one exists", async () => {
    const app = await withLine();
    const res = await app.fetch(
      req("/resolve-price", {
        method: "POST",
        permissions: "sales.price_list.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceListId: "pl1", itemId: "ITEM-A", fallback: "100.00" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { price: string }).price).toBe("80.000000");
  });

  it("falls back to the item's normal price when the list has no override for it", async () => {
    const app = await withLine();
    const res = await app.fetch(
      req("/resolve-price", {
        method: "POST",
        permissions: "sales.price_list.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceListId: "pl1", itemId: "ITEM-B", fallback: "100.00" }),
      }),
    );
    expect(((await res.json()) as { price: string }).price).toBe("100.000000");
  });

  it("falls back to the item's normal price when no price list is given (no price-list customer)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/resolve-price", {
        method: "POST",
        permissions: "sales.price_list.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceListId: null, itemId: "ITEM-A", fallback: "100.00" }),
      }),
    );
    expect(((await res.json()) as { price: string }).price).toBe("100.000000");
  });

  it("falls back to the item's normal price when the price list is inactive", async () => {
    const app = await withLine();
    await app.fetch(req("/pl1/deactivate", { method: "POST", permissions: "sales.price_list.manage" }));
    const res = await app.fetch(
      req("/resolve-price", {
        method: "POST",
        permissions: "sales.price_list.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceListId: "pl1", itemId: "ITEM-A", fallback: "100.00" }),
      }),
    );
    expect(((await res.json()) as { price: string }).price).toBe("100.000000");
  });
});

describe("price-list history names the item a price change belongs to", () => {
  class MemorySink implements AuditSink {
    readonly events: AuditEvent[] = [];
    async append(event: AuditEvent) {
      this.events.push(event);
    }
    async query(stream: AuditStream, limit = 100) {
      return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
    }
  }

  function appWithItems() {
    const repo = createSqlitePriceListStore();
    handles.push(repo);
    const audit = new MemorySink();
    const items = {
      async findById(id: string) {
        return id === "item-1" ? { nameAr: "لابتوب ديل", code: "IT-001" } : null;
      },
    };
    return { app: createPriceListsRoutes(repo, insecureHeaderAuthContextResolver, undefined, audit, items), audit };
  }

  const line = { itemId: "item-1", unitCode: "PCS", minQty: "1", price: "1500.00" };

  it("labels the linePrice change with the item's name, not its raw id", async () => {
    const { app, audit } = appWithItems();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "*",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, lines: [line] }),
      }),
    );
    await app.fetch(
      req("/pl1", {
        method: "PATCH",
        permissions: "*",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: [{ ...line, price: "1650.00" }] }),
      }),
    );

    const changes = auditChangesOf(audit.events.at(-1)!.details).filter((c) => c.field === "linePrice");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.key).toBe("item-1|PCS|1.000000");
    expect(changes[0]!.label).toBe("لابتوب ديل (IT-001) · PCS · ≥ 1");
    expect(changes[0]!.from).toBe("1500.000000");
    expect(changes[0]!.to).toBe("1650.000000");
  });

  it("leaves the label off when the item register is not wired, rather than inventing one", async () => {
    const repo = createSqlitePriceListStore();
    handles.push(repo);
    const audit = new MemorySink();
    const app = createPriceListsRoutes(repo, insecureHeaderAuthContextResolver, undefined, audit);
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "*",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, lines: [line] }),
      }),
    );
    const changes = auditChangesOf(audit.events.at(-1)!.details).filter((c) => c.field === "linePrice");
    expect(changes[0]!.label).toBeUndefined();
  });
});
