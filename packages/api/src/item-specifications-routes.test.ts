import { describe, it, expect, afterEach } from "vitest";
import { createSqliteItemSpecificationStore } from "@mezan/persistence";
import { createItemSpecificationsRoutes } from "./item-specifications-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function newApp(usageByCode: Record<string, number> = {}) {
  const store = createSqliteItemSpecificationStore();
  closers.push(store);
  const usage = { count: async (code: string) => usageByCode[code] ?? 0 };
  return { app: createItemSpecificationsRoutes({ repo: store.specifications, usage }), repo: store.specifications };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const selectSpec = {
  code: "COLOR",
  nameAr: "اللون",
  type: "select" as const,
  values: ["أحمر", "أزرق"],
};

describe("item-specifications routes", () => {
  it("403s a caller who may only view on create, edit and delete", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/", undefined, "")).status).toBe(403);
    expect((await send(app, "POST", "/", selectSpec, "inventory.item.view")).status).toBe(403);
    expect((await send(app, "PATCH", "/COLOR", { nameAr: "x" }, "inventory.item.view")).status).toBe(403);
    expect((await send(app, "DELETE", "/COLOR", undefined, "inventory.item.view")).status).toBe(403);
  });

  it("starts empty — a tenant with no specifications is a real state, not a seeded one", async () => {
    const { app } = newApp();
    expect(await json<unknown[]>(await send(app, "GET", "/"))).toEqual([]);
  });

  it("creates a select-list specification and reports it as used by nothing yet", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", selectSpec);
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      code: "COLOR",
      nameAr: "اللون",
      type: "select",
      values: ["أحمر", "أزرق"],
      unit: null,
      filterable: false,
      status: "active",
      usageCount: 0,
    });
  });

  it("creates a number specification carrying a unit", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", {
      code: "WEIGHT",
      nameAr: "الوزن",
      nameEn: "Weight",
      type: "number",
      unit: "كجم",
      filterable: true,
    });
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      code: "WEIGHT",
      nameEn: "Weight",
      type: "number",
      unit: "كجم",
      filterable: true,
      values: [],
    });
  });

  it("reports the usage count the counter gives it, per specification", async () => {
    const { app } = newApp({ COLOR: 12 });
    await send(app, "POST", "/", selectSpec);
    await send(app, "POST", "/", { code: "SIZE", nameAr: "المقاس", type: "text" });

    const rows = await json<Array<{ code: string; usageCount: number }>>(await send(app, "GET", "/"));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COLOR", usageCount: 12 }),
        expect.objectContaining({ code: "SIZE", usageCount: 0 }),
      ]),
    );
  });

  it("400s a body the schema rejects, on create and on patch", async () => {
    const { app } = newApp();
    expect((await send(app, "POST", "/", { code: "COLOR" })).status).toBe(400);
    expect((await send(app, "POST", "/", { ...selectSpec, code: "lower" })).status).toBe(400);
    expect((await send(app, "POST", "/", { ...selectSpec, type: "colour-wheel" })).status).toBe(400);
    expect((await send(app, "PATCH", "/COLOR", { nameAr: "" })).status).toBe(400);
  });

  it("404s a patch or a delete naming a specification that is not registered", async () => {
    const { app } = newApp();
    expect((await send(app, "PATCH", "/GONE", { nameAr: "x" })).status).toBe(404);
    expect((await send(app, "DELETE", "/GONE")).status).toBe(404);
  });

  it("409s a second specification claiming a code the registry already holds", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", selectSpec);
    const again = await send(app, "POST", "/", { ...selectSpec, nameAr: "لون آخر" });
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("DUPLICATE_ITEM_SPECIFICATION_CODE");
  });

  it("422s a select list with no values, with duplicates, or carrying a unit", async () => {
    const { app } = newApp();
    const noValues = await send(app, "POST", "/", { ...selectSpec, values: [] });
    expect(noValues.status).toBe(422);
    expect((await json<{ reasons: string[] }>(noValues)).reasons.join(" ")).toContain("at least one allowed value");

    const duplicates = await send(app, "POST", "/", { ...selectSpec, values: ["أحمر", "أحمر"] });
    expect((await json<{ reasons: string[] }>(duplicates)).reasons.join(" ")).toContain("unique");

    const withUnit = await send(app, "POST", "/", { ...selectSpec, unit: "كجم" });
    expect(withUnit.status).toBe(422);
  });

  it("422s a number or text specification that was given allowed values", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", { code: "WEIGHT", nameAr: "الوزن", type: "number", values: ["1"] });
    expect(res.status).toBe(422);
    expect((await json<{ reasons: string[] }>(res)).reasons.join(" ")).toContain("cannot carry allowed values");
  });

  it("422s a text specification carrying a unit", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", { code: "NOTE", nameAr: "ملاحظة", type: "text", unit: "سم" });
    expect(res.status).toBe(422);
  });

  it("patches only what it was given, and re-reads the usage count", async () => {
    const { app } = newApp({ COLOR: 3 });
    await send(app, "POST", "/", selectSpec);
    const res = await send(app, "PATCH", "/COLOR", { nameAr: "اللون الأساسي", filterable: true });
    expect(res.status).toBe(200);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      code: "COLOR",
      nameAr: "اللون الأساسي",
      filterable: true,
      values: ["أحمر", "أزرق"],
      usageCount: 3,
    });
  });

  it("422s a patch that would leave a select list with no values at all", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", selectSpec);
    expect((await send(app, "PATCH", "/COLOR", { values: [] })).status).toBe(422);
  });

  it("deletes an unused specification but refuses one an item still binds to", async () => {
    const inUse = newApp({ COLOR: 4 });
    await send(inUse.app, "POST", "/", selectSpec);
    const refused = await send(inUse.app, "DELETE", "/COLOR");
    expect(refused.status).toBe(409);
    expect((await json<{ error: string }>(refused)).error).toBe("ITEM_SPECIFICATION_IN_USE");

    const unused = newApp();
    await send(unused.app, "POST", "/", selectSpec);
    expect((await send(unused.app, "DELETE", "/COLOR")).status).toBe(204);
    expect(await json<unknown[]>(await send(unused.app, "GET", "/"))).toEqual([]);
  });
});
