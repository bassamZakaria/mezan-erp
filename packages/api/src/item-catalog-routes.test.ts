import { describe, it, expect, afterEach } from "vitest";
import { ALL_SCOPE, AuditChangeAction, auditChangesOf, type AuditEvent, type AuditSink, type AuditStream } from "@mezan/domain";
import { createSqliteItemCatalogStore, type SqliteItemCatalogStoreHandle } from "@mezan/persistence";
import {
  createItemUnitsRoutes,
  createItemCategoriesRoutes,
  createItemBrandsRoutes,
  createItemSeasonsRoutes,
} from "./item-catalog-routes.js";
import { createSessionRegistry, createSessionAuthContextResolver, type SessionRegistry } from "./session-auth.js";

const handles: SqliteItemCatalogStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newStore() {
  const store = createSqliteItemCatalogStore();
  handles.push(store);
  return store;
}

function reqFactory(sessions: SessionRegistry) {
  return async function req(
    path: string,
    init: RequestInit & { userId?: string; permissions?: string } = {},
  ) {
    const headers = new Headers(init.headers);
    if (init.userId !== undefined || init.permissions !== undefined) {
      const token = await sessions.issue({
        userId: init.userId ?? "u1",
        permissions: init.permissions ? init.permissions.split(",") : [],
        roleCode: null,
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      });
      headers.set("authorization", `Bearer ${token}`);
    }
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return new Request(`http://local${path}`, { ...init, headers });
  };
}

describe("item units routes", () => {
  function newApp() {
    const store = newStore();
    const sessions = createSessionRegistry();
    const app = createItemUnitsRoutes(store.units, createSessionAuthContextResolver(sessions));
    return { app, req: reqFactory(sessions) };
  }

  it("401s an unauthenticated caller and 403s one without inventory.item.view", async () => {
    const { app, req } = newApp();
    expect((await app.fetch((await req("/")))).status).toBe(401);
    expect((await app.fetch((await req("/", { userId: "u1", permissions: "sales.invoice.view" })))).status).toBe(403);
  });

  it("403s a create without inventory.item.create", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/", {
        method: "POST",
        permissions: "inventory.item.view",
        body: JSON.stringify({ code: "PCS", nameAr: "قطعة" }),
      })),
    );
    expect(res.status).toBe(403);
  });

  it("400s a create with a missing nameAr", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ code: "PCS" }) })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { fieldErrors: Record<string, string[]> } };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.details.fieldErrors.nameAr).toBeTruthy();
  });

  it("creates a unit, 409s a duplicate code, then reads it back through GET /", async () => {
    const { app, req } = newApp();
    const create = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ code: "PCS", nameAr: "قطعة" }) })),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toEqual({ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" });

    const dup = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ code: "PCS", nameAr: "قطعة أخرى" }) })),
    );
    expect(dup.status).toBe(409);

    const list = await app.fetch((await req("/", { permissions: "inventory.item.view" })));
    expect(await list.json()).toEqual([{ code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" }]);
  });

  it("404s a PATCH to an unknown unit code", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/NOPE", { method: "PATCH", permissions: "inventory.item.edit", body: JSON.stringify({ status: "inactive" }) })),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH edits a unit and the read-back reflects the change", async () => {
    const { app, req } = newApp();
    await app.fetch((await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ code: "KG", nameAr: "كيلوجرام" }) })));
    const patch = await app.fetch(
      (await req("/KG", { method: "PATCH", permissions: "inventory.item.edit", body: JSON.stringify({ status: "inactive", nameEn: "Kilogram" }) })),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ code: "KG", nameAr: "كيلوجرام", nameEn: "Kilogram", status: "inactive" });

    const list = await app.fetch((await req("/", { permissions: "inventory.item.view" })));
    expect(((await list.json()) as { status: string }[])[0]?.status).toBe("inactive");
  });
});

describe("item categories routes", () => {
  function newApp() {
    const store = newStore();
    const sessions = createSessionRegistry();
    const app = createItemCategoriesRoutes(store.categories, createSessionAuthContextResolver(sessions));
    return { app, req: reqFactory(sessions) };
  }

  it("401s an unauthenticated caller and 403s one without inventory.item.view", async () => {
    const { app, req } = newApp();
    expect((await app.fetch((await req("/")))).status).toBe(401);
    expect((await app.fetch((await req("/", { userId: "u1", permissions: "sales.invoice.view" })))).status).toBe(403);
  });

  it("400s a create missing nameAr", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c1" }) })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
    expect(body.details.fieldErrors.nameAr).toBeTruthy();
  });

  it("creates a category, 409s a duplicate id, then reads it back", async () => {
    const { app, req } = newApp();
    const create = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c1", nameAr: "مشروبات" }) })),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({ id: "c1", nameAr: "مشروبات", parentId: null, status: "active" });

    const dup = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c1", nameAr: "غير ذلك" }) })),
    );
    expect(dup.status).toBe(409);

    const list = await app.fetch((await req("/", { permissions: "inventory.item.view" })));
    expect((await list.json()) as unknown[]).toHaveLength(1);
  });

  it("404s creating a category under a parent that does not exist", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c2", nameAr: "فرعي", parentId: "nope" }) })),
    );
    expect(res.status).toBe(404);
  });

  it("422s a category set as its own parent", async () => {
    const { app, req } = newApp();
    await app.fetch((await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c1", nameAr: "مشروبات" }) })));
    const res = await app.fetch(
      (await req("/c1", { method: "PATCH", permissions: "inventory.item.edit", body: JSON.stringify({ parentId: "c1" }) })),
    );
    expect(res.status).toBe(422);
  });

  it("404s a PATCH to an unknown category id", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/nope", { method: "PATCH", permissions: "inventory.item.edit", body: JSON.stringify({ status: "inactive" }) })),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH nests a category under a real parent and the read-back shows it", async () => {
    const { app, req } = newApp();
    await app.fetch((await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c1", nameAr: "مشروبات" }) })));
    await app.fetch((await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "c2", nameAr: "غازية" }) })));
    const patch = await app.fetch(
      (await req("/c2", { method: "PATCH", permissions: "inventory.item.edit", body: JSON.stringify({ parentId: "c1" }) })),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: "c2", parentId: "c1" });

    const list = (await (await app.fetch((await req("/", { permissions: "inventory.item.view" })))).json()) as { id: string; parentId: string | null }[];
    expect(list.find((c) => c.id === "c2")?.parentId).toBe("c1");
  });
});

describe("item brands routes", () => {
  function newApp() {
    const store = newStore();
    const sessions = createSessionRegistry();
    const app = createItemBrandsRoutes(store.brands, createSessionAuthContextResolver(sessions));
    return { app, req: reqFactory(sessions) };
  }

  it("401s an unauthenticated caller and 403s one without inventory.item.view", async () => {
    const { app, req } = newApp();
    expect((await app.fetch((await req("/")))).status).toBe(401);
    expect((await app.fetch((await req("/", { userId: "u1", permissions: "sales.invoice.view" })))).status).toBe(403);
  });

  it("GET /:id 404s an unknown brand", async () => {
    const { app, req } = newApp();
    const res = await app.fetch((await req("/nope", { permissions: "inventory.item.view" })));
    expect(res.status).toBe(404);
  });

  it("400s a create with a missing code", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "b1", nameAr: "نستله" }) })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
    expect(body.details.fieldErrors.code).toBeTruthy();
  });

  it("creates a brand, 409s a duplicate id, then reads it back via GET /:id", async () => {
    const { app, req } = newApp();
    const create = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "b1", code: "NESTLE", nameAr: "نستله" }) })),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toEqual({ id: "b1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });

    const dup = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "b1", code: "NESTLE", nameAr: "نستله ٢" }) })),
    );
    expect(dup.status).toBe(409);

    const get = await app.fetch((await req("/b1", { permissions: "inventory.item.view" })));
    expect(await get.json()).toEqual({ id: "b1", code: "NESTLE", nameAr: "نستله", nameEn: null, status: "active" });
  });

  it("PUT /:id 404s an unknown brand", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/nope", { method: "PUT", permissions: "inventory.item.edit", body: JSON.stringify({ code: "X", nameAr: "س" }) })),
    );
    expect(res.status).toBe(404);
  });

  it("PUT /:id edits a brand and the read-back reflects it", async () => {
    const { app, req } = newApp();
    await app.fetch((await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "b1", code: "NESTLE", nameAr: "نستله" }) })));
    const patch = await app.fetch(
      (await req("/b1", { method: "PUT", permissions: "inventory.item.edit", body: JSON.stringify({ code: "NESTLE", nameAr: "نستله", status: "inactive" }) })),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: "b1", status: "inactive" });

    const get = await app.fetch((await req("/b1", { permissions: "inventory.item.view" })));
    expect(((await get.json()) as { status: string }).status).toBe("inactive");
  });
});

describe("item seasons routes", () => {
  function newApp() {
    const store = newStore();
    const sessions = createSessionRegistry();
    const app = createItemSeasonsRoutes(store.seasons, createSessionAuthContextResolver(sessions));
    return { app, req: reqFactory(sessions) };
  }

  it("401s an unauthenticated caller and 403s one without inventory.item.view", async () => {
    const { app, req } = newApp();
    expect((await app.fetch((await req("/")))).status).toBe(401);
    expect((await app.fetch((await req("/", { userId: "u1", permissions: "sales.invoice.view" })))).status).toBe(403);
  });

  it("GET /:id 404s an unknown season", async () => {
    const { app, req } = newApp();
    const res = await app.fetch((await req("/nope", { permissions: "inventory.item.view" })));
    expect(res.status).toBe(404);
  });

  it("creates a season, 409s a duplicate id, then reads it back", async () => {
    const { app, req } = newApp();
    const create = await app.fetch(
      (await req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        body: JSON.stringify({ id: "s1", code: "SUMMER26", nameAr: "صيف 2026", startDate: "2026-05-01", endDate: "2026-08-31" }),
      })),
    );
    expect(create.status).toBe(201);
    expect(await create.json()).toEqual({
      id: "s1",
      code: "SUMMER26",
      nameAr: "صيف 2026",
      nameEn: null,
      startDate: "2026-05-01",
      endDate: "2026-08-31",
      status: "active",
    });

    const dup = await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "s1", code: "SUMMER26B", nameAr: "صيف آخر" }) })),
    );
    expect(dup.status).toBe(409);

    const get = await app.fetch((await req("/s1", { permissions: "inventory.item.view" })));
    expect(((await get.json()) as { code: string }).code).toBe("SUMMER26");
  });

  it("PUT /:id 404s an unknown season", async () => {
    const { app, req } = newApp();
    const res = await app.fetch(
      (await req("/nope", { method: "PUT", permissions: "inventory.item.edit", body: JSON.stringify({ code: "X", nameAr: "س" }) })),
    );
    expect(res.status).toBe(404);
  });

  it("PUT /:id edits a season and the read-back reflects it", async () => {
    const { app, req } = newApp();
    await app.fetch(
      (await req("/", { method: "POST", permissions: "inventory.item.create", body: JSON.stringify({ id: "s1", code: "SUMMER26", nameAr: "صيف 2026" }) })),
    );
    const patch = await app.fetch(
      (await req("/s1", { method: "PUT", permissions: "inventory.item.edit", body: JSON.stringify({ code: "SUMMER26", nameAr: "صيف 2026", status: "inactive" }) })),
    );
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ id: "s1", status: "inactive" });

    const list = await app.fetch((await req("/", { permissions: "inventory.item.view" })));
    expect(((await list.json()) as { status: string }[])[0]?.status).toBe("inactive");
  });
});

describe("brands and seasons leave a trail", () => {
  class MemorySink implements AuditSink {
    readonly events: AuditEvent[] = [];
    async append(event: AuditEvent) {
      this.events.push(event);
    }
    async query(stream: AuditStream, limit = 100) {
      return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
    }
  }

  it("records the brand create and the rename that follows it", async () => {
    const store = newStore();
    const sessions = createSessionRegistry();
    const audit = new MemorySink();
    const app = createItemBrandsRoutes(store.brands, createSessionAuthContextResolver(sessions), audit);
    const req = reqFactory(sessions);

    await app.fetch((await req("/", { method: "POST", permissions: "*", body: JSON.stringify({ id: "b9", code: "NESTLE", nameAr: "نستله" }) })));
    await app.fetch((await req("/b9", { method: "PUT", permissions: "*", body: JSON.stringify({ code: "NESTLE", nameAr: "نستله مصر" }) })));

    expect(audit.events.map((e) => e.action)).toEqual([AuditChangeAction.Create, AuditChangeAction.Update]);
    expect(audit.events[0]!.entityType).toBe("ITEM_BRAND");
    expect(auditChangesOf(audit.events[1]!.details)).toEqual([{ field: "nameAr", from: "نستله", to: "نستله مصر" }]);
  });

  it("records the season create and the window that moved", async () => {
    const store = newStore();
    const sessions = createSessionRegistry();
    const audit = new MemorySink();
    const app = createItemSeasonsRoutes(store.seasons, createSessionAuthContextResolver(sessions), audit);
    const req = reqFactory(sessions);

    await app.fetch(
      (await req("/", { method: "POST", permissions: "*", body: JSON.stringify({ id: "s9", code: "W26", nameAr: "شتاء ٢٦", startDate: "2026-12-01", endDate: "2027-02-28" }) })),
    );
    await app.fetch(
      (await req("/s9", { method: "PUT", permissions: "*", body: JSON.stringify({ code: "W26", nameAr: "شتاء ٢٦", startDate: "2026-11-15", endDate: "2027-02-28" }) })),
    );

    expect(audit.events[0]!.entityType).toBe("ITEM_SEASON");
    expect(auditChangesOf(audit.events[1]!.details)).toEqual([
      { field: "startDate", from: "2026-12-01", to: "2026-11-15" },
    ]);
  });
});
