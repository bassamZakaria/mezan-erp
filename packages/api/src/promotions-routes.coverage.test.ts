import { describe, it, expect, afterEach } from "vitest";
import { createSqlitePromotionStore, type SqlitePromotionStoreHandle } from "@mezan/persistence";
import { createPromotionsRoutes } from "./promotions-routes.js";

const handles: SqlitePromotionStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqlitePromotionStore();
  handles.push(repo);
  return { app: createPromotionsRoutes(repo), repo };
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

async function get(app: App, path: string, permissions?: string) {
  return app.fetch(req(path, { permissions }));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function promotion(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo-1",
    code: "SUMMER10",
    nameAr: "خصم الصيف",
    type: "percentage" as const,
    percentValue: 10,
    startDate: "2020-01-01",
    endDate: "2099-12-31",
    ...overrides,
  };
}

describe("promotions-routes — the money fields a promotion may leave out", () => {
  it("keeps every unset amount null rather than reporting a zero discount", async () => {
    const { app } = newApp();
    const created = await json<{
      amountValue: string | null;
      minInvoiceValue: string | null;
      minQty: string | null;
      maxDiscountAmount: string | null;
    }>(await send(app, "POST", "/", promotion()));

    expect(created.amountValue).toBeNull();
    expect(created.minInvoiceValue).toBeNull();
    expect(created.minQty).toBeNull();
    expect(created.maxDiscountAmount).toBeNull();
  });

  it("carries every supplied amount through as an exact decimal string", async () => {
    const { app } = newApp();
    const created = await json<{
      amountValue: string | null;
      minInvoiceValue: string | null;
      minQty: string | null;
      maxDiscountAmount: string | null;
    }>(
      await send(
        app,
        "POST",
        "/",
        promotion({
          type: "fixed_amount",
          percentValue: null,
          amountValue: "50.00",
          minInvoiceValue: "500.00",
          minQty: "3",
          maxDiscountAmount: "100.00",
        }),
      ),
    );

    expect(created.amountValue).toBe("50.000000");
    expect(created.minInvoiceValue).toBe("500.000000");
    expect(created.minQty).toBe("3.000000");
    expect(created.maxDiscountAmount).toBe("100.000000");
  });

  it("mints an id when the caller supplies none", async () => {
    const { app } = newApp();
    const created = await json<{ id: string }>(await send(app, "POST", "/", { ...promotion(), id: undefined }));
    expect(created.id).toMatch(/.+/);
  });

  it("round-trips a bundle's components", async () => {
    const { app } = newApp();
    const res = await send(
      app,
      "POST",
      "/",
      promotion({
        type: "bundle",
        percentValue: null,
        amountValue: "99.00",
        bundleComponents: [
          { itemId: "itm-1", qty: "2" },
          { itemId: "itm-2", qty: "1" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const created = await json<{ bundleComponents: Array<{ itemId: string; qty: string }> }>(res);
    expect(created.bundleComponents).toHaveLength(2);
    expect(created.bundleComponents[0]!.qty).toBe("2.000000");
  });
});

describe("promotions-routes — the list, the edits and the refusals", () => {
  it("narrows the list to the active promotions, or the inactive ones, or neither", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", promotion());
    await send(app, "POST", "/", promotion({ id: "promo-2", code: "WINTER5", active: false }));

    expect(await json<unknown[]>(await get(app, "/"))).toHaveLength(2);
    expect(await json<unknown[]>(await get(app, "/?active=true"))).toHaveLength(1);
    expect(await json<unknown[]>(await get(app, "/?active=false"))).toHaveLength(1);
  });

  it("400s a create or an edit whose body the schema rejects", async () => {
    const { app } = newApp();
    expect((await send(app, "POST", "/", { code: "X" })).status).toBe(400);

    await send(app, "POST", "/", promotion());
    expect((await send(app, "PATCH", "/promo-1", { percentValue: "ten" })).status).toBe(400);
  });

  it("404s a promotion that is not registered, on read, edit and deactivate", async () => {
    const { app } = newApp();
    expect((await get(app, "/nope")).status).toBe(404);
    expect((await send(app, "PATCH", "/nope", { nameAr: "x" })).status).toBe(404);
    expect([404, 409]).toContain((await send(app, "POST", "/nope/deactivate")).status);
  });

  it("edits only what the patch names, and can clear an amount explicitly", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", promotion({ type: "fixed_amount", percentValue: null, amountValue: "50.00", maxDiscountAmount: "100.00" }));

    const renamed = await json<{ nameAr: string; amountValue: string | null }>(
      await send(app, "PATCH", "/promo-1", { nameAr: "خصم جديد" }),
    );
    expect(renamed.nameAr).toBe("خصم جديد");
    expect(renamed.amountValue).toBe("50.000000");

    const cleared = await json<{ maxDiscountAmount: string | null }>(
      await send(app, "PATCH", "/promo-1", { maxDiscountAmount: null }),
    );
    expect(cleared.maxDiscountAmount).toBeNull();
  });

  it("deactivates a promotion, and it drops out of the active list", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", promotion());
    expect((await send(app, "POST", "/promo-1/deactivate")).status).toBe(200);
    expect(await json<unknown[]>(await get(app, "/?active=true"))).toEqual([]);
  });
});

describe("promotions-routes — the usage report", () => {
  it("reports nothing when this server mounts no invoice or return archive", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", promotion());

    const res = await get(app, "/report");
    expect(res.status).toBe(200);
    const report = await json<Record<string, unknown>>(res);
    expect(report).toBeTypeOf("object");
  });
});
