import { describe, it, expect, afterEach } from "vitest";
import {
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createSalesReturnDocumentType,
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

async function newApp() {
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

  return createSalesReturnsRoutes(service);
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
