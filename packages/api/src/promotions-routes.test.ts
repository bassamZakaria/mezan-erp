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
  const app = createPromotionsRoutes(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = {
  id: "promo-1",
  code: "SUMMER10",
  nameAr: "خصم الصيف",
  type: "percentage" as const,
  percentValue: 10,
  startDate: "2020-01-01",
  endDate: "2099-12-31",
};

describe("promotions router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("sales.promotion.view");
  });

  it("allows GET / with sales.promotion.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "sales.promotion.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.promotion.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with sales.promotion.manage", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "*" }));
    expect(res.status).toBe(200);
  });

  it("/evaluate is gated on sales.invoice.create, not the promotion permissions", async () => {
    const { app } = newApp();
    const forbidden = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.promotion.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: [] }),
      }),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.invoice.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: [] }),
      }),
    );
    expect(allowed.status).toBe(200);
  });
});

describe("promotions router — CRUD", () => {
  it("creates a promotion and retrieves it by id", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await app.fetch(req("/promo-1", { permissions: "sales.promotion.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { code: string; percentValue: number; active: boolean };
    expect(body).toMatchObject({ id: "promo-1", code: "SUMMER10", percentValue: 10, active: true, requiresCoupon: false });
  });

  it("404s for an unknown promotion", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "sales.promotion.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "X" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate promotion code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "promo-2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("422s an out-of-range percentValue with the reasons array", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.promotion.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, id: "promo-2", code: "BAD", percentValue: 150 }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reasons: string[] };
    expect(Array.isArray(body.reasons)).toBe(true);
  });

  it("PATCH edits a promotion", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/promo-1", { method: "PATCH", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ priority: 5 }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { priority: number }).priority).toBe(5);
  });

  it("PATCH 404s an unknown promotion", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", { method: "PATCH", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ priority: 5 }) }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /:id/deactivate flips active to false", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/promo-1/deactivate", { method: "POST", permissions: "sales.promotion.manage" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { active: boolean }).active).toBe(false);
  });

  it("GET / with ?active= filters by status", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    await app.fetch(req("/promo-1/deactivate", { method: "POST", permissions: "sales.promotion.manage" }));

    const activeRes = await app.fetch(req("/?active=true", { permissions: "sales.promotion.view" }));
    expect((await activeRes.json()) as unknown[]).toHaveLength(0);

    const inactiveRes = await app.fetch(req("/?active=false", { permissions: "sales.promotion.view" }));
    expect((await inactiveRes.json()) as unknown[]).toHaveLength(1);
  });
});

describe("promotions router — /evaluate", () => {
  it("returns the applicable percentage promotion with its discount breakdown", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

    const res = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.invoice.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ lineId: "L1", itemId: "A", qty: "2", unitPrice: "50.00" }],
          date: "2026-06-15",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applicable: boolean;
      promotion: { id: string };
      discountTotal: string;
      lineDiscounts: { lineId: string; amount: string }[];
    };
    expect(body.applicable).toBe(true);
    expect(body.promotion.id).toBe("promo-1");
    expect(body.discountTotal).toBe("10.000000"); // 10% of 100.00
    expect(body.lineDiscounts).toEqual([{ lineId: "L1", amount: "10.000000" }]);
  });

  it("returns not-applicable when nothing is eligible", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.invoice.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: [{ lineId: "L1", itemId: "A", qty: "1", unitPrice: "10.00" }] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applicable: boolean; promotion: null };
    expect(body.applicable).toBe(false);
    expect(body.promotion).toBeNull();
  });

  it("only applies a coupon-required promotion when the coupon code matches", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.promotion.manage",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, id: "promo-coupon", code: "SAVE20", percentValue: 20, requiresCoupon: true }),
      }),
    );

    const withoutCoupon = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.invoice.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: [{ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" }], date: "2026-06-15" }),
      }),
    );
    expect(((await withoutCoupon.json()) as { applicable: boolean }).applicable).toBe(false);

    const withCoupon = await app.fetch(
      req("/evaluate", {
        method: "POST",
        permissions: "sales.invoice.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" }],
          couponCode: "save20",
          date: "2026-06-15",
        }),
      }),
    );
    const body = (await withCoupon.json()) as { applicable: boolean; promotion: { id: string }; discountTotal: string };
    expect(body.applicable).toBe(true);
    expect(body.promotion.id).toBe("promo-coupon");
    expect(body.discountTotal).toBe("20.000000");
  });
});

describe("promotions router — /report", () => {
  it("returns an honest zero-usage stub for active-in-range promotions", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.promotion.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

    const res = await app.fetch(req("/report?dateFrom=2026-01-01&dateTo=2026-12-31", { permissions: "sales.promotion.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; usageCount: number; discountGranted: string; reversedDiscount: string; netDiscount: string }[];
    expect(body).toEqual([
      {
        id: "promo-1",
        code: "SUMMER10",
        nameAr: "خصم الصيف",
        usageCount: 0,
        discountGranted: "0.000000",
        reversedDiscount: "0.000000",
        netDiscount: "0.000000",
      },
    ]);
  });

  it("rejects /report without sales.promotion.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/report"));
    expect(res.status).toBe(403);
  });
});
