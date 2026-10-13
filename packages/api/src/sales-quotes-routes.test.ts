import { describe, it, expect, afterEach } from "vitest";
import { NextNumberService } from "@mezan/domain";
import { createSqliteSalesQuoteStore, type SqliteSalesQuoteStoreHandle } from "@mezan/persistence";
import { createSalesQuotesRoutes, type SalesQuoteRoutesDeps } from "./sales-quotes-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
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

function harness(extra: Partial<SalesQuoteRoutesDeps> = {}) {
  const repo = createSqliteSalesQuoteStore();
  closers.push(repo);

  const numbering = new NextNumberService(new MemSeq());
  const deps: SalesQuoteRoutesDeps = {
    repo,
    // guards N-9 — the routes only enforce optimistic concurrency when a guard is wired.
    versionGuard: { versions: repo.versions },
    numbering: { next: () => numbering.next("SALES_QUOTE") },
    now: () => NOW,
    idGen: (() => {
      let n = 0;
      return () => `qt-${++n}`;
    })(),
    ...extra,
  };
  return { app: createSalesQuotesRoutes(deps, insecureHeaderAuthContextResolver), repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  headers.set("x-user-id", "u1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const draftBody = {
  date: "2026-08-22",
  expiryDate: "2026-09-21",
  customerId: "cust-1",
  customerNameAr: "محمد الشهابي",
  branchId: "BR1",
  lines: [
    { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", qty: "10", unitPrice: "25", taxRatePercent: 14 },
    { lineId: "L2", itemId: "SVC-1", itemNameAr: "خدمة", qty: "2", unitPrice: "50", discountPercent: 10, taxRatePercent: 14 },
  ],
};

describe("sales-quotes routes — the search names the customer", () => {
  it("finds a customer's quotes by the directory's Arabic or English name, any case, padded, in the rows and the chips", async () => {
    const { app } = harness({
      customers: {
        findAll: async () => [
          { id: "cust-1", nameAr: "مؤسسة النور للمقاولات", nameEn: "Al Noor Contracting" },
          { id: "cust-2", nameAr: "شركة الأمل التجارية", nameEn: "Al Amal Trading" },
        ],
      },
    });
    const create = (body: unknown) => app.fetch(req("/", { method: "POST", body: JSON.stringify(body), permissions: "sales.quote.create" }));
    const first = (await (await create({ ...draftBody, customerNameAr: "مؤسسة النور للمقاولات" })).json()) as { id: string };
    await create({ ...draftBody, customerId: "cust-2", customerNameAr: "شركة الأمل التجارية" });
    const view = { permissions: "sales.quote.view" };
    for (const term of ["النور", "al noor", "  NOOR  "]) {
      const rows = (await (await app.fetch(req(`/?search=${encodeURIComponent(term)}`, view))).json()) as { id: string }[];
      expect(rows.map((r) => r.id), term).toEqual([first.id]);
    }
    const counts = (await (await app.fetch(req(`/counts?search=${encodeURIComponent("noor")}`, view))).json()) as Record<string, number>;
    expect(counts.all).toBe(1);
    expect(await (await app.fetch(req(`/?search=${encodeURIComponent("لا أحد")}`, view))).json()).toEqual([]);
  });
});

describe("sales-quotes routes", () => {
  it("rejects an unauthenticated create with 403", async () => {
    const { app } = harness();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody) }));
    expect(res.status).toBe(403);
  });

  it("creates a draft, lists it, then sends it — allocating a doc number", async () => {
    const { app } = harness();

    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    expect(create.status).toBe(201);
    const draft = (await create.json()) as any;
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();
    expect(draft.totals.grandTotal).toBe("387.600000");
    const id = draft.id;

    const list = await app.fetch(req("/", { permissions: "sales.quote.view" }));
    expect(list.status).toBe(200);
    expect((await list.json()) as any).toHaveLength(1);

    const send = await app.fetch(req(`/${id}/send`, { method: "POST", permissions: "sales.quote.send" }));
    expect(send.status).toBe(200);
    const sent = (await send.json()) as any;
    expect(sent.status).toBe("sent");
    expect(sent.docNo).toBe("QT-000001");
    expect(sent.sentAt).toBe(NOW);
  });

  it("forbids send without the send permission", async () => {
    const { app } = harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const { id } = (await create.json()) as any;
    const res = await app.fetch(req(`/${id}/send`, { method: "POST", permissions: "sales.quote.view" }));
    expect(res.status).toBe(403);
  });

  it("send → accept happy path", async () => {
    const { app } = harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/send`, { method: "POST", permissions: "sales.quote.send" }));

    const accept = await app.fetch(req(`/${id}/accept`, { method: "POST", permissions: "sales.quote.edit" }));
    expect(accept.status).toBe(200);
    const accepted = (await accept.json()) as any;
    expect(accepted.status).toBe("accepted");
    expect(accepted.respondedAt).toBe(NOW);
  });

  it("send → reject path", async () => {
    const { app } = harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const { id } = (await create.json()) as any;
    await app.fetch(req(`/${id}/send`, { method: "POST", permissions: "sales.quote.send" }));

    const reject = await app.fetch(req(`/${id}/reject`, { method: "POST", permissions: "sales.quote.edit" }));
    expect(reject.status).toBe(200);
    const rejected = (await reject.json()) as any;
    expect(rejected.status).toBe("rejected");
    expect(rejected.respondedAt).toBe(NOW);
  });

  it("cancel path from draft", async () => {
    const { app } = harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const { id } = (await create.json()) as any;

    const cancel = await app.fetch(req(`/${id}/cancel`, { method: "POST", permissions: "sales.quote.edit" }));
    expect(cancel.status).toBe(200);
    const cancelled = (await cancel.json()) as any;
    expect(cancelled.status).toBe("cancelled");
  });

  it("returns 404 for a missing quote", async () => {
    const { app } = harness();
    const res = await app.fetch(req("/missing", { permissions: "sales.quote.view" }));
    expect(res.status).toBe(404);

    const sendRes = await app.fetch(req("/missing/send", { method: "POST", permissions: "sales.quote.send" }));
    expect(sendRes.status).toBe(404);
  });

  it("returns 409 on an invalid transition", async () => {
    const { app } = harness();
    const create = await app.fetch(req("/", { method: "POST", body: JSON.stringify(draftBody), permissions: "sales.quote.create" }));
    const { id } = (await create.json()) as any;

    // draft cannot go straight to accepted
    const res = await app.fetch(req(`/${id}/accept`, { method: "POST", permissions: "sales.quote.edit" }));
    expect(res.status).toBe(409);
  });

  it("returns 409 creating a duplicate id", async () => {
    const { app } = harness();
    const withId = { ...draftBody, id: "qt-fixed" };
    const first = await app.fetch(req("/", { method: "POST", body: JSON.stringify(withId), permissions: "sales.quote.create" }));
    expect(first.status).toBe(201);
    const second = await app.fetch(req("/", { method: "POST", body: JSON.stringify(withId), permissions: "sales.quote.create" }));
    expect(second.status).toBe(409);
  });

  it("validates the request body", async () => {
    const { app } = harness();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ ...draftBody, lines: [] }), permissions: "sales.quote.create" }));
    expect(res.status).toBe(400);
  });
});

/**
 * guards N-9 — every quote transition (send / accept / reject / cancel) is
 * driven from the LIST row's kebab, never from a detail read. A list that omits
 * `version` leaves the row with nothing to send back as `expectedVersion`, and
 * the optimistic guard silently never fires.
 */
describe("sales-quotes routes — the list row carries the version the kebab acts on", () => {
  it("serves a version on every row, and refuses a stale one with 409", async () => {
    const { app, repo } = harness();
    await app.fetch(req("/", { method: "POST", permissions: "sales.quote.create", body: JSON.stringify(draftBody) }));

    const rows = (await (await app.fetch(req("/", { permissions: "sales.quote.view" }))).json()) as {
      id: string;
      version: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    const staleVersion = rows[0]!.version;

    // Another till gets there first.
    const won = await app.fetch(req(`/${rows[0]!.id}/send`, { method: "POST", permissions: "sales.quote.send" }));
    expect(won.status).toBe(200);
    expect((await repo.versions.read(rows[0]!.id))!.version).toBeGreaterThan(staleVersion);

    const refused = await app.fetch(
      req(`/${rows[0]!.id}/cancel`, {
        method: "POST",
        permissions: "sales.quote.edit",
        body: JSON.stringify({ expectedVersion: staleVersion }),
      }),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("DOCUMENT_VERSION_CONFLICT");
  });
});

describe("sales quotes — a rep holding only view_own (D70)", () => {
  const VIEW_OWN = "sales.quote.view_own";
  const CREATE = "sales.quote.create";

  function scoped(path: string, permissions: string, branchScope?: string) {
    const headers = new Headers({ "x-permissions": permissions, "x-user-id": "rep-1" });
    if (branchScope !== undefined) headers.set("x-branch-scope", branchScope);
    return new Request(`http://local${path}`, { headers });
  }

  async function seedTwoBranches(app: ReturnType<typeof harness>["app"]) {
    for (const branchId of ["BR1", "BR2"]) {
      const res = await app.fetch(
        req("/", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...draftBody, branchId }) }),
      );
      expect(res.status).toBe(201);
    }
  }

  it("no longer answers 403 — the rep can list, count and stat their own quotes", async () => {
    const { app } = harness();
    await seedTwoBranches(app);
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await app.fetch(scoped(path, VIEW_OWN, "BR1"));
      expect(res.status).toBe(200);
    }
  });

  it("shows a view_own rep only the branch they are scoped to", async () => {
    const { app } = harness();
    await seedTwoBranches(app);
    const rows = (await (await app.fetch(scoped("/", VIEW_OWN, "BR1"))).json()) as { branchId: string }[];
    expect(rows.map((r) => r.branchId)).toEqual(["BR1"]);
  });

  it("shows a view_own rep carrying the all-branch sentinel nothing, rather than the whole tenant", async () => {
    const { app } = harness();
    await seedTwoBranches(app);
    const rows = (await (await app.fetch(scoped("/", VIEW_OWN, "*"))).json()) as unknown[];
    expect(rows).toEqual([]);
  });

  it("still shows a full sales.quote.view caller every branch", async () => {
    const { app } = harness();
    await seedTwoBranches(app);
    const rows = (await (await app.fetch(scoped("/", "sales.quote.view", "*"))).json()) as { branchId: string }[];
    expect(rows.map((r) => r.branchId).sort()).toEqual(["BR1", "BR2"]);
  });

  it("404s a quote outside the caller's branch scope instead of serving it by id", async () => {
    const { app } = harness();
    await seedTwoBranches(app);
    const all = (await (await app.fetch(scoped("/", "sales.quote.view", "*"))).json()) as { id: string; branchId: string }[];
    const other = all.find((q) => q.branchId === "BR2");
    expect(other).toBeDefined();
    const res = await app.fetch(scoped(`/${other?.id}`, "sales.quote.view", "BR1"));
    expect(res.status).toBe(404);
  });
});
