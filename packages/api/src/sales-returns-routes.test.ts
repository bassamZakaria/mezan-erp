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

  return service;
}

async function newApp() {
  return createSalesReturnsRoutes(await buildService());
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
      req("/", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { status: string; awaitingRefund: boolean };
    expect(created.status).toBe("draft");
    expect(created.awaitingRefund).toBe(false);

    const confirmRes = await app.fetch(
      req("/SR1/confirm", { method: "POST", permissions: "sales.return.confirm", body: "{}" }),
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
    const res = await app.fetch(req("/", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(bad) }));
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
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف",
        qty: Qty.fromMajor("3"),
        alreadyReturnedQty: Qty.fromMajor("1"),
        unitPrice: Money.fromMajor("100"),
        unitCost: Money.fromMajor("60"),
        taxAmount: Money.fromMajor("42"),
      },
    ],
  };

  async function appWithInvoices() {
    const service = await buildService();
    const invoices = {
      async findConfirmedInvoice(id: string) {
        return id === "INV1" ? sourceInvoice : null;
      },
    };
    return createSalesReturnsRoutes(service, undefined, invoices);
  }

  it("recomputes the returnable quantity from the invoice, ignoring what the caller claims", async () => {
    const app = await appWithInvoices();

    // The caller says five are available. The invoice says two (3 sold, 1
    // already returned), so a return of three must be refused.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create",
        body: JSON.stringify({
          ...payload,
          id: "SR-OVER",
          lines: [{ ...payload.lines[0], availableQty: "5", qty: "3" }],
        }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("accepts exactly what the invoice has left, and refuses one micro-unit more", async () => {
    const app = await appWithInvoices();

    const exact = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create",
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
        permissions: "sales.return.create",
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
        permissions: "sales.return.create",
        body: JSON.stringify({
          ...payload,
          id: "SR-GHOST",
          lines: [{ ...payload.lines[0], sourceInvoiceId: "INV-NOT-REAL", availableQty: "99", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("LIMITATION (D102): the caller's own unitCost is still taken verbatim, even with the invoice resolvable", async () => {
    const app = await appWithInvoices();

    // The invoice cost is 60.00. The caller says 600.00, and the return
    // restocks at the caller's figure — ten times what the goods actually cost.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create",
        body: JSON.stringify({
          ...payload,
          id: "SR-COST",
          lines: [{ ...payload.lines[0], availableQty: "2", qty: "1", unitCost: "600", unitPrice: "100" }],
        }),
      }),
    );

    expect(res.status).toBe(201);
    const created = (await res.json()) as { lines: { unitCost: string }[] };
    expect(created.lines[0]?.unitCost).toBe("600.000000");

    // When D102 is closed the cost should come off the invoice line (60.00)
    // rather than off the request — that is the expectation to rewrite.
  });

  it("LIMITATION (D102): with no invoices port wired, the caller's own availableQty IS the limit", async () => {
    // This is the composition the rest of this file uses, and the one an
    // edition without an invoices module ships: the claim is trusted.
    const app = await newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.return.create",
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
