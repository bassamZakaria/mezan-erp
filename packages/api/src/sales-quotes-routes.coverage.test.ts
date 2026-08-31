import { describe, it, expect, afterEach } from "vitest";
import { NextNumberService } from "@mezan/domain";
import { createSqliteSalesQuoteStore, type SqliteSalesQuoteStoreHandle } from "@mezan/persistence";
import { createSalesQuotesRoutes, type SalesQuoteRoutesDeps } from "./sales-quotes-routes.js";

const NOW = "2026-08-22T10:00:00.000Z";

class MemSeq {
  m = new Map<string, number>();
  async increment(code: string, period: number | null) {
    const k = `${code}:${period ?? ""}`;
    const n = (this.m.get(k) ?? 0) + 1;
    this.m.set(k, n);
    return n;
  }
}

const closers: SqliteSalesQuoteStoreHandle[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function harness(opts: { knownItems?: readonly string[] } = {}) {
  const repo = createSqliteSalesQuoteStore();
  closers.push(repo);

  const numbering = new NextNumberService(new MemSeq());
  const deps: SalesQuoteRoutesDeps = {
    repo,
    numbering: { next: () => numbering.next("SALES_QUOTE") },
    now: () => NOW,
    idGen: (() => {
      let n = 0;
      return () => `gen-${++n}`;
    })(),
    itemCheck: opts.knownItems
      ? { findById: async (id: string) => (opts.knownItems!.includes(id) ? { id } : null) }
      : undefined,
  };
  return { app: createSalesQuotesRoutes(deps), repo };
}

type App = ReturnType<typeof harness>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string; branchScope?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", "u1");
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: "qt-1",
    date: "2026-08-22",
    expiryDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    branchId: "BR1",
    lines: [{ lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", qty: "10", unitPrice: "25", taxRatePercent: 14 }],
    ...overrides,
  };
}

describe("sales-quotes-routes — the list, its chips and its money strip", () => {
  async function seeded(app: App) {
    // qt-1: sent, still valid
    await post(app, "/", quote());
    await post(app, "/qt-1/send");
    // qt-2: accepted, expired yesterday, a different branch and customer
    await post(
      app,
      "/",
      quote({
        id: "qt-2",
        date: "2026-08-01",
        expiryDate: "2026-08-21",
        customerId: "cust-2",
        customerNameAr: "سعاد",
        branchId: "BR2",
      }),
    );
    await post(app, "/qt-2/send");
    await post(app, "/qt-2/accept");
    // qt-3: still a draft
    await post(app, "/", quote({ id: "qt-3" }));
  }

  async function idsOf(app: App, query: string, init: ReqInit = {}) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`, init));
    return rows.map((r) => r.id);
  }

  it("filters by stored status, the derived expired bucket, customer, dates, branch and text", async () => {
    const { app } = harness();
    await seeded(app);

    expect(await idsOf(app, "")).toHaveLength(3);
    expect(await idsOf(app, "?status=all")).toHaveLength(3);
    expect(await idsOf(app, "?status=draft")).toEqual(["qt-3"]);
    expect(await idsOf(app, "?status=sent")).toEqual(["qt-1"]);
    expect(await idsOf(app, "?status=expired")).toEqual(["qt-2"]);
    expect(await idsOf(app, "?customerId=cust-2")).toEqual(["qt-2"]);
    expect(await idsOf(app, "?fromDate=2026-08-10")).toEqual(expect.arrayContaining(["qt-1", "qt-3"]));
    expect(await idsOf(app, "?toDate=2026-08-10")).toEqual(["qt-2"]);
    expect(await idsOf(app, "?branchId=BR2")).toEqual(["qt-2"]);
    expect(await idsOf(app, "?search=سعاد")).toEqual(["qt-2"]);
    expect(await idsOf(app, "?search=QT-000001")).toEqual(["qt-1"]);
    expect(await idsOf(app, "?search=%20%20")).toHaveLength(3);
  });

  it("never lets a branch parameter widen the caller's branch scope", async () => {
    const { app } = harness();
    await seeded(app);

    expect(await idsOf(app, "", { branchScope: "BR2" })).toEqual(["qt-2"]);
    expect(await idsOf(app, "?branchId=BR1", { branchScope: "BR2" })).toEqual([]);
  });

  it("counts every chip, expiry included, from the set the rows came from", async () => {
    const { app } = harness();
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=draft"));
    expect(counts).toMatchObject({
      all: 3,
      draft: 1,
      sent: 1,
      accepted: 1,
      rejected: 0,
      converted: 0,
      cancelled: 0,
      expired: 1,
    });

    const forOneCustomer = await json<Record<string, number>>(await get(app, "/counts?customerId=cust-2"));
    expect(forOneCustomer.all).toBe(1);
  });

  it("sums the pipeline in Money, splitting out accepted and converted", async () => {
    const { app } = harness();
    await seeded(app);

    const stats = await json<{ count: number; total: string; accepted: string; converted: string }>(
      await get(app, "/stats"),
    );
    expect(stats.count).toBe(3);
    expect(stats.total).toBe("855.000000");
    expect(stats.accepted).toBe("285.000000");
    expect(stats.converted).toBe("0.000000");

    // The strip honours its own status filter, unlike the chips.
    const draftOnly = await json<{ count: number; total: string }>(await get(app, "/stats?status=draft"));
    expect(draftOnly).toMatchObject({ count: 1, total: "285.000000" });
  });

  it("400s a list, counts or stats query carrying a status the contract does not know", async () => {
    const { app } = harness();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await get(app, `${path}?status=imaginary`);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
    }
  });
});

describe("sales-quotes-routes — the lifecycle and its refusals", () => {
  it("mints an id when the caller supplies none", async () => {
    const { app } = harness();
    const res = await post(app, "/", { ...quote(), id: undefined });
    expect(res.status).toBe(201);
    expect((await json<{ id: string; docNo: string | null }>(res)).id).toBe("gen-1");
  });

  it("400s a create body the schema rejects, and 422s one the domain refuses", async () => {
    const { app } = harness();
    expect((await post(app, "/", { date: "2026-08-22" })).status).toBe(400);

    const noLines = await post(app, "/", quote({ lines: [] }));
    expect([400, 422]).toContain(noLines.status);
  });

  it("422s a line naming an item the catalogue does not hold (D38)", async () => {
    const { app } = harness({ knownItems: ["ITEM-A"] });
    const res = await post(
      app,
      "/",
      quote({ lines: [{ lineId: "L1", itemId: "ITEM-1", itemNameAr: "مخترع", qty: "1", unitPrice: "5", taxRatePercent: 0 }] }),
    );
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("ITEM_NOT_FOUND");
  });

  it("404s a read or a transition naming a quote that is not there", async () => {
    const { app } = harness();
    expect((await get(app, "/nope")).status).toBe(404);
    for (const action of ["send", "accept", "reject", "cancel"]) {
      expect((await post(app, `/nope/${action}`)).status).toBe(404);
    }
  });

  it("409s a transition the lifecycle does not allow", async () => {
    const { app } = harness();
    await post(app, "/", quote());
    // A draft cannot be accepted before it is sent.
    expect((await post(app, "/qt-1/accept")).status).toBe(409);

    await post(app, "/qt-1/send");
    expect((await post(app, "/qt-1/send")).status).toBe(409);

    await post(app, "/qt-1/reject");
    expect((await post(app, "/qt-1/accept")).status).toBe(409);
  });

  it("409s a second quote reusing an id already in the books", async () => {
    const { app } = harness();
    await post(app, "/", quote());
    expect((await post(app, "/", quote())).status).toBe(409);
  });

  it("cancels a sent quote", async () => {
    const { app } = harness();
    await post(app, "/", quote());
    await post(app, "/qt-1/send");
    const res = await post(app, "/qt-1/cancel");
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe("cancelled");
  });

  it("carries a header discount through to the totals", async () => {
    const { app } = harness();
    const percent = await json<{ totals: { grandTotal: string } }>(
      await post(app, "/", quote({ discount: { type: "percent", percent: 10 } })),
    );
    expect(percent.totals.grandTotal).toBe("256.500000");

    const amount = await json<{ totals: { grandTotal: string } }>(
      await post(app, "/", quote({ id: "qt-2", discount: { type: "amount", amount: "25.00" } })),
    );
    expect(amount.totals.grandTotal).toBe("256.500000");
  });

  it("403s each write for a caller who may only view", async () => {
    const { app } = harness();
    await post(app, "/", quote());
    const viewOnly = { permissions: "sales.quote.view" };
    expect((await post(app, "/", quote({ id: "qt-2" }), viewOnly)).status).toBe(403);
    expect((await post(app, "/qt-1/send", undefined, viewOnly)).status).toBe(403);
    expect((await post(app, "/qt-1/accept", undefined, viewOnly)).status).toBe(403);
  });
});

describe("sales-quotes-routes — converting to an invoice", () => {
  const convertBody = {
    warehouseId: "WH1",
    arAccountId: "1300",
    taxAccountId: "2200",
    lines: [{ lineId: "L1", isStock: true, revenueAccountId: "4000", cogsAccountId: "5000", inventoryAccountId: "1200" }],
  };

  it("501s when this server mounts no invoice module at all", async () => {
    const { app } = harness();
    await post(app, "/", quote());
    const res = await post(app, "/qt-1/convert-to-invoice", convertBody);
    expect(res.status).toBe(501);
    expect((await json<{ error: string }>(res)).error).toBe("CONVERT_NOT_CONFIGURED");
  });
});
