import { describe, it, expect, afterEach } from "vitest";
import { createAuthContext, ALL_SCOPE, type AuthContext } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteSettingsStore,
  createSqliteBranchStore,
  createSqliteWarehouseStore,
  type SqliteUnitOfWorkHandle,
  type SqliteSettingsStoreHandle,
  type SqliteBranchStoreHandle,
  type SqliteWarehouseStoreHandle,
} from "@mezan/persistence";
import { createApp } from "./app.js";

/**
 * Integration tests for the settings/branches/warehouses routes, mounted
 * through the real `createApp` against real SQLite-backed stores — the same
 * dual-mount shape `dual-mount.test.ts` proves for journal-entries.
 */

const handles: { close: () => void }[] = [];

const ADMIN_CONTEXT: AuthContext = createAuthContext({
  userId: "test-admin",
  permissions: ["*"],
  branchScope: ALL_SCOPE,
  warehouseScope: ALL_SCOPE,
});

function adminApp() {
  const uow = createSqliteUnitOfWork(":memory:") as SqliteUnitOfWorkHandle;
  const settingsStore = createSqliteSettingsStore() as SqliteSettingsStoreHandle;
  const branchStore = createSqliteBranchStore() as SqliteBranchStoreHandle;
  const warehouseStore = createSqliteWarehouseStore() as SqliteWarehouseStoreHandle;
  handles.push(uow, settingsStore, branchStore, warehouseStore);
  // `createApp`'s settings/branches/warehouses routes default to
  // `headerAuthContextResolver` (no access without an `x-permissions`
  // header) — tests exercising the "authorized caller" path supply an
  // explicit wildcard-admin resolver instead of setting headers on every
  // request.
  const app = createApp(uow, { settingsStore, branchStore, warehouseStore, resolveAuthContext: () => ADMIN_CONTEXT });
  return { app, settingsStore, branchStore, warehouseStore };
}

function restrictedApp(permissions: string[]) {
  const uow = createSqliteUnitOfWork(":memory:") as SqliteUnitOfWorkHandle;
  const settingsStore = createSqliteSettingsStore() as SqliteSettingsStoreHandle;
  const branchStore = createSqliteBranchStore() as SqliteBranchStoreHandle;
  const warehouseStore = createSqliteWarehouseStore() as SqliteWarehouseStoreHandle;
  handles.push(uow, settingsStore, branchStore, warehouseStore);
  const ctx: AuthContext = createAuthContext({
    userId: "restricted",
    permissions,
    branchScope: ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
  });
  const app = createApp(uow, {
    settingsStore,
    branchStore,
    warehouseStore,
    resolveAuthContext: () => ctx,
  });
  return { app };
}

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function json(res: Response): Promise<any> {
  return res.json();
}

describe("settings routes", () => {
  it("GET /settings seeds and returns catalog defaults before any save", async () => {
    const { app } = adminApp();
    const res = await app.fetch(new Request("http://x/settings"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ currency: "EGP", taxCalculation: "EXCLUSIVE", defaultTaxRate: 14 });
  });

  it("PUT /settings applies a partial patch and persists it", async () => {
    const { app } = adminApp();
    const putRes = await app.fetch(
      new Request("http://x/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Cyag", defaultTaxRate: 15, creditControlMode: "BLOCK" }),
      }),
    );
    expect(putRes.status).toBe(200);
    const body = await json(putRes);
    expect(body).toMatchObject({ companyName: "Cyag", defaultTaxRate: 15, creditControlMode: "BLOCK" });

    const getRes = await app.fetch(new Request("http://x/settings"));
    expect(await json(getRes)).toMatchObject({ companyName: "Cyag", defaultTaxRate: 15 });
  });

  it("PUT /settings rejects an out-of-range value with 422", async () => {
    const { app } = adminApp();
    const res = await app.fetch(
      new Request("http://x/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultTaxRate: 999 }),
      }),
    );
    expect(res.status).toBe(400); // fails zod's own max(100) first
  });

  it("blocks a caller lacking admin.settings.edit with 403", async () => {
    const { app } = restrictedApp(["admin.settings.view"]);
    const res = await app.fetch(
      new Request("http://x/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Cyag" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("branches routes", () => {
  it("creates and lists a branch", async () => {
    const { app } = adminApp();
    const createRes = await app.fetch(
      new Request("http://x/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "b1", code: "MAIN", name: "الفرع الرئيسي", isMain: true }),
      }),
    );
    expect(createRes.status).toBe(201);

    const listRes = await app.fetch(new Request("http://x/branches"));
    const list = await json(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "b1", code: "MAIN", isMain: true });
  });

  it("404s GET /branches/:id for an unknown id", async () => {
    const { app } = adminApp();
    const res = await app.fetch(new Request("http://x/branches/missing"));
    expect(res.status).toBe(404);
  });

  it("409s a duplicate branch id", async () => {
    const { app } = adminApp();
    const body = JSON.stringify({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" });
    await app.fetch(new Request("http://x/branches", { method: "POST", headers: { "content-type": "application/json" }, body }));
    const res = await app.fetch(new Request("http://x/branches", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("DUPLICATE_ID");
  });

  it("409s a branch code another branch already uses, in Arabic", async () => {
    const { app } = adminApp();
    const post = (body: unknown) => app.fetch(new Request("http://x/branches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    await post({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" });
    const res = await post({ id: "b2", code: "MAIN", name: "فرع آخر" });
    expect(res.status).toBe(409);
    const refusal = (await res.json()) as { error: string; message: string };
    expect(refusal.error).toBe("DUPLICATE_BRANCH_CODE");
    expect(refusal.message).toMatch(/[\u0600-\u06FF]/);
  });

  it("updates a branch via PUT", async () => {
    const { app } = adminApp();
    await app.fetch(
      new Request("http://x/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }),
      }),
    );
    const putRes = await app.fetch(
      new Request("http://x/branches/b1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(putRes.status).toBe(200);
    expect(await json(putRes)).toMatchObject({ id: "b1", active: false });
  });

  it("blocks a caller lacking admin.branches.create with 403", async () => {
    const { app } = restrictedApp(["admin.branches.view"]);
    const res = await app.fetch(
      new Request("http://x/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("warehouses routes", () => {
  async function seedBranch(app: ReturnType<typeof adminApp>["app"]) {
    await app.fetch(
      new Request("http://x/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "b1", code: "MAIN", name: "الفرع الرئيسي", isMain: true }),
      }),
    );
  }

  it("creates a MAIN and a VAN warehouse under a branch, and lists both", async () => {
    const { app } = adminApp();
    await seedBranch(app);

    const mainRes = await app.fetch(
      new Request("http://x/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1", isDefault: true }),
      }),
    );
    expect(mainRes.status).toBe(201);
    expect(await json(mainRes)).toMatchObject({ type: "MAIN" });

    const vanRes = await app.fetch(
      new Request("http://x/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "w2", code: "VAN", name: "سياره نقل", nameEn: null, branchId: "b1", type: "VAN" }),
      }),
    );
    expect(vanRes.status).toBe(201);

    const listRes = await app.fetch(new Request("http://x/warehouses?branchId=b1"));
    const list = await json(listRes);
    expect(list.map((w: { type: string }) => w.type).sort()).toEqual(["MAIN", "VAN"]);
  });

  it("rejects an unknown warehouse type with 400", async () => {
    const { app } = adminApp();
    await seedBranch(app);
    const res = await app.fetch(
      new Request("http://x/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "w1", code: "WH", name: "x", branchId: "b1", type: "COLD_STORE" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("blocks a caller lacking admin.warehouses.view with 403", async () => {
    const { app } = restrictedApp([]);
    const res = await app.fetch(new Request("http://x/warehouses"));
    expect(res.status).toBe(403);
  });
});
