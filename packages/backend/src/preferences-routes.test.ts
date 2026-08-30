import { describe, it, expect, afterEach } from "vitest";
import { insecureHeaderAuthContextResolver } from "@mezan/api";
import { createSqliteUserPreferencesStore, createSqliteUnitOfWork } from "@mezan/persistence";
import type { UserPreferences, UserPreferencesRepository } from "@mezan/domain";
import { createPreferencesRoutes, type PreferencesRoutesDeps } from "./preferences-routes.js";

const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const FIXED_NOW = () => new Date("2026-08-20T10:00:00.000Z");

function newApp(overrides: Partial<PreferencesRoutesDeps> = {}) {
  const store = createSqliteUserPreferencesStore();
  const uow = createSqliteUnitOfWork();
  handles.push(store, uow);
  const deps: PreferencesRoutesDeps = { store, uow: { users: uow.users }, now: FIXED_NOW, ...overrides };
  const app = createPreferencesRoutes(deps, insecureHeaderAuthContextResolver);
  return { app, store, uow };
}

function req(path: string, init: RequestInit & { userId?: string; permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function json(res: Response) {
  return res.json();
}

async function seedUser(uow: ReturnType<typeof newApp>["uow"], id: string, nameAr: string) {
  await uow.users.save({
    id,
    nameAr,
    nameEn: null,
    email: `${id}@cyag.test`,
    phone: null,
    passwordHash: "x",
    pinHash: null,
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as never);
}

const fullPutBody = {
  layoutName: "تخطيطي المخصص",
  numerals: "arabic" as const,
  railCollapsed: true,
  pinnedScreens: [
    {
      id: "p1",
      route: "#/sales-invoices",
      labelAr: "فواتير المبيعات",
      order: 0,
      pinnedAt: "2026-08-20T10:00:00.000Z",
    },
  ],
  recentRecords: [],
  dashboard: { columns: 2, widgets: [] },
  shortcutTiles: [],
  tableViews: [
    {
      tableId: "sales-invoices",
      columns: [{ key: "docNo", visible: true, order: 0 }],
      sortKey: "docNo",
      sortDirection: "asc" as const,
      pageSize: 25,
      density: "compact" as const,
    },
  ],
};

describe("preferences router — authentication", () => {
  it("refuses every self-service route with no resolvable caller", async () => {
    const { app } = newApp();
    expect((await app.fetch(req("/"))).status).toBe(401);
    expect((await app.fetch(req("/", { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await app.fetch(req("/", { method: "PATCH", body: "{}" }))).status).toBe(401);
    expect((await app.fetch(req("/reset", { method: "POST", body: "{}" }))).status).toBe(401);
  });
});

describe("preferences router — GET / and /defaults", () => {
  it("a user who never customised anything gets the shipped default, unstored", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { userId: "u1" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { stored: boolean; isDefault: boolean; layoutName: string };
    expect(body.stored).toBe(false);
    expect(body.isDefault).toBe(true);
    expect(body.layoutName).toBe("التخطيط الافتراضي");
  });

  it("/defaults always answers the shipped default and never persists anything", async () => {
    const { app, store } = newApp();
    const res = await app.fetch(req("/defaults", { userId: "u1" }));
    expect(((await json(res)) as { stored: boolean }).stored).toBe(false);
    expect(await store.get("u1")).toBeNull();
  });
});

describe("preferences router — PUT (full replace)", () => {
  it("round-trips a full replace exactly, and a later GET reads the SAME values back", async () => {
    const { app, store } = newApp();
    const putRes = await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    expect(putRes.status).toBe(200);
    const putBody = (await json(putRes)) as { layoutName: string; stored: boolean; pinnedScreens: unknown[] };
    expect(putBody.stored).toBe(true);
    expect(putBody.layoutName).toBe("تخطيطي المخصص");
    expect(putBody.pinnedScreens).toHaveLength(1);

    const getRes = await app.fetch(req("/", { userId: "u1" }));
    const getBody = (await json(getRes)) as { layoutName: string; numerals: string; railCollapsed: boolean };
    expect(getBody.layoutName).toBe("تخطيطي المخصص");
    expect(getBody.numerals).toBe("arabic");
    expect(getBody.railCollapsed).toBe(true);

    const stored = await store.get("u1");
    expect(stored?.layoutName).toBe("تخطيطي المخصص");
  });

  it("a section OMITTED from a PUT body falls back to the shipped default — full replace, not a patch", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));

    const { pinnedScreens: _omit, ...withoutPins } = fullPutBody;
    const secondPut = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ ...withoutPins, layoutName: "تخطيط ثانٍ" }) }),
    );
    expect(secondPut.status).toBe(200);
    const body = (await json(secondPut)) as { pinnedScreens: unknown[]; layoutName: string };
    // Omitting pinnedScreens on a PUT wipes it back to [] — this is the
    // documented "full replace" behaviour, the deliberate opposite of PATCH.
    expect(body.pinnedScreens).toEqual([]);
    expect(body.layoutName).toBe("تخطيط ثانٍ");
  });

  it("rejects a malformed PUT body (unknown key) with 400, and writes nothing", async () => {
    const { app, store } = newApp();
    const res = await app.fetch(
      req("/", { method: "PUT", userId: "u1", body: JSON.stringify({ ...fullPutBody, notAField: true }) }),
    );
    expect(res.status).toBe(400);
    expect(await store.get("u1")).toBeNull();
  });

  it("rejects a PUT whose merged result is invalid (duplicate pin ids) with 422, and writes nothing", async () => {
    const { app, store } = newApp();
    const dup = { ...fullPutBody.pinnedScreens[0]!, order: 1 };
    const res = await app.fetch(
      req("/", {
        method: "PUT",
        userId: "u1",
        body: JSON.stringify({ ...fullPutBody, pinnedScreens: [fullPutBody.pinnedScreens[0], dup] }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)) as { error: string }).toMatchObject({ error: "INVALID_USER_PREFERENCES" });
    expect(await store.get("u1")).toBeNull();
  });
});

describe("preferences router — PATCH (partial update never wipes untouched keys)", () => {
  it("patching ONE field leaves every other previously-set section exactly as it was", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));

    const patchRes = await app.fetch(
      req("/", { method: "PATCH", userId: "u1", body: JSON.stringify({ railCollapsed: false }) }),
    );
    expect(patchRes.status).toBe(200);
    const body = (await json(patchRes)) as {
      railCollapsed: boolean;
      layoutName: string;
      numerals: string;
      pinnedScreens: unknown[];
      tableViews: unknown[];
      dashboard: { columns: number };
    };
    expect(body.railCollapsed).toBe(false);
    // Everything the PUT set stays untouched by the PATCH that followed.
    expect(body.layoutName).toBe("تخطيطي المخصص");
    expect(body.numerals).toBe("arabic");
    expect(body.pinnedScreens).toHaveLength(1);
    expect(body.tableViews).toHaveLength(1);
    expect(body.dashboard.columns).toBe(2);

    const persisted = await store.get("u1");
    expect(persisted?.pinnedScreens).toHaveLength(1);
    expect(persisted?.layoutName).toBe("تخطيطي المخصص");
  });

  it("rejects a contract-level malformed PATCH body (dashboard.columns out of range) with 400, and writes nothing", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    const res = await app.fetch(
      req("/", { method: "PATCH", userId: "u1", body: JSON.stringify({ dashboard: { columns: 99, widgets: [] } }) }),
    );
    expect(res.status).toBe(400);
    const persisted = await store.get("u1");
    expect(persisted?.dashboard.columns).toBe(2);
  });

  it("rejects a schema-valid PATCH whose merged RESULT is domain-invalid (duplicate pin ids) with 422, and writes nothing", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    const dup = { ...fullPutBody.pinnedScreens[0]!, order: 1 };
    const res = await app.fetch(
      req("/", {
        method: "PATCH",
        userId: "u1",
        body: JSON.stringify({ pinnedScreens: [fullPutBody.pinnedScreens[0], dup] }),
      }),
    );
    expect(res.status).toBe(422);
    const persisted = await store.get("u1");
    expect(persisted?.pinnedScreens).toHaveLength(1);
  });

  it("a PATCH to a first-time (never-stored) user still persists correctly", async () => {
    const { app, store } = newApp();
    const res = await app.fetch(req("/", { method: "PATCH", userId: "fresh", body: JSON.stringify({ railCollapsed: true }) }));
    expect(res.status).toBe(200);
    expect((await store.get("fresh"))?.railCollapsed).toBe(true);
    expect((await store.get("fresh"))?.layoutName).toBe("التخطيط الافتراضي");
  });
});

describe("preferences router — recents", () => {
  it("pushes a recent record and dedupes on (entityType, entityId)", async () => {
    const { app } = newApp();
    const record = {
      id: "r1",
      route: "#/sales-invoices/INV-1",
      entityType: "SALES_INVOICE",
      entityId: "INV-1",
      labelAr: "فاتورة INV-1",
    };
    const first = await app.fetch(req("/recents", { method: "POST", userId: "u1", body: JSON.stringify(record) }));
    expect(first.status).toBe(200);
    const second = await app.fetch(
      req("/recents", {
        method: "POST",
        userId: "u1",
        body: JSON.stringify({ ...record, id: "r2", documentNumber: "INV-000001" }),
      }),
    );
    const body = (await json(second)) as { recentRecords: { id: string; documentNumber: string | null }[] };
    expect(body.recentRecords).toHaveLength(1);
    expect(body.recentRecords[0]?.id).toBe("r2");
  });

  it("rejects a malformed recents body with 400, and writes nothing", async () => {
    const { app, store } = newApp();
    const res = await app.fetch(req("/recents", { method: "POST", userId: "u1", body: JSON.stringify({ id: "r1" }) }));
    expect(res.status).toBe(400);
    expect(await store.get("u1")).toBeNull();
  });
});

describe("preferences router — reset (a real server operation)", () => {
  it("scope 'all' actually DELETES the stored row, so a later read materialises a fresh default", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    expect(await store.get("u1")).not.toBeNull();

    const resetRes = await app.fetch(req("/reset", { method: "POST", userId: "u1", body: JSON.stringify({ scope: "all" }) }));
    expect(resetRes.status).toBe(200);
    expect((await json(resetRes)) as { stored: boolean }).toMatchObject({ stored: false });
    expect(await store.get("u1")).toBeNull();

    const getRes = await app.fetch(req("/", { userId: "u1" }));
    expect(((await json(getRes)) as { layoutName: string }).layoutName).toBe("التخطيط الافتراضي");
  });

  it("scope 'pins' resets only the pins, leaving every other stored section intact", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    const res = await app.fetch(req("/reset", { method: "POST", userId: "u1", body: JSON.stringify({ scope: "pins" }) }));
    expect(res.status).toBe(200);
    const persisted = await store.get("u1");
    expect(persisted?.pinnedScreens).toEqual([]);
    expect(persisted?.layoutName).toBe("تخطيطي المخصص");
    expect(persisted?.tableViews).toHaveLength(1);
  });

  it("scope 'tables' with a tableId resets only that table view", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    const res = await app.fetch(
      req("/reset", { method: "POST", userId: "u1", body: JSON.stringify({ scope: "tables", tableId: "sales-invoices" }) }),
    );
    expect(res.status).toBe(200);
    const persisted = await store.get("u1");
    expect(persisted?.tableViews).toEqual([]);
    expect(persisted?.pinnedScreens).toHaveLength(1);
  });

  it("rejects a malformed reset body with 400", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/reset", { method: "POST", userId: "u1", body: JSON.stringify({ scope: "not-a-real-scope" }) }));
    expect(res.status).toBe(400);
  });

  it("with NO body at all, resets scope 'all' by default", async () => {
    const { app, store } = newApp();
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));
    const res = await app.fetch(req("/reset", { method: "POST", userId: "u1" }));
    expect(res.status).toBe(200);
    expect(await store.get("u1")).toBeNull();
  });
});

describe("preferences router — one user's data never leaks into another's", () => {
  it("two users writing concurrently never see or overwrite each other's row", async () => {
    const { app, store } = newApp();
    await app.fetch(
      req("/", { method: "PUT", userId: "alice", body: JSON.stringify({ ...fullPutBody, layoutName: "تخطيط أليس" }) }),
    );
    await app.fetch(
      req("/", { method: "PATCH", userId: "bob", body: JSON.stringify({ layoutName: "تخطيط بوب", railCollapsed: true }) }),
    );

    const aliceGet = (await json(await app.fetch(req("/", { userId: "alice" })))) as { layoutName: string; railCollapsed: boolean };
    const bobGet = (await json(await app.fetch(req("/", { userId: "bob" })))) as { layoutName: string; railCollapsed: boolean };
    expect(aliceGet.layoutName).toBe("تخطيط أليس");
    expect(aliceGet.railCollapsed).toBe(true); // inherited from fullPutBody
    expect(bobGet.layoutName).toBe("تخطيط بوب");
    expect(bobGet.railCollapsed).toBe(true);

    // Resetting Bob must not touch Alice's stored row.
    await app.fetch(req("/reset", { method: "POST", userId: "bob", body: JSON.stringify({ scope: "all" }) }));
    expect((await store.get("alice"))?.layoutName).toBe("تخطيط أليس");
  });
});

describe("preferences router — admin surface (/users, /users/:userId)", () => {
  it("refuses /users to a caller without admin.users.view, including one holding an unrelated permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/users", { userId: "admin", permissions: "sales.invoice.view" }));
    expect(res.status).toBe(403);
  });

  it("lists every user with their customisation summary, including one who never customised anything", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, "u1", "أحمد");
    await seedUser(uow, "u2", "منى");
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));

    const res = await app.fetch(req("/users", { userId: "admin", permissions: "admin.users.view" }));
    expect(res.status).toBe(200);
    const rows = (await json(res)) as Array<{ userId: string; isDefault: boolean; stored: boolean; pinnedCount: number }>;
    const u1 = rows.find((r) => r.userId === "u1");
    const u2 = rows.find((r) => r.userId === "u2");
    expect(u1).toMatchObject({ isDefault: false, stored: true, pinnedCount: 1 });
    expect(u2).toMatchObject({ isDefault: true, stored: false, pinnedCount: 0 });
  });

  it("GET /users/:userId is READ-ONLY diagnosis of another user's layout, unaffected by the admin's own", async () => {
    const { app, uow } = newApp();
    await seedUser(uow, "u1", "أحمد");
    await app.fetch(req("/", { method: "PUT", userId: "u1", body: JSON.stringify(fullPutBody) }));

    const res = await app.fetch(req("/users/u1", { userId: "admin", permissions: "admin.users.view" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { layoutName: string; fullName: string; readOnly: boolean };
    expect(body.layoutName).toBe("تخطيطي المخصص");
    expect(body.fullName).toBe("أحمد");
    expect(body.readOnly).toBe(true);
  });

  it("404s /users/:userId for an id that has neither a user account nor a stored row", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/users/ghost", { userId: "admin", permissions: "admin.users.view" }));
    expect(res.status).toBe(404);
  });

  it("/users still lists a stored row whose user account no longer exists — with a null name, not a crash", async () => {
    const store = createSqliteUserPreferencesStore();
    handles.push(store);
    await store.save({
      userId: "orphan",
      layoutName: "تخطيط يتيم",
      numerals: null,
      railCollapsed: false,
      pinnedScreens: [{ id: "p1", route: "#/x", labelAr: "س", labelEn: "", icon: null, group: null, order: 0, pinnedAt: "2026-01-01T00:00:00.000Z" }],
      recentRecords: [],
      dashboard: { columns: 3, widgets: [] },
      shortcutTiles: [],
      tableViews: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // The users port lists NOBODY — the account this row belonged to is gone.
    const emptyUsers = { async list() { return []; }, async findById() { return null; }, async findByEmail() { return null; }, async save() {} };
    const app = createPreferencesRoutes({ store, uow: { users: emptyUsers }, now: FIXED_NOW }, insecureHeaderAuthContextResolver);

    const res = await app.fetch(req("/users", { userId: "admin", permissions: "admin.users.view" }));
    expect(res.status).toBe(200);
    const rows = (await json(res)) as Array<{ userId: string; fullName: string | null; stored: boolean; pinnedCount: number }>;
    expect(rows).toEqual([{
      userId: "orphan",
      fullName: null,
      layoutName: "تخطيط يتيم",
      isDefault: false,
      stored: true,
      pinnedCount: 1,
      shortcutCount: 0,
      tableViewCount: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]);
  });
});

describe("preferences router — a legacy/malformed stored row degrades to the default instead of 500ing", () => {
  function stubRepo(get: UserPreferencesRepository["get"]): UserPreferencesRepository {
    return {
      get,
      async save() {},
      async remove() {},
      async list() {
        return [];
      },
    };
  }

  it("GET / recovers gracefully when the stored row predates a field UserPreferences now requires", async () => {
    const legacyRow = {
      userId: "legacy",
      layoutName: "تخطيطي القديم",
      numerals: null,
      railCollapsed: true,
      pinnedScreens: [],
      recentRecords: [],
      dashboard: { columns: 3, widgets: [] },
      shortcutTiles: [],
      // tableViews is missing entirely — a row written before that field existed.
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    } as unknown as UserPreferences;

    const store = stubRepo(async (userId) => (userId === "legacy" ? legacyRow : null));
    const uow = createSqliteUnitOfWork();
    handles.push(uow);
    const app = createPreferencesRoutes({ store, uow: { users: uow.users }, now: FIXED_NOW }, insecureHeaderAuthContextResolver);

    const res = await app.fetch(req("/", { userId: "legacy" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { tableViews: unknown[]; layoutName: string; railCollapsed: boolean; stored: boolean };
    expect(body.tableViews).toEqual([]);
    expect(body.layoutName).toBe("تخطيطي القديم");
    expect(body.railCollapsed).toBe(true);
    expect(body.stored).toBe(true);
  });

  it("GET / falls back to the plain default when the store throws reading the row", async () => {
    const store = stubRepo(async () => {
      throw new Error("corrupt row: invalid JSON");
    });
    const uow = createSqliteUnitOfWork();
    handles.push(uow);
    const app = createPreferencesRoutes({ store, uow: { users: uow.users }, now: FIXED_NOW }, insecureHeaderAuthContextResolver);

    const res = await app.fetch(req("/", { userId: "broken" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { layoutName: string; stored: boolean };
    expect(body.layoutName).toBe("التخطيط الافتراضي");
    expect(body.stored).toBe(false);
  });
});
