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
function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const createBody = {
  id: "rfq-1",
  date: "2026-08-21",
  branchId: "MAIN",
  warehouseId: "MAIN-WH",
  lines: [
    { itemId: "item-A", qty: "10" },
    { itemId: "item-B", qty: "5" },
  ],
};

async function createDraftRfq(app: ReturnType<typeof newApp>["app"]) {
  const res = await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(createBody) }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; number: string; status: string };
}

describe("rfq-routes — create / list / get / counts", () => {
  it("creates a draft RFQ with string qty and RFQ-000001 numbering", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(createBody) }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; number: string; status: string; lines: { qty: string }[] };
    expect(body.id).toBe("rfq-1");
    expect(body.number).toBe("RFQ-000001");
    expect(body.status).toBe("draft");
    expect(body.lines[0]?.qty).toBe("10.000000");
  });

  it("400s an invalid create body (missing lines)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "rfq-x", date: "2026-08-21", branchId: "MAIN", warehouseId: "MAIN-WH", lines: [] }) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("lists RFQs and gets one by id, 404s a missing one", async () => {
    const { app } = newApp();
    await createDraftRfq(app);

    const listRes = await app.fetch(req("/", { permissions: ADMIN }));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()) as unknown[]).toHaveLength(1);

    const getRes = await app.fetch(req("/rfq-1", { permissions: ADMIN }));
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { id: string }).id).toBe("rfq-1");

    const missingRes = await app.fetch(req("/nope", { permissions: ADMIN }));
    expect(missingRes.status).toBe(404);
  });

  it("counts RFQs by status", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(req("/counts", { permissions: ADMIN }));
    const counts = (await res.json()) as Record<string, number>;
    expect(counts.all).toBe(1);
    expect(counts.sent).toBe(1);
    expect(counts.draft).toBe(0);
  });
});

describe("rfq-routes — status transitions", () => {
  it("send: draft -> sent", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    const res = await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("sent");
  });

  it("send on a non-existent RFQ -> 404", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope/send", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(404);
  });

  it("send twice -> 409 (RFQ_NOT_DRAFT)", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    const res = await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("RFQ_NOT_DRAFT");
  });

  it("close: sent -> closed; close a draft -> 409 (RFQ_NOT_SENT)", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    const draftCloseRes = await app.fetch(req("/rfq-1/close", { method: "POST", permissions: ADMIN }));
    expect(draftCloseRes.status).toBe(409);
    expect(((await draftCloseRes.json()) as { error: string }).error).toBe("RFQ_NOT_SENT");

    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    const res = await app.fetch(req("/rfq-1/close", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("closed");
  });

  it("cancel: draft -> cancelled; cancelling a closed RFQ -> 409 (RFQ_NOT_OPEN)", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/rfq-1/close", { method: "POST", permissions: ADMIN }));
    const res = await app.fetch(req("/rfq-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("RFQ_NOT_OPEN");
  });
});

describe("rfq-routes — quotes, comparison, convert", () => {
  async function sentRfqWithTwoQuotes(app: ReturnType<typeof newApp>["app"]) {
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));

    await app.fetch(
      req("/rfq-1/quotes", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "quote-cheap",
          supplierId: "sup-1",
          lines: [
            { itemId: "item-A", unitPrice: "20.00" },
            { itemId: "item-B", unitPrice: "40.00" },
          ],
        }),
      }),
    );
    await app.fetch(
      req("/rfq-1/quotes", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "quote-expensive",
          supplierId: "sup-2",
          lines: [
            { itemId: "item-A", unitPrice: "30.00" },
            { itemId: "item-B", unitPrice: "45.00" },
          ],
        }),
      }),
    );
  }

  it("records a quote (201) and lists quotes for the RFQ", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));

    const postRes = await app.fetch(
      req("/rfq-1/quotes", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "quote-1",
          supplierId: "sup-1",
          lines: [
            { itemId: "item-A", unitPrice: "20.00" },
            { itemId: "item-B", unitPrice: "40.00" },
          ],
        }),
      }),
    );
    expect(postRes.status).toBe(201);
    const quote = (await postRes.json()) as { id: string; lines: { unitPrice: string }[] };
    expect(quote.id).toBe("quote-1");
    expect(quote.lines[0]?.unitPrice).toBe("20.000000");

    const listRes = await app.fetch(req("/rfq-1/quotes", { permissions: ADMIN }));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()) as unknown[]).toHaveLength(1);
  });

  it("builds a comparison grid picking the cheapest supplier per line and full-basket totals", async () => {
    const { app } = newApp();
    await sentRfqWithTwoQuotes(app);

    const res = await app.fetch(req("/rfq-1/comparison", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      supplierIds: string[];
      rows: { itemId: string; cheapestSupplierId: string | null; quotesBySupplier: Record<string, string> }[];
      totalsBySupplier: Record<string, string>;
    };

    expect(body.supplierIds.sort()).toEqual(["sup-1", "sup-2"]);
    const rowA = body.rows.find((r) => r.itemId === "item-A");
    expect(rowA?.cheapestSupplierId).toBe("sup-1");
    expect(rowA?.quotesBySupplier["sup-1"]).toBe("20.000000");
    expect(rowA?.quotesBySupplier["sup-2"]).toBe("30.000000");

    const rowB = body.rows.find((r) => r.itemId === "item-B");
    expect(rowB?.cheapestSupplierId).toBe("sup-1");

    // sup-1: 20*10 + 40*5 = 400; sup-2: 30*10 + 45*5 = 525
    expect(body.totalsBySupplier["sup-1"]).toBe("400.000000");
    expect(body.totalsBySupplier["sup-2"]).toBe("525.000000");
  });

  it("converts the chosen quote into a real PO and closes the RFQ", async () => {
    const { app, orders } = newApp();
    await sentRfqWithTwoQuotes(app);

    const res = await app.fetch(
      req("/rfq-1/convert", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ purchaseOrderId: "po-1", supplierId: "sup-1" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { rfq: { status: string }; purchaseOrderId: string };
    expect(body.rfq.status).toBe("closed");
    expect(body.purchaseOrderId).toBe("po-1");

    const order = await orders.findById("po-1");
    expect(order).not.toBeNull();
    expect(order?.supplierId).toBe("sup-1");
    expect(order?.lines).toHaveLength(2);
    expect(order?.lines.find((l) => l.itemId === "item-A")?.unitPrice.toString()).toBe("20.000000");
  });

  it("converting an RFQ that isn't sent -> 409 (RFQ_NOT_SENT)", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    const res = await app.fetch(
      req("/rfq-1/convert", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ purchaseOrderId: "po-1", supplierId: "sup-1" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("RFQ_NOT_SENT");
  });
});

describe("rfq-routes — permission gates", () => {
  it("403s creating an RFQ without purchases.rfq.create", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: "purchases.rfq.view", body: JSON.stringify(createBody) }));
    expect(res.status).toBe(403);
  });

  it("403s listing RFQs without purchases.rfq.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "" }));
    expect(res.status).toBe(403);
  });

  it("403s converting without purchases.rfq.convert", async () => {
    const { app } = newApp();
    await createDraftRfq(app);
    await app.fetch(req("/rfq-1/send", { method: "POST", permissions: ADMIN }));
    const res = await app.fetch(
      req("/rfq-1/convert", {
        method: "POST",
        permissions: "purchases.rfq.view",
        body: JSON.stringify({ purchaseOrderId: "po-1", supplierId: "sup-1" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
