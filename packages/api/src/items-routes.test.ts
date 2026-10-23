import { describe, it, expect, afterEach } from "vitest";
import { createSqliteItemStore, type SqliteItemStoreHandle } from "@mezan/persistence";
import { createItemsRouter } from "./items-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteItemStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteItemStore();
  handles.push(repo);
  const app = createItemsRouter(repo, insecureHeaderAuthContextResolver);
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

  it("409s a duplicate item code with an Arabic message", async () => {
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
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("مستخدم بالفعل");
    expect(body.message).toContain(VALID_PAYLOAD.code);
  });

  /**
   * Regression guard (D: the browser computed the code from the catalog's
   * page size and posted it as a literal, so two operators racing the create
   * form could be handed the same code). The server now allocates it.
   */
  it("allocates the code itself when the create omits it", async () => {
    const { app } = newApp();
    const { code: _code, ...withoutCode } = VALID_PAYLOAD;
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withoutCode),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ITM-000001");
  });

  it("resolves a real race between two concurrent creates that both omit the code", async () => {
    const { app } = newApp();
    const { code: _code, ...withoutCode } = VALID_PAYLOAD;
    const [resA, resB] = await Promise.all([
      app.fetch(
        req("/", {
          method: "POST",
          permissions: "inventory.item.create",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...withoutCode, id: "itm-a", nameAr: "صنف أ" }),
        }),
      ),
      app.fetch(
        req("/", {
          method: "POST",
          permissions: "inventory.item.create",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...withoutCode, id: "itm-b", nameAr: "صنف ب" }),
        }),
      ),
    ]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const [bodyA, bodyB] = (await Promise.all([resA.json(), resB.json()])) as { code: string }[];
    expect(bodyA?.code).not.toBe(bodyB?.code);
    expect(new Set([bodyA?.code, bodyB?.code])).toEqual(new Set(["ITM-000001", "ITM-000002"]));
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

/**
 * Q-8: an omitted page used to mean the whole catalogue. The default is what
 * makes the unbounded read unreachable by omission, and `/counts` still
 * reports the whole filtered set so the chips do not shrink with the page.
 */
describe("items router — the list is a page (guards Q-8)", () => {
  async function seed(app: { fetch(r: Request): Response | Promise<Response> }, n: number) {
    for (let i = 0; i < n; i++) {
      const res = await app.fetch(
        req("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          permissions: "inventory.item.create",
          body: JSON.stringify({ ...VALID_PAYLOAD, id: `itm-${i}`, code: `ITM-${String(i).padStart(4, "0")}` }),
        }),
      );
      expect(res.status).toBe(201);
    }
  }

  it("answers 25 rows when the caller asks for no page at all", async () => {
    const { app } = newApp();
    await seed(app, 30);
    const res = await app.fetch(req("/", { permissions: "inventory.item.view" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toHaveLength(25);
  });

  it("honours page and pageSize, and the last page is the remainder", async () => {
    const { app } = newApp();
    await seed(app, 30);
    const first = (await (await app.fetch(req("/?page=1&pageSize=10", { permissions: "inventory.item.view" }))).json()) as { id: string }[];
    const third = (await (await app.fetch(req("/?page=3&pageSize=10", { permissions: "inventory.item.view" }))).json()) as { id: string }[];
    const fourth = (await (await app.fetch(req("/?page=4&pageSize=10", { permissions: "inventory.item.view" }))).json()) as { id: string }[];
    expect(first).toHaveLength(10);
    expect(third).toHaveLength(10);
    expect(fourth).toHaveLength(0);
    // No row appears on two pages.
    expect(new Set([...first, ...third].map((r) => r.id)).size).toBe(20);
  });

  it("caps a caller who asks for more than the compiled-in ceiling", async () => {
    const { app } = newApp();
    await seed(app, 30);
    // 500 is above MAX_PAGE_SIZE; the schema refuses it and the route falls
    // back to the default rather than serving the whole catalogue.
    const res = await app.fetch(req("/?pageSize=500", { permissions: "inventory.item.view" }));
    expect((await res.json()) as unknown[]).toHaveLength(25);
  });

  it("narrows to exactly the ids asked for, so a screen can name its own rows without the catalogue", async () => {
    const { app } = newApp();
    await seed(app, 30);
    const rows = (await (await app.fetch(req("/?ids=itm-3,itm-17,missing&pageSize=200", { permissions: "inventory.item.view" }))).json()) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["itm-17", "itm-3"]);
  });

  it("narrows by a set of types and to lot-tracked items, for pickers that only offer some kinds", async () => {
    const { app } = newApp();
    await seed(app, 2);
    for (const extra of [
      { id: "svc-1", code: "SVC-1", type: "service", trackInventory: false },
      { id: "lot-1", code: "LOT-1", trackExpiry: true },
    ]) {
      const res = await app.fetch(req("/", { method: "POST", headers: { "content-type": "application/json" }, permissions: "inventory.item.create", body: JSON.stringify({ ...VALID_PAYLOAD, ...extra }) }));
      expect(res.status).toBe(201);
    }
    const ids = async (qs: string) => ((await (await app.fetch(req(`/?${qs}`, { permissions: "inventory.item.view" }))).json()) as { id: string }[]).map((r) => r.id).sort();
    expect(await ids("types=service")).toEqual(["svc-1"]);
    expect(await ids("types=stock,service")).toEqual(["itm-0", "itm-1", "lot-1", "svc-1"]);
    expect(await ids("lotTracked=1")).toEqual(["lot-1"]);
  });

  it("counts still report the WHOLE filtered set, not the page", async () => {
    const { app } = newApp();
    await seed(app, 30);
    const counts = (await (await app.fetch(req("/counts", { permissions: "inventory.item.view" }))).json()) as Record<string, number>;
    expect(counts.all).toBe(30);
  });
});

describe("items router — the cost price is a separate grant (D94)", () => {
  const withCost = { ...VALID_PAYLOAD, costPrice: "42.50", salePrice: "70.00" };

  async function seed(app: ReturnType<typeof newApp>["app"]) {
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.item.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withCost),
      }),
    );
    expect(res.status).toBe(201);
  }

  it("omits costPrice from the list for a caller who holds only the item permission", async () => {
    const { app } = newApp();
    await seed(app);
    const rows = (await (await app.fetch(req("/", { permissions: "inventory.item.view" }))).json()) as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("costPrice");
    expect(rows[0]?.salePrice).toBe("70.000000");
  });

  it("serves costPrice to a caller who also holds sales.invoice.view_cost", async () => {
    const { app } = newApp();
    await seed(app);
    const rows = (await (
      await app.fetch(req("/", { permissions: "inventory.item.view,sales.invoice.view_cost" }))
    ).json()) as Record<string, unknown>[];
    expect(rows[0]?.costPrice).toBe("42.500000");
  });

  it("omits it on the detail route too, so the id is not a way round the list", async () => {
    const { app } = newApp();
    await seed(app);
    const hidden = (await (await app.fetch(req("/itm-1", { permissions: "inventory.item.view" }))).json()) as Record<
      string,
      unknown
    >;
    expect(hidden).not.toHaveProperty("costPrice");
    const shown = (await (
      await app.fetch(req("/itm-1", { permissions: "inventory.item.view,sales.invoice.view_cost" }))
    ).json()) as Record<string, unknown>;
    expect(shown.costPrice).toBe("42.500000");
  });
});
