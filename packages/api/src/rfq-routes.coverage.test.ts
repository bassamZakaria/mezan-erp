import { describe, it, expect, afterEach } from "vitest";
import { NextNumberService, type PurchaseOrder, type PurchaseOrderRepository, type PurchaseRfq, type PurchaseRfqRepository, type RfqQuote, type RfqQuoteRepository } from "@mezan/domain";
import { createSqliteSequenceStore } from "@mezan/persistence";
import { createRfqRoutes } from "./rfq-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

class InMemoryRfqRepo implements PurchaseRfqRepository {
  private readonly rows = new Map<string, PurchaseRfq>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async create(rfq: PurchaseRfq) {
    this.rows.set(rfq.id, rfq);
  }
  async update(rfq: PurchaseRfq) {
    this.rows.set(rfq.id, rfq);
  }
}

class InMemoryQuoteRepo implements RfqQuoteRepository {
  private readonly rows = new Map<string, RfqQuote>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByRfq(rfqId: string) {
    return [...this.rows.values()].filter((q) => q.rfqId === rfqId);
  }
  async create(quote: RfqQuote) {
    this.rows.set(quote.id, quote);
  }
}

class InMemoryOrderRepo implements PurchaseOrderRepository {
  private readonly rows = new Map<string, PurchaseOrder>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async create(order: PurchaseOrder) {
    this.rows.set(order.id, order);
  }
  async update(order: PurchaseOrder) {
    this.rows.set(order.id, order);
  }
}

function newApp() {
  const seq = createSqliteSequenceStore(":memory:");
  closers.push(seq);
  const numbering = new NextNumberService(seq);
  const rfqs = new InMemoryRfqRepo();
  const quotes = new InMemoryQuoteRepo();
  const orders = new InMemoryOrderRepo();
  const app = createRfqRoutes({ rfqs, quotes, orders, numbering, now: () => "2026-08-21T09:00:00.000Z" });
  return { app, rfqs, quotes, orders };
}

const ADMIN = "*";
function req(path: string, init: RequestInit & { permissions?: string; branchScope?: string; warehouseScope?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.warehouseScope !== undefined) headers.set("x-warehouse-scope", init.warehouseScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

function rfqBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "rfq-1",
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    lines: [
      { itemId: "item-A", qty: "10" },
      { itemId: "item-B", qty: "5" },
    ],
    ...overrides,
  };
}

async function createRfqAt(app: ReturnType<typeof newApp>["app"], overrides: Record<string, unknown> = {}) {
  const res = await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(rfqBody(overrides)) }));
  return res;
}

describe("rfq-routes — create validation and duplicates", () => {
  it("422s a create whose branch is blank once trimmed, even though it clears the length check", async () => {
    const res = await createRfqAt(newApp().app, { branchId: " ", id: "rfq-blank" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: string[] };
    expect(body.error).toBe("INVALID_RFQ");
    expect(body.reasons).toContain("a branch is required");
  });

  it("409s creating an RFQ whose id already exists", async () => {
    const { app } = newApp();
    const first = await createRfqAt(app);
    expect(first.status).toBe(201);
    const second = await createRfqAt(app);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("DUPLICATE_PURCHASE_DOCUMENT");
  });
});

describe("rfq-routes — quotes validation and refusals", () => {
  async function sentRfq(app: ReturnType<typeof newApp>["app"]) {
    await createRfqAt(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
  }

  it("400s an invalid quote body (missing lines)", async () => {
    const { app } = newApp();
    await sentRfq(app);
    const res = await app.fetch(
      req("/rfq-1/quotes", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "quote-1", supplierId: "sup-1", lines: [] }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("422s a quote for an item that isn't a line on the RFQ", async () => {
    const { app } = newApp();
    await sentRfq(app);
    const res = await app.fetch(
      req("/rfq-1/quotes", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "quote-1", supplierId: "sup-1", lines: [{ itemId: "item-not-on-rfq", unitPrice: "10.00" }] }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: string[] };
    expect(body.error).toBe("INVALID_RFQ");
    expect(body.reasons[0]).toContain('item "item-not-on-rfq" is not on this RFQ');
  });

  it("404s recording a quote against a non-existent RFQ", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope/quotes", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "quote-1", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: "10.00" }] }) }),
    );
    expect(res.status).toBe(404);
  });

  it("409s recording a quote against a draft (not yet sent) RFQ", async () => {
    const { app } = newApp();
    await createRfqAt(app);
    const res = await app.fetch(
      req("/rfq-1/quotes", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "quote-1", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: "10.00" }] }) }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("RFQ_NOT_SENT");
  });
});

describe("rfq-routes — comparison and convert refusals", () => {
  it("404s a comparison request for a non-existent RFQ", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope/comparison", { permissions: ADMIN }));
    expect(res.status).toBe(404);
  });

  it("400s an invalid convert body (missing supplierId)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/rfq-1/convert", { method: "POST", permissions: ADMIN, body: JSON.stringify({ purchaseOrderId: "po-1" }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("404s converting a quote from a supplier who never quoted this RFQ", async () => {
    const { app } = newApp();
    await createRfqAt(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    const res = await app.fetch(
      req("/rfq-1/convert", { method: "POST", permissions: ADMIN, body: JSON.stringify({ purchaseOrderId: "po-1", supplierId: "sup-ghost" }) }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("RFQ_QUOTE_NOT_FOUND");
  });

  it("422s converting a quote that skipped one of the RFQ's lines", async () => {
    const { app } = newApp();
    await createRfqAt(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/rfq-1/quotes", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "quote-partial", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: "20.00" }] }),
      }),
    );
    const res = await app.fetch(
      req("/rfq-1/convert", { method: "POST", permissions: ADMIN, body: JSON.stringify({ purchaseOrderId: "po-1", supplierId: "sup-1" }) }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: string[] };
    expect(body.error).toBe("INVALID_RFQ");
    expect(body.reasons[0]).toContain('did not quote item "item-B"');
  });
});

describe("rfq-routes — list filters reach the wire", () => {
  async function twoBranchTenant() {
    const { app } = newApp();
    await createRfqAt(app, { id: "rfq-1", branchId: "BRANCH-A", warehouseId: "WH-A", date: "2026-08-01" });
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    await createRfqAt(app, { id: "rfq-2", branchId: "BRANCH-B", warehouseId: "WH-B", date: "2026-08-15" });
    return app;
  }

  it("status=all is the same as no status filter", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/?status=all", { permissions: ADMIN }));
    expect((await res.json()) as unknown[]).toHaveLength(2);
  });

  it("status=draft narrows the list to draft RFQs only", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/?status=draft", { permissions: ADMIN }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["rfq-2"]);
  });

  it("fromDate and toDate narrow the list by date range", async () => {
    const app = await twoBranchTenant();
    const fromRes = await app.fetch(req("/?fromDate=2026-08-10", { permissions: ADMIN }));
    expect(((await fromRes.json()) as { id: string }[]).map((r) => r.id)).toEqual(["rfq-2"]);

    const toRes = await app.fetch(req("/?toDate=2026-08-10", { permissions: ADMIN }));
    expect(((await toRes.json()) as { id: string }[]).map((r) => r.id)).toEqual(["rfq-1"]);
  });

  it("branchId and warehouseId narrow the list", async () => {
    const app = await twoBranchTenant();
    const branchRes = await app.fetch(req("/?branchId=BRANCH-B", { permissions: ADMIN }));
    expect(((await branchRes.json()) as { id: string }[]).map((r) => r.id)).toEqual(["rfq-2"]);

    const warehouseRes = await app.fetch(req("/?warehouseId=WH-A", { permissions: ADMIN }));
    expect(((await warehouseRes.json()) as { id: string }[]).map((r) => r.id)).toEqual(["rfq-1"]);
  });

  it("search narrows the list by RFQ number, case-insensitively", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/?search=rfq-000002", { permissions: ADMIN }));
    expect(((await res.json()) as { id: string }[]).map((r) => r.id)).toEqual(["rfq-2"]);
  });

  it("branch scope header narrows the list and no query parameter can widen it", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/?branchId=BRANCH-A", { permissions: ADMIN, branchScope: "BRANCH-B" }));
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("/counts ignores its own status filter but honours every other axis", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/counts?status=draft&branchId=BRANCH-A", { permissions: ADMIN }));
    const counts = (await res.json()) as Record<string, number>;
    expect(counts.all).toBe(1);
    expect(counts.sent).toBe(1);
    expect(counts.draft).toBe(0);
  });

  it("/stats honours the status filter, unlike /counts", async () => {
    const app = await twoBranchTenant();
    const res = await app.fetch(req("/stats?status=sent", { permissions: ADMIN }));
    const stats = (await res.json()) as { count: number; draft: number; sent: number; closed: number };
    expect(stats.count).toBe(1);
    expect(stats.sent).toBe(1);
    expect(stats.draft).toBe(0);
  });
});
