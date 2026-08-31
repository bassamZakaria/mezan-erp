import { describe, it, expect, afterEach } from "vitest";
import { createSqliteLabelLayoutStore } from "@mezan/persistence";
import { createLabelLayoutsRouter } from "./label-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function newApp() {
  const layouts = createSqliteLabelLayoutStore();
  closers.push(layouts);
  return { app: createLabelLayoutsRouter(layouts), layouts };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(
  app: App,
  method: string,
  path: string,
  payload?: unknown,
  init: { permissions?: string } = {},
) {
  return app.fetch(
    req(path, { method, permissions: init.permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function layoutBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "lay-1",
    code: "A4-24",
    nameAr: "ملصقات A4 — 24 لكل صفحة",
    columns: 3,
    rows: 8,
    labelWidthMm: 63.5,
    labelHeightMm: 33.9,
    ...overrides,
  };
}

describe("label-layouts routes", () => {
  it("403s every endpoint for a caller with no inventory permissions", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/", undefined, { permissions: "" })).status).toBe(403);
    expect((await send(app, "POST", "/", layoutBody(), { permissions: "inventory.item.view" })).status).toBe(403);
    expect((await send(app, "PATCH", "/lay-1", { rows: 4 }, { permissions: "inventory.item.view" })).status).toBe(403);
    expect((await send(app, "DELETE", "/lay-1", undefined, { permissions: "inventory.item.view" })).status).toBe(403);
  });

  it("creates a layout, defaulting every geometry and visibility option it was not given", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", layoutBody());
    expect(res.status).toBe(201);
    const layout = await json<Record<string, unknown>>(res);
    expect(layout).toMatchObject({
      id: "lay-1",
      code: "A4-24",
      columns: 3,
      rows: 8,
      labelWidthMm: 63.5,
      labelHeightMm: 33.9,
      active: true,
    });
    expect(layout.pageSize).toBeDefined();
    expect(typeof layout.showBarcode).toBe("boolean");
  });

  it("carries every supplied option through instead of defaulting it", async () => {
    const { app } = newApp();
    const res = await send(
      app,
      "POST",
      "/",
      layoutBody({
        pageSize: "A4",
        rows: 7,
        columnGapMm: 2.5,
        rowGapMm: 1.5,
        marginBlockMm: 5,
        marginInlineMm: 7,
        showItemName: false,
        showItemCode: false,
        showPrice: false,
        showUnit: false,
        showBarcode: false,
        showBarcodeText: false,
        barcodeHeightMm: 12,
        active: false,
      }),
    );
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      columnGapMm: 2.5,
      rowGapMm: 1.5,
      marginBlockMm: 5,
      marginInlineMm: 7,
      showItemName: false,
      showBarcode: false,
      barcodeHeightMm: 12,
      active: false,
    });
  });

  it("lists what it stored and serves one layout by id", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", layoutBody());
    await send(app, "POST", "/", layoutBody({ id: "lay-2", code: "THERMAL-1", columns: 1, rows: 1 }));

    expect(await json<unknown[]>(await send(app, "GET", "/"))).toHaveLength(2);
    expect((await json<{ code: string }>(await send(app, "GET", "/lay-2"))).code).toBe("THERMAL-1");
  });

  it("404s a layout that is not there, on read, patch and delete alike", async () => {
    const { app } = newApp();
    expect((await send(app, "GET", "/nope")).status).toBe(404);
    expect((await send(app, "PATCH", "/nope", { rows: 4 })).status).toBe(404);
    expect((await send(app, "DELETE", "/nope")).status).toBe(404);
  });

  it("400s a body the schema rejects, on create and on patch", async () => {
    const { app } = newApp();
    expect((await send(app, "POST", "/", { id: "lay-1" })).status).toBe(400);
    expect((await send(app, "POST", "/", layoutBody({ columns: 0 }))).status).toBe(400);
    expect((await send(app, "PATCH", "/lay-1", { rows: -2 })).status).toBe(400);
  });

  it("409s a second layout claiming a code the register already holds", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", layoutBody());
    const again = await send(app, "POST", "/", layoutBody({ id: "lay-2" }));
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("DUPLICATE_LABEL_LAYOUT_CODE");
  });

  it("422s a grid that does not fit its own page, naming the reason", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", layoutBody({ columns: 12, labelWidthMm: 90 }));
    expect(res.status).toBe(422);
    const payload = await json<{ error: string; reasons: string[] }>(res);
    expect(payload.error).toBe("INVALID_LABEL_LAYOUT");
    expect(payload.reasons.join(" ")).toContain("wider than");
  });

  it("422s a barcode taller than the label it has to print on", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", layoutBody({ barcodeHeightMm: 99 }));
    expect(res.status).toBe(422);
    expect((await json<{ reasons: string[] }>(res)).reasons.join(" ")).toContain("barcodeHeightMm");
  });

  it("patches only the fields it was given, and leaves the rest alone", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", layoutBody());
    const res = await send(app, "PATCH", "/lay-1", { rows: 6, showPrice: false, active: false });
    expect(res.status).toBe(200);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      code: "A4-24",
      columns: 3,
      rows: 6,
      showPrice: false,
      active: false,
    });
  });

  it("422s a patch that would make the grid overflow the page", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", layoutBody());
    expect((await send(app, "PATCH", "/lay-1", { columns: 12 })).status).toBe(422);
  });

  it("deletes a layout with no body, and it is gone from the list", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", layoutBody());
    const res = await send(app, "DELETE", "/lay-1");
    expect(res.status).toBe(204);
    expect(await json<unknown[]>(await send(app, "GET", "/"))).toEqual([]);
  });
});
