import { describe, it, expect, afterEach } from "vitest";
import { createAuthContext, createEntitlements, ALL_SCOPE, type AuthContext, type EntitlementLimits } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteBranchStore,
  createSqliteWarehouseStore,
  type SqliteUnitOfWorkHandle,
  type SqliteBranchStoreHandle,
  type SqliteWarehouseStoreHandle,
} from "@mezan/persistence";
import { createApp } from "./app.js";

/** Task A3: branch and warehouse create routes stop at the plan's caps. */

const handles: { close: () => void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const ADMIN_CONTEXT: AuthContext = createAuthContext({
  userId: "test-admin",
  permissions: ["*"],
  branchScope: ALL_SCOPE,
  warehouseScope: ALL_SCOPE,
});

function appWithLimits(limits?: EntitlementLimits) {
  const uow = createSqliteUnitOfWork(":memory:") as SqliteUnitOfWorkHandle;
  const branchStore = createSqliteBranchStore() as SqliteBranchStoreHandle;
  const warehouseStore = createSqliteWarehouseStore() as SqliteWarehouseStoreHandle;
  handles.push(uow, branchStore, warehouseStore);
  const resolveEntitlements = () =>
    createEntitlements({ plan: "core", activeModules: [], features: {}, seats: 10, expiresAt: null, limits });
  const app = createApp(uow, {
    branchStore,
    warehouseStore,
    resolveAuthContext: () => ADMIN_CONTEXT,
    resolveEntitlements,
  });
  return { app, branchStore, warehouseStore };
}

async function json(res: Response) {
  return res.json();
}

function createBranchRequest(id: string, code: string) {
  return new Request("http://x/branches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, code, name: `فرع ${code}` }),
  });
}

function createWarehouseRequest(id: string, code: string, branchId: string) {
  return new Request("http://x/warehouses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, code, name: `مستودع ${code}`, branchId }),
  });
}

describe("branch cap (A3)", () => {
  it("refuses POST /branches past the branch cap with BRANCH_LIMIT_REACHED", async () => {
    const { app } = appWithLimits({ branches: 1, warehouses: 1 });
    const first = await app.fetch(createBranchRequest("b1", "MAIN"));
    expect(first.status).toBe(201);

    const second = await app.fetch(createBranchRequest("b2", "SECOND"));
    expect(second.status).toBe(409);
    expect((await json(second)) as { error: string }).toMatchObject({
      error: "BRANCH_LIMIT_REACHED",
      message: "وصلتم إلى الحد الأقصى للفروع في باقتكم",
    });
  });

  it("allows POST /branches regardless of count when there is no limits", async () => {
    const { app } = appWithLimits(undefined);
    const first = await app.fetch(createBranchRequest("b1", "MAIN"));
    expect(first.status).toBe(201);
    const second = await app.fetch(createBranchRequest("b2", "SECOND"));
    expect(second.status).toBe(201);
  });
});

describe("warehouse cap (A3)", () => {
  async function seedBranch(app: ReturnType<typeof appWithLimits>["app"]) {
    await app.fetch(createBranchRequest("b1", "MAIN"));
  }

  it("refuses POST /warehouses past the warehouse cap with WAREHOUSE_LIMIT_REACHED", async () => {
    const { app } = appWithLimits({ branches: 5, warehouses: 1 });
    await seedBranch(app);
    const first = await app.fetch(createWarehouseRequest("w1", "WH-MAIN", "b1"));
    expect(first.status).toBe(201);

    const second = await app.fetch(createWarehouseRequest("w2", "WH-SECOND", "b1"));
    expect(second.status).toBe(409);
    expect((await json(second)) as { error: string }).toMatchObject({
      error: "WAREHOUSE_LIMIT_REACHED",
      message: "وصلتم إلى الحد الأقصى للمستودعات في باقتكم",
    });
  });

  it("allows POST /warehouses regardless of count when there is no limits", async () => {
    const { app } = appWithLimits(undefined);
    await seedBranch(app);
    const first = await app.fetch(createWarehouseRequest("w1", "WH-MAIN", "b1"));
    expect(first.status).toBe(201);
    const second = await app.fetch(createWarehouseRequest("w2", "WH-SECOND", "b1"));
    expect(second.status).toBe(201);
  });
});
