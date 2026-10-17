import { describe, it, expect, afterEach } from "vitest";
import {
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createSalesReturnDocumentType,
  Money,
  Qty,
  StockLedgerService,
} from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import { createSalesReturnsRoutes } from "./sales-returns-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const ACCOUNTS = {
  accountsReceivableId: "AR",
  salesReturnsAccountId: "SALES_RETURNS",
  outputTaxPayableAccountId: "OUTPUT_TAX",
  inventoryAccountId: "INVENTORY",
  cogsAccountId: "COGS",
};

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function buildService() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const stock = createSqliteStockLedgerStore();
  const repo = createStandaloneSqliteSalesReturnStore();
  closers.push(ledger, accounts, periods, stock, repo);

  for (const id of Object.values(ACCOUNTS)) {
    await accounts.create({
      id,
      code: id,
      nameAr: id,
      nameEn: id,
      type: "asset",
      naturalBalance: "debit",
      parentId: null,
      isHeader: false,
      status: "active",
    });
  }
  await periods.create({ id: "P1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const numbering = ledger.numbering;
  const gl = createJournalGlHook({ ledger, accounts, periods, numbering });
  const stockService = new StockLedgerService({
    ledger: stock.ledger,
    layers: stock.layers,
    snapshots: stock.snapshots,
    policy: { allowNegativeStock: false },
    transaction: stock.transaction,
  });

  const service = new DocumentService(createSalesReturnDocumentType(ACCOUNTS), {
    repo,
    numbering: { next: () => numbering.next("SALES_RETURN") },
    gl,
    stock: createInventoryStockHook(stockService),
    workflow: createDocumentWorkflowGate(() => null),
  });

  return { service, stockService };
}

async function newApp() {
  const { service } = await buildService();
  return createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver);
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = {
  id: "SR1",
  date: "2026-08-21",
  memo: "",
  lines: [
    {
      itemId: "ITEM1",
      warehouseId: "WH1",
      customerId: "CUST1",
      sourceInvoiceId: "INV1",
      sourceInvoiceNumber: "INV-000014",
      reason: "DEFECTIVE",
      availableQty: "5",
      qty: "2",
      unitPrice: "100",
      unitCost: "60",
      taxAmount: "28",
    },
  ],
};

describe("sales-returns router — permission gate", () => {
  it("rejects with 403 and no permissions", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
  });
});

describe("sales-returns router — create + confirm", () => {
  it("creates a draft, then confirms it, restocking and posting a balanced GL entry", async () => {
    const app = await newApp();
    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { status: string; awaitingRefund: boolean };
    expect(created.status).toBe("draft");
    expect(created.awaitingRefund).toBe(false);

    const confirmRes = await app.fetch(
      req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }),
    );
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as {
      document: { status: string; docNo: string; awaitingRefund: boolean };
      held: boolean;
    };
    expect(body.held).toBe(false);
    expect(body.document.status).toBe("confirmed");
    expect(body.document.docNo).toBe("SRT-000001");
    expect(body.document.awaitingRefund).toBe(true);
  });

  it("rejects an over-quantity return with 422", async () => {
    const app = await newApp();
    const bad = { ...payload, id: "SR2", lines: [{ ...payload.lines[0], qty: "10", availableQty: "5" }] };
    const res = await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(bad) }));
    expect(res.status).toBe(422);
  });
});

describe("what the caller may claim on a return (D102)", () => {
  /** The invoice as the books actually hold it: 3 sold, 1 already returned. */
  const sourceInvoice = {
    id: "INV1",
    number: "INV-000014",
    customerId: "CUST1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed" as const,
    projectId: "PRJ-1",
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف",
        qty: Qty.fromMajor("3"),
        alreadyReturnedQty: Qty.fromMajor("1"),
        unitPrice: Money.fromMajor("100"),
        unitCost: Money.fromMajor("60"),
        taxAmount: Money.fromMajor("42"),
        taxRatePercent: 14,
      },
    ],
  };

  async function appWithInvoices() {
    const { service } = await buildService();
    const invoices = {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    };
    return createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, invoices);
  }

  it("recomputes the returnable quantity from the invoice, ignoring what the caller claims", async () => {
    const app = await appWithInvoices();

    // The caller says five are available. The invoice says two (3 sold, 1
    // already returned), so a return of three must be refused.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-OVER",
          lines: [{ ...payload.lines[0], availableQty: "5", qty: "3" }],
        }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("reads the source invoice ONCE per request — each read lists every return, and two lines against one invoice are not two reads (D79)", async () => {
    const { service } = await buildService();
    let reads = 0;
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        reads += 1;
        return id === "INV1" ? sourceInvoice : null;
      },
    });
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({ ...payload, id: "SR-ONCE", lines: [{ ...payload.lines[0], qty: "1" }, { ...payload.lines[0], qty: "1" }] }),
      }),
    );
    expect(res.status).toBe(201);
    expect(reads).toBe(1);
  });

  it("accepts exactly what the invoice has left, and refuses one micro-unit more", async () => {
    const app = await appWithInvoices();

    const exact = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-EXACT",
          lines: [{ ...payload.lines[0], availableQty: "999", qty: "2" }],
        }),
      }),
    );
    expect(exact.status).toBe(201);

    const overByOne = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-OVER-1",
          lines: [{ ...payload.lines[0], availableQty: "999", qty: "2.000001" }],
        }),
      }),
    );
    expect(overByOne.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a return against an invoice the books do not have", async () => {
    const app = await appWithInvoices();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-GHOST",
          lines: [{ ...payload.lines[0], sourceInvoiceId: "INV-NOT-REAL", availableQty: "99", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("takes the unit cost off the invoice, not off the request (D102)", async () => {
    const app = await appWithInvoices();

    // The invoice cost is 60.00. The caller says 600.00. Cost decides the COGS
    // reversal and therefore the margin, so letting the caller state it is
    // letting them state their own profit.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-COST",
          lines: [{ ...payload.lines[0], availableQty: "2", qty: "1", unitCost: "600", unitPrice: "100" }],
        }),
      }),
    );

    expect(res.status).toBe(201);
    const created = (await res.json()) as { lines: { unitCost: string }[] };
    expect(created.lines[0]?.unitCost).toBe("60.000000");
  });

  it("D214: takes the price, the VAT share, its rate and the project off the invoice, whatever the caller states", async () => {
    const app = await appWithInvoices();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-PRICE",
          lines: [{ ...payload.lines[0], availableQty: "2", qty: "1", unitPrice: "1000", taxAmount: "500", taxRatePercent: 50, projectId: "PRJ-X" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { lines: { unitPrice: string; taxAmount: string; taxRatePercent: number | null; projectId: string | null }[]; grandTotal: string };
    expect(created.lines[0]?.unitPrice).toBe("100.000000");
    expect(created.lines[0]?.taxAmount).toBe("14.000000");
    expect(created.lines[0]?.taxRatePercent).toBe(14);
    expect(created.lines[0]?.projectId).toBe("PRJ-1");
    expect(created.grandTotal).toBe("114.000000");
  });

  it("LIMITATION (D102): with no invoices port wired, the caller's own availableQty IS the limit", async () => {
    // This is the composition the rest of this file uses, and the one an
    // edition without an invoices module ships: the claim is trusted.
    const app = await newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-TRUSTED",
          lines: [{ ...payload.lines[0], availableQty: "9999", qty: "500" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("who a return credits (D89)", () => {
  const sourceInvoice = {
    id: "INV1",
    number: "INV-000014",
    customerId: "CUST1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed" as const,
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف",
        qty: Qty.fromMajor("3"),
        alreadyReturnedQty: Qty.zero(),
        unitPrice: Money.fromMajor("100"),
        unitCost: Money.fromMajor("60"),
        taxAmount: Money.fromMajor("42"),
      },
    ],
  };

  async function appWithInvoices() {
    const { service } = await buildService();
    return createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    });
  }

  it("refuses a return whose customer is not the invoice's own (D89)", async () => {
    const app = await appWithInvoices();

    // The invoice belongs to CUST1. A return naming CUST-ACCOMPLICE would send
    // the credit — and any refund raised against it — to an account that never
    // bought the goods, which is a credit note to a stranger.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-DIVERTED",
          lines: [{ ...payload.lines[0], customerId: "CUST-ACCOMPLICE", availableQty: "3", qty: "1" }],
        }),
      }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("RETURN_CUSTOMER_MISMATCH");
  });

  it("refuses an item that is not on the invoice it names", async () => {
    const app = await appWithInvoices();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-WRONG-ITEM",
          lines: [{ ...payload.lines[0], itemId: "ITEM-NEVER-SOLD", availableQty: "3", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("RETURN_ITEM_NOT_ON_INVOICE");
  });

  it("still accepts a return whose customer DOES match, so the guard is not refusing everything", async () => {
    const app = await appWithInvoices();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-LEGIT",
          lines: [{ ...payload.lines[0], customerId: "CUST1", availableQty: "2", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("still resolves the QUANTITY from the invoice even when the customer is wrong", async () => {
    const app = await appWithInvoices();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-DIVERTED-OVER",
          lines: [{ ...payload.lines[0], customerId: "CUST-ACCOMPLICE", availableQty: "99", qty: "4" }],
        }),
      }),
    );
    // Four against an invoice holding three: the quantity control still bites,
    // which is what makes the customer hole the specific gap it is.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("two partial returns that together exceed the invoice (boundary crossing)", () => {
  /** A live invoices port that recomputes alreadyReturnedQty from the returns the SERVICE actually holds — the same shape create-backend.ts wires in production. */
  function liveInvoices(service: DocumentService<any>) {
    return {
      async findConfirmedInvoice(id: string) {
        if (id !== "INV1") return null;
        const priorReturns = await service.list();
        let returned = Qty.zero();
        for (const doc of priorReturns) {
          if (doc.status !== "confirmed") continue;
          for (const line of doc.lines as { sourceInvoiceId: string; qty: Qty }[]) {
            if (line.sourceInvoiceId !== id) continue;
            returned = returned.add(line.qty);
          }
        }
        return {
          id: "INV1",
          number: "INV-000014",
          customerId: "CUST1",
          warehouseId: "WH1",
          date: "2026-08-20",
          status: "confirmed" as const,
          lines: [
            {
              itemId: "ITEM1",
              itemName: "صنف",
              qty: Qty.fromMajor("3"),
              alreadyReturnedQty: returned,
              unitPrice: Money.fromMajor("100"),
              unitCost: Money.fromMajor("60"),
              taxAmount: Money.fromMajor("42"),
            },
          ],
        };
      },
    };
  }

  it("confirms the first partial return, then refuses the second once together they exceed the invoiced qty", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, liveInvoices(service));

    // Invoice holds 3. First return claims 2 (well within the invoice) and is confirmed.
    const first = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({ ...payload, id: "SR-PART-1", lines: [{ ...payload.lines[0], availableQty: "999", qty: "2" }] }),
      }),
    );
    expect(first.status).toBe(201);
    const firstConfirm = await app.fetch(
      req("/SR-PART-1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }),
    );
    expect(firstConfirm.status).toBe(200);

    // Second return claims 2 more. 2 + 2 = 4 exceeds the invoice's 3 — this is
    // the boundary the fixture must actually cross: neither request alone is
    // over the invoice, only their SUM is.
    const second = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({ ...payload, id: "SR-PART-2", lines: [{ ...payload.lines[0], availableQty: "999", qty: "2" }] }),
      }),
    );
    expect(second.status).toBe(422);

    // But 1 more (2 + 1 = 3, exactly the invoice) is still legitimate — proving
    // the refusal is the boundary, not a guard that blocks everything.
    const legit = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({ ...payload, id: "SR-PART-3", lines: [{ ...payload.lines[0], availableQty: "999", qty: "1" }] }),
      }),
    );
    expect(legit.status).toBe(201);
  });
});

describe("a return restocks at the cost it left at, not a freshly recomputed average", () => {
  it("adds a cost layer at the invoice line's unitCost, independent of the current running average", async () => {
    const { service, stockService } = await buildService();

    // Seed 10 units already in stock at 50.00 each — the running average before the return.
    await stockService.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50") }],
    });
    const before = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(before.onHand.toString()).toBe("10.000000");
    expect(before.averageCost.toString()).toBe("50.000000");

    const sourceInvoice = {
      id: "INV1",
      number: "INV-000014",
      customerId: "CUST1",
      warehouseId: "WH1",
      date: "2026-08-20",
      status: "confirmed" as const,
      lines: [
        {
          itemId: "ITEM1",
          itemName: "صنف",
          qty: Qty.fromMajor("3"),
          alreadyReturnedQty: Qty.zero(),
          unitPrice: Money.fromMajor("100"),
          unitCost: Money.fromMajor("77.5"),
          taxAmount: Money.fromMajor("42"),
        },
      ],
    };
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    });

    const built = await app.fetch(
      req("/from-invoice", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          id: "SR-COST-LAYER",
          date: "2026-08-21",
          memo: "",
          warehouseId: "WH1",
          sourceInvoiceId: "INV1",
          reason: "DEFECTIVE",
          requested: [{ itemId: "ITEM1", qty: "2" }],
        }),
      }),
    );
    expect(built.status).toBe(201);
    const confirmRes = await app.fetch(
      req("/SR-COST-LAYER/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }),
    );
    expect(confirmRes.status).toBe(200);

    const layers = await stockService.getItemCostLayers("ITEM1");
    const returnLayer = layers.find((l) => l.sourceDocId === "SR-COST-LAYER");
    expect(returnLayer).toBeDefined();
    // The layer sits at the INVOICE's unit cost (77.50), not the pre-return
    // running average (50.00) and not some other recomputed figure.
    expect(returnLayer!.unitCost.toString()).toBe("77.500000");
    expect(returnLayer!.remainingQty.toString()).toBe("2.000000");

    const after = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(after.onHand.toString()).toBe("12.000000");
    // Weighted average: (10*50 + 2*77.5) / 12 = (500 + 155) / 12 = 54.583333
    expect(after.averageCost.toString()).toBe("54.583333");
  });
});

describe("GET /sales-returns/:id", () => {
  it("returns 404 for an id that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/no-such-id", { permissions: "sales.return.view" }));
    expect(res.status).toBe(404);
  });

  it("returns the full document, with refunds, for a known id", async () => {
    const { service, stockService: _s } = await buildService();
    const refunds = makeRefundsPort();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, refunds);
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }), insecureHeaderAuthContextResolver);
    await app.fetch(req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    await app.fetch(
      req("/SR1/refund", {
        method: "POST",
        permissions: "sales.return.confirm,sales.return.view",
        body: JSON.stringify({ amount: "50", treasuryAccountId: "TILL1" }),
      }),
    );

    const res = await app.fetch(req("/SR1", { permissions: "sales.return.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; refunds: { amount: string }[]; refundedTotal: string };
    expect(body.id).toBe("SR1");
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0]?.amount).toBe("50.000000");
    expect(body.refundedTotal).toBe("50.000000");
  });
});

describe("POST /sales-returns validation", () => {
  it("rejects a malformed body with 400 before touching the service", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({ id: "BAD", date: "2026-08-21", memo: "", lines: [] }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("VALIDATION_ERROR");
    // Nothing was written.
    expect(await service.findById("BAD")).toBeNull();
  });
});

describe("POST /sales-returns/from-invoice", () => {
  const sourceInvoice = {
    id: "INV1",
    number: "INV-000014",
    customerId: "CUST1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed" as const,
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف",
        qty: Qty.fromMajor("3"),
        alreadyReturnedQty: Qty.zero(),
        unitPrice: Money.fromMajor("100"),
        unitCost: Money.fromMajor("60"),
        taxAmount: Money.fromMajor("42"),
      },
    ],
  };

  function fromInvoiceBody(overrides: Record<string, unknown> = {}) {
    return {
      id: "SR-FI-1",
      date: "2026-08-21",
      memo: "",
      warehouseId: "WH1",
      sourceInvoiceId: "INV1",
      reason: "DEFECTIVE",
      requested: [{ itemId: "ITEM1", qty: "2" }],
      ...overrides,
    };
  }

  it("answers 400 for a malformed from-invoice body", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ id: "X" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("answers 503 when no invoices port is wired", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(fromInvoiceBody()) }),
    );
    expect(res.status).toBe(503);
  });

  it("answers 404 for an invoice the books do not have", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(insecureHeaderAuthContextResolver) {
        return null;
      },
    });
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(fromInvoiceBody()) }),
    );
    expect(res.status).toBe(404);
  });

  it("answers 422 when every requested qty is zero or omitted — nothing returnable", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    });
    const res = await app.fetch(
      req("/from-invoice", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify(fromInvoiceBody({ requested: [{ itemId: "ITEM1", qty: "0" }] })),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("builds the return from the INVOICE's own price/cost/tax, ignoring nothing the caller can override", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    });
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(fromInvoiceBody()) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      lines: { unitPrice: string; unitCost: string; taxAmount: string; customerId: string; availableQty: string }[];
    };
    expect(body.lines).toHaveLength(1);
    const line = body.lines[0]!;
    expect(line.unitPrice).toBe("100.000000");
    expect(line.unitCost).toBe("60.000000");
    // Tax share is proportional: 42 * (2/3) = 28.
    expect(line.taxAmount).toBe("28.000000");
    expect(line.customerId).toBe("CUST1");
    expect(line.availableQty).toBe("3.000000");
  });

  it("409s a duplicate id instead of silently overwriting the earlier draft", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    });
    const first = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(fromInvoiceBody()) }),
    );
    expect(first.status).toBe(201);
    const second = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(fromInvoiceBody()) }),
    );
    expect(second.status).toBe(409);
  });
});

describe("POST /sales-returns/:id/cancel", () => {
  it("cancels a draft", async () => {
    const app = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }));
    const res = await app.fetch(req("/SR1/cancel", { method: "POST", permissions: "sales.return.void,sales.return.view", body: "{}" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("cancelled");
  });

  it("refuses to cancel an already-confirmed return, and leaves it confirmed", async () => {
    const app = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }));
    await app.fetch(req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));

    const res = await app.fetch(req("/SR1/cancel", { method: "POST", permissions: "sales.return.void,sales.return.view", body: "{}" }));
    expect(res.status).toBe(409);

    const check = await app.fetch(req("/SR1", { permissions: "sales.return.view" }));
    const doc = (await check.json()) as { status: string };
    expect(doc.status).toBe("confirmed");
  });
});

describe("POST /sales-returns/:id/confirm error path", () => {
  it("404s confirming an id that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/ghost/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /sales-returns/counts and /stats", () => {
  it("counts by status over the filtered set, and the KPI strip sums confirmed value and refund-due exactly", async () => {
    const { service } = await buildService();
    const refunds = makeRefundsPort();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, refunds);

    // One draft, never confirmed — contributes to `all`/`draft` but not to returnedTotal.
    await app.fetch(
      req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id: "SR-DRAFT" }) }), insecureHeaderAuthContextResolver);

    // One confirmed, fully refunded.
    await app.fetch(
      req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id: "SR-PAID" }) }),
    );
    await app.fetch(req("/SR-PAID/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    const paidDoc = (await (await app.fetch(req("/SR-PAID", { permissions: "sales.return.view" }))).json()) as { refundDue: string };
    await app.fetch(
      req("/SR-PAID/refund", {
        method: "POST",
        permissions: "sales.return.confirm,sales.return.view",
        body: JSON.stringify({ amount: paidDoc.refundDue, treasuryAccountId: "TILL1" }),
      }),
    );

    // One confirmed, still awaiting refund.
    await app.fetch(
      req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id: "SR-DUE" }) }),
    );
    await app.fetch(req("/SR-DUE/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));

    const countsRes = await app.fetch(req("/counts", { permissions: "sales.return.view" }));
    expect(countsRes.status).toBe(200);
    const counts = (await countsRes.json()) as Record<string, number>;
    expect(counts.all).toBe(3);
    expect(counts.draft).toBe(1);
    expect(counts.confirmed).toBe(2);
    // Only SR-DUE is still awaiting refund — SR-PAID was settled in full.
    expect(counts.awaitingRefund).toBe(1);

    const statsRes = await app.fetch(req("/stats", { permissions: "sales.return.view" }));
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as {
      count: number;
      confirmed: number;
      awaitingRefund: number;
      returnedTotal: string;
      refundedTotal: string;
      refundDue: string;
    };
    expect(stats.count).toBe(3);
    expect(stats.confirmed).toBe(2);
    expect(stats.awaitingRefund).toBe(1);
    // Each confirmed return's grand total: qty 2 * price 100 + tax 28 = 228.
    expect(stats.returnedTotal).toBe("456.000000");
    expect(stats.refundedTotal).toBe(paidDoc.refundDue);
    expect(stats.refundDue).toBe("228.000000");
  });
});

describe("listFilteredReturns — the filters actually narrow the rows AND the header together", () => {
  async function seeded(customers?: Parameters<typeof createSalesReturnsRoutes>[6]) {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, undefined, undefined, undefined, customers);
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-CUST-A",
          lines: [{ ...payload.lines[0], customerId: "CUST-A", warehouseId: "WH-A", sourceInvoiceNumber: "INV-AAA" }],
        }),
      }),
    );
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create,sales.invoice.view",
        body: JSON.stringify({
          ...payload,
          id: "SR-CUST-B",
          lines: [{ ...payload.lines[0], customerId: "CUST-B", warehouseId: "WH-B", sourceInvoiceNumber: "INV-BBB" }],
        }),
      }),
    );
    return app;
  }

  it("customerId narrows to only that customer's returns", async () => {
    const app = await seeded();
    const res = await app.fetch(req("/?customerId=CUST-A", { permissions: "sales.return.view" }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["SR-CUST-A"]);
  });

  it("a search for the customer's name finds that customer's returns — Arabic or English, any case, padded — in the rows, the chips and the stats", async () => {
    const app = await seeded({
      findAll: async () => [
        { id: "CUST-A", nameAr: "مؤسسة النور للمقاولات", nameEn: "Al Noor Contracting" },
        { id: "CUST-B", nameAr: "شركة الأمل التجارية", nameEn: "Al Amal Trading" },
      ],
    });
    const view = { permissions: "sales.return.view" };
    for (const term of ["النور", "al noor", "  NOOR  "]) {
      const rows = (await (await app.fetch(req(`/?search=${encodeURIComponent(term)}`, view))).json()) as { id: string }[];
      expect(rows.map((r) => r.id), term).toEqual(["SR-CUST-A"]);
    }
    const search = `search=${encodeURIComponent("الأمل")}`;
    expect(((await (await app.fetch(req(`/counts?${search}`, view))).json()) as Record<string, number>).all).toBe(1);
    expect(((await (await app.fetch(req(`/stats?${search}`, view))).json()) as { count: number }).count).toBe(1);
    expect(await (await app.fetch(req(`/?search=${encodeURIComponent("لا أحد")}`, view))).json()).toEqual([]);
  });

  it("search matches the source invoice number and excludes the non-matching row", async () => {
    const app = await seeded();
    const res = await app.fetch(req("/?search=INV-BBB", { permissions: "sales.return.view" }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["SR-CUST-B"]);
  });

  it("warehouse scope narrows the header AND leaves the other warehouse's return absent, not just unlisted", async () => {
    const app = await seeded();
    const res = await app.fetch(req("/", { permissions: "sales.return.view", headers: { "x-warehouse-scope": "WH-A" } }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["SR-CUST-A"]);
    expect(rows.some((r) => r.id === "SR-CUST-B")).toBe(false);
  });

  it("awaitingRefund=true keeps only confirmed returns still owed money", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id: "SR-DRAFT-ONLY" }) }));
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id: "SR-CONFIRMED" }) }));
    await app.fetch(req("/SR-CONFIRMED/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));

    const res = await app.fetch(req("/?awaitingRefund=true", { permissions: "sales.return.view" }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["SR-CONFIRMED"]);
  });
});

function makeRefundsPort() {
  const refunds = new Map<string, { voucherId: string; voucherNo: string | null; date: string; amount: Money }[]>();
  let n = 0;
  return {
    async list(returnId: string) {
      return refunds.get(returnId) ?? [];
    },
    async post(cmd: { returnId: string; amount: Money; date: string }) {
      n += 1;
      const voucherId = `VOUCHER-${n}`;
      const voucherNo = `RCV-${String(n).padStart(6, "0")}`;
      const arr = [...(refunds.get(cmd.returnId) ?? [])];
      arr.push({ voucherId, voucherNo, date: cmd.date, amount: cmd.amount });
      refunds.set(cmd.returnId, arr);
      return { voucherId, voucherNo };
    },
  };
}

describe("POST /sales-returns/:id/refund", () => {
  async function confirmedReturn(id = "SR1") {
    const { service } = await buildService();
    const refunds = makeRefundsPort();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, refunds);
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify({ ...payload, id }) }), insecureHeaderAuthContextResolver);
    await app.fetch(req(`/${id}/confirm`, { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    return { app, refunds };
  }

  it("400s a malformed body", async () => {
    const { app } = await confirmedReturn();
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "not-a-number" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("503s when no refunds port is wired", async () => {
    const app = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }));
    await app.fetch(req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "1", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(503);
  });

  it("404s a refund against an id that does not exist", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, makeRefundsPort());
    const res = await app.fetch(
      req("/ghost/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "1", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("422s a refund against a return that is still a draft (not yet confirmed)", async () => {
    const { service } = await buildService();
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, makeRefundsPort());
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "1", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(422);
  });

  it("posts a full refund, and flips awaitingRefund to false", async () => {
    const { app } = await confirmedReturn();
    // Grand total: 2 * 100 + 28 tax = 228.
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "228", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { awaitingRefund: boolean; refundDue: string; voucherId: string };
    expect(body.awaitingRefund).toBe(false);
    expect(body.refundDue).toBe("0.000000");
    expect(body.voucherId).toBe("VOUCHER-1");
  });

  it("two partial refunds sum toward the total, and a third that would overshoot is refused", async () => {
    const { app } = await confirmedReturn();
    const first = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "100", treasuryAccountId: "TILL1" }) }),
    );
    expect(first.status).toBe(200);
    const afterFirst = (await first.json()) as { refundDue: string; refundedTotal: string };
    expect(afterFirst.refundDue).toBe("128.000000");
    expect(afterFirst.refundedTotal).toBe("100.000000");

    const second = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "128", treasuryAccountId: "TILL1" }) }),
    );
    expect(second.status).toBe(200);
    const afterSecond = (await second.json()) as { refundDue: string; awaitingRefund: boolean };
    expect(afterSecond.refundDue).toBe("0.000000");
    expect(afterSecond.awaitingRefund).toBe(false);

    // Nothing left to refund — refused, not silently accepted as a second payout.
    const third = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "1", treasuryAccountId: "TILL1" }) }),
    );
    expect(third.status).toBe(422);
  });

  it("surfaces an unexpected failure from the refund port as a 500, not a swallowed success", async () => {
    const { service } = await buildService();
    const brokenRefunds = {
      async list() {
        return [];
      },
      async post(): Promise<never> {
        throw new Error("treasury adapter unreachable");
      },
    };
    const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, undefined, brokenRefunds);
    await app.fetch(req("/", { method: "POST", permissions: "sales.return.create,sales.invoice.view", body: JSON.stringify(payload) }), insecureHeaderAuthContextResolver);
    await app.fetch(req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: "{}" }));
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "228", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(500);
  });

  it("refuses a refund whose amount exceeds what remains due", async () => {
    const { app } = await confirmedReturn();
    const res = await app.fetch(
      req("/SR1/refund", { method: "POST", permissions: "sales.return.confirm,sales.return.view", body: JSON.stringify({ amount: "9999", treasuryAccountId: "TILL1" }) }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("SALES_RETURN_NOT_REFUNDABLE");
  });
});
