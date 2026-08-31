import { describe, it, expect, afterEach } from "vitest";
import { createSqliteWarehouseStore } from "@mezan/persistence";
import { createWarehousesRoutes } from "./warehouses-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function newApp() {
  const store = createSqliteWarehouseStore();
  closers.push(store);
  return { app: createWarehousesRoutes(store), store };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(
  path: string,
  init: RequestInit & { permissions?: string; branchScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(
  app: App,
  method: string,
  path: string,
  payload?: unknown,
  init: { permissions?: string; branchScope?: string } = {},
) {
  return app.fetch(
    req(path, {
      method,
      permissions: init.permissions,
      branchScope: init.branchScope,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function warehouseBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-main",
    code: "MAIN-WH",
    name: "المستودع الرئيسي",
    branchId: "MAIN",
    ...overrides,
  };
}

describe("warehouses routes", () => {
  it("403s a caller holding only the view permission on create and edit", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/", undefined, { permissions: "" })).status).toBe(403);
    expect((await send(app, "POST", "/", warehouseBody(), { permissions: "admin.warehouses.view" })).status).toBe(403);
    expect((await send(app, "PUT", "/wh-main", { name: "x" }, { permissions: "admin.warehouses.view" })).status).toBe(
      403,
    );
  });

  it("creates a warehouse, defaulting the type, the default flag and the active flag", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", warehouseBody());
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      id: "wh-main",
      code: "MAIN-WH",
      branchId: "MAIN",
      type: "MAIN",
      isDefault: false,
      active: true,
      nameEn: null,
    });
  });

  it("carries the supplied type, English name and flags through", async () => {
    const { app } = newApp();
    const res = await send(
      app,
      "POST",
      "/",
      warehouseBody({ type: "VAN", nameEn: "Van 1", isDefault: true, active: false }),
    );
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      type: "VAN",
      nameEn: "Van 1",
      isDefault: true,
      active: false,
    });
  });

  it("lists warehouses, narrows them by branch, and serves one by id", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    await send(app, "POST", "/", warehouseBody({ id: "wh-2", code: "BR2-WH", branchId: "BR2" }));

    expect(await json<unknown[]>(await send(app, "GET", "/"))).toHaveLength(2);
    const ofBr2 = await json<Array<{ id: string }>>(await send(app, "GET", "/?branchId=BR2"));
    expect(ofBr2.map((w) => w.id)).toEqual(["wh-2"]);
    expect((await json<{ code: string }>(await send(app, "GET", "/wh-2"))).code).toBe("BR2-WH");
  });

  it("never shows a caller a warehouse outside their branch scope, filter or no filter", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    await send(app, "POST", "/", warehouseBody({ id: "wh-2", code: "BR2-WH", branchId: "BR2" }));

    const scoped = await json<Array<{ id: string }>>(await send(app, "GET", "/", undefined, { branchScope: "BR2" }));
    expect(scoped.map((w) => w.id)).toEqual(["wh-2"]);

    // A branchId query parameter cannot widen the scope it sits inside.
    const widened = await json<unknown[]>(
      await send(app, "GET", "/?branchId=MAIN", undefined, { branchScope: "BR2" }),
    );
    expect(widened).toEqual([]);
  });

  it("404s a warehouse that is not there, on read and on edit", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/nope")).status).toBe(404);
    expect((await send(app, "PUT", "/nope", { name: "x" })).status).toBe(404);
  });

  it("409s a second warehouse claiming an id that already exists", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    const again = await send(app, "POST", "/", warehouseBody({ code: "OTHER" }));
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("ALREADY_EXISTS");
  });

  it("400s a body the schema rejects, on create and on edit", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    expect((await send(app, "POST", "/", { id: "wh-x" })).status).toBe(400);
    expect((await send(app, "POST", "/", warehouseBody({ id: "wh-x", code: "lower case" }))).status).toBe(400);
    expect((await send(app, "PUT", "/wh-main", { type: "SPACESHIP" })).status).toBe(400);
  });

  it("422s a create the domain refuses even though the schema allowed it", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", warehouseBody({ name: "   " }));
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("INVALID_WAREHOUSE");
  });

  it("422s a patch the domain refuses even though the schema allowed it", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    const res = await send(app, "PUT", "/wh-main", { name: "   " });
    expect(res.status).toBe(422);
    expect((await json<{ error: string; message: string }>(res)).error).toBe("INVALID_WAREHOUSE");
  });

  it("edits only the fields the patch names", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", warehouseBody());
    const res = await send(app, "PUT", "/wh-main", { name: "مستودع القاهرة", active: false });
    expect(res.status).toBe(200);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      code: "MAIN-WH",
      branchId: "MAIN",
      name: "مستودع القاهرة",
      active: false,
    });
  });
});
