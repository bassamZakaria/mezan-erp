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

function harness() {
  const repo = createSqliteSalesQuoteStore();
  closers.push(repo);

  const numbering = new NextNumberService(new MemSeq());
  const deps: SalesQuoteRoutesDeps = {
    repo,
    numbering: { next: () => numbering.next("SALES_QUOTE") },
    now: () => NOW,
    idGen: (() => {
      let n = 0;
      return () => `qt-${++n}`;
    })(),
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
