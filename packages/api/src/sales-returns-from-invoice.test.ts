/**
 * POST /sales-returns/from-invoice — «مرتجع من فاتورة», the shape the screen
 * actually sends. Every figure that matters (price, cost, tax share, what is
 * still returnable) has to be read off the SOURCE INVOICE here; the request
 * carries nothing but an invoice id and a quantity per item.
 *
 * The two things this file is really guarding:
 *   1. stock comes back at the cost it LEFT at, not at today weighted average;
 *   2. the returnable quantity is the invoice quantity minus what confirmed
 *      returns already took, so two partial returns cannot exceed the invoice.
 */

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
  type SourceSalesInvoice,
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
  accountsReceivableId: "1105",
  salesReturnsAccountId: "4100",
  outputTaxPayableAccountId: "2201",
  inventoryAccountId: "1200",
  cogsAccountId: "5000",
};

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

/**
 * The invoice as the books hold it: 10 sold at 25.00 that cost 10.00 each,
 * with 35.00 of output VAT on the line. The COST is what matters — the stock
 * position it came out of has since been repriced.
 */
function sourceInvoice(alreadyReturned: string): SourceSalesInvoice {
  return {
    id: "INV-1",
    number: "INV-000014",
    customerId: "CUST-1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed",
    lines: [
      {
        itemId: "ITEM-A",
        itemName: "صنف أ",
        qty: Qty.fromMajor("10"),
        alreadyReturnedQty: Qty.fromMajor(alreadyReturned),
        unitPrice: Money.fromMajor("25.00"),
        unitCost: Money.fromMajor("10.00"),
        taxAmount: Money.fromMajor("35.00"),
      },
    ],
  };
}

async function harness() {
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

  const stockService = new StockLedgerService({
    ledger: stock.ledger,
    layers: stock.layers,
    snapshots: stock.snapshots,
    policy: { allowNegativeStock: false },
    transaction: stock.transaction,
  });

  // The cost the goods departed at: 100 at 10.00. Then a later receipt at 20.00
  // moves the weighted average to 15.00, so a return valued at TODAY average
  // and a return valued at the invoice cost are 5.00 a unit apart.
  await stockService.recordOpeningBalance({
    adjustmentId: "OPEN-1",
    warehouseId: "WH1",
    occurredAt: "2026-08-01T00:00:00.000Z",
    lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("10.00") }],
  });
  await stockService.postReceipt({
    receiptId: "RCPT-1",
    warehouseId: "WH1",
    sourceDocType: "PURCHASE_RECEIPT",
    occurredAt: "2026-08-15T00:00:00.000Z",
    lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("20.00") }],
  });

  const numbering = ledger.numbering;
  const service = new DocumentService(createSalesReturnDocumentType(ACCOUNTS), {
    repo,
    numbering: { next: () => numbering.next("SALES_RETURN") },
    gl: createJournalGlHook({ ledger, accounts, periods, numbering }),
    stock: createInventoryStockHook(stockService),
    workflow: createDocumentWorkflowGate(() => null),
  });

  /**
   * The production adapter (create-backend.ts) resolves the returnable
   * quantity as invoice qty minus what CONFIRMED returns already took. This
   * mirrors it, so the two-partial-returns case exercises the real rule.
   */
  const invoices = {
    async findConfirmedInvoice(id: string) {
      if (id !== "INV-1") return null;
      let returned = Qty.zero();
      for (const doc of await service.list()) {
        if (doc.status !== "confirmed") continue;
        for (const l of doc.lines) {
          if (l.sourceInvoiceId === "INV-1" && l.itemId === "ITEM-A") returned = returned.add(l.qty);
        }
      }
      return sourceInvoice(returned.toString());
    },
  };

  return { app: createSalesReturnsRoutes(service, undefined, invoices), ledger, stockService, service };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request("http://local" + path, { ...init, headers });
}

function fromInvoice(id: string, qty: string) {
  return {
    id,
    date: "2026-08-21",
    memo: "",
    sourceInvoiceId: "INV-1",
    warehouseId: "WH1",
    reason: "DEFECTIVE" as const,
    requested: [{ itemId: "ITEM-A", qty }],
  };
}

describe("POST /sales-returns/from-invoice — the lines come off the invoice", () => {
  it("carries the invoice price, the invoice COST and the proportional tax share", async () => {
    const { app } = await harness();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-1", "4")) }),
    );

    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      status: string;
      lines: { itemId: string; customerId: string; sourceInvoiceNumber: string; availableQty: string; qty: string; unitPrice: string; unitCost: string; taxAmount: string }[];
    };
    expect(created.status).toBe("draft");
    expect(created.lines).toHaveLength(1);
    const line = created.lines[0]!;
    expect(line.itemId).toBe("ITEM-A");
    expect(line.customerId).toBe("CUST-1");
    expect(line.sourceInvoiceNumber).toBe("INV-000014");
    expect(line.qty).toBe("4.000000");
    expect(line.availableQty).toBe("10.000000");
    expect(line.unitPrice).toBe("25.000000");
    // 10.00 is what the goods cost when they left. The position averages
    // 15.00 today; a return valued there would be 20.00 of invented value.
    expect(line.unitCost).toBe("10.000000");
    // 35.00 of VAT on ten units, four coming back: 14.00.
    expect(line.taxAmount).toBe("14.000000");
  });

  it("restocks at the cost it left at and posts the reversing entry, both to the piastre", async () => {
    const { app, ledger, stockService } = await harness();

    const before = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(before.onHand.toString()).toBe("200.000000");
    expect(before.totalValue.toString()).toBe("3000.000000");
    expect(before.averageCost.toString()).toBe("15.000000");

    await app.fetch(req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-1", "4")) }));
    const confirmed = await app.fetch(req("/SR-1/confirm", { method: "POST", permissions: "sales.return.confirm", body: "{}" }));
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as { document: { status: string; docNo: string; journalEntryId: string; refundDue: string } };
    expect(body.document.status).toBe("confirmed");

    // Four units back at 10.00 = 40.00, not 4 x 15.00 = 60.00.
    const after = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(after.onHand.toString()).toBe("204.000000");
    expect(after.totalValue.toString()).toBe("3040.000000");

    const entry = await ledger.findById(body.document.journalEntryId);
    const net = (id: string) =>
      entry!.lines
        .filter((l) => l.accountId === id)
        .reduce((sum, l) => sum.add(l.debit).add(l.credit.negate()), Money.zero())
        .toString();
    expect(net(ACCOUNTS.salesReturnsAccountId)).toBe("100.000000");
    expect(net(ACCOUNTS.outputTaxPayableAccountId)).toBe("14.000000");
    expect(net(ACCOUNTS.accountsReceivableId)).toBe("-114.000000");
    expect(net(ACCOUNTS.inventoryAccountId)).toBe("40.000000");
    expect(net(ACCOUNTS.cogsAccountId)).toBe("-40.000000");
    expect(Money.sum(entry!.lines.map((l) => l.debit)).toString()).toBe(Money.sum(entry!.lines.map((l) => l.credit)).toString());

    // The credit note is owed to the customer until a صرف voucher pays it.
    expect(body.document.refundDue).toBe("114.000000");
  });
});

describe("POST /sales-returns/from-invoice — the returnable quantity is the invoice remainder", () => {
  it("refuses ELEVEN against an invoice of ten, and writes nothing", async () => {
    const { app, service, stockService } = await harness();

    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-OVER", "11")) }),
    );
    expect(res.status).toBe(422);

    expect(await service.findById("SR-OVER")).toBeNull();
    expect(await service.list()).toHaveLength(0);
    const stockAfter = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(stockAfter.onHand.toString()).toBe("200.000000");
    expect(stockAfter.totalValue.toString()).toBe("3000.000000");
  });

  it("accepts the whole ten, because the cap is inclusive", async () => {
    const { app } = await harness();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-ALL", "10")) }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { lines: { qty: string }[] };
    expect(created.lines[0]!.qty).toBe("10.000000");
  });

  it("refuses ten plus one MICRO-unit", async () => {
    const { app } = await harness();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-EPS", "10.000001")) }),
    );
    expect(res.status).toBe(422);
  });

  it("refuses the SECOND partial return once the two together would exceed the invoice", async () => {
    const { app, service, stockService } = await harness();

    // First return: six of ten, confirmed. Four are left.
    expect(
      (await app.fetch(req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-A", "6")) }))).status,
    ).toBe(201);
    expect((await app.fetch(req("/SR-A/confirm", { method: "POST", permissions: "sales.return.confirm", body: "{}" }))).status).toBe(200);

    const afterFirst = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(afterFirst.onHand.toString()).toBe("206.000000");
    expect(afterFirst.totalValue.toString()).toBe("3060.000000");

    // Second return: FIVE, one more than is left. 6 + 5 = 11 against ten sold.
    const second = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-B", "5")) }),
    );
    expect(second.status).toBe(422);
    expect(await service.findById("SR-B")).toBeNull();
    expect(await service.list()).toHaveLength(1);

    const afterSecond = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(afterSecond.onHand.toString()).toBe("206.000000");
    expect(afterSecond.totalValue.toString()).toBe("3060.000000");

    // Exactly the four that remain are still returnable.
    const third = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-C", "4")) }),
    );
    expect(third.status).toBe(201);
    const created = (await third.json()) as { lines: { availableQty: string; qty: string }[] };
    expect(created.lines[0]!.availableQty).toBe("4.000000");
    expect(created.lines[0]!.qty).toBe("4.000000");
  });

  it("does not count a DRAFT return against the remainder — only a confirmed one has taken the goods", async () => {
    const { app } = await harness();
    await app.fetch(req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-DRAFT", "6")) }));

    const second = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.create", body: JSON.stringify(fromInvoice("SR-SECOND", "10")) }),
    );
    expect(second.status).toBe(201);
    const created = (await second.json()) as { lines: { availableQty: string }[] };
    expect(created.lines[0]!.availableQty).toBe("10.000000");
  });

  it("refuses an invoice the books do not have, and one with nothing returnable requested", async () => {
    const { app } = await harness();

    const ghost = await app.fetch(
      req("/from-invoice", {
        method: "POST",
        permissions: "sales.return.create",
        body: JSON.stringify({ ...fromInvoice("SR-GHOST", "1"), sourceInvoiceId: "INV-NOPE" }),
      }),
    );
    expect(ghost.status).toBe(404);
    expect((await ghost.json() as { error: string }).error).toBe("SOURCE_INVOICE_NOT_FOUND");

    const otherItem = await app.fetch(
      req("/from-invoice", {
        method: "POST",
        permissions: "sales.return.create",
        body: JSON.stringify({ ...fromInvoice("SR-OTHER", "1"), requested: [{ itemId: "ITEM-NOT-ON-INVOICE", qty: "1" }] }),
      }),
    );
    expect(otherItem.status).toBe(422);
    expect((await otherItem.json() as { error: string }).error).toBe("NO_RETURNABLE_LINES");
  });

  it("needs sales.return.create — a viewer cannot raise one, and nothing is written", async () => {
    const { app, service } = await harness();
    const res = await app.fetch(
      req("/from-invoice", { method: "POST", permissions: "sales.return.view", body: JSON.stringify(fromInvoice("SR-FORBIDDEN", "1")) }),
    );
    expect(res.status).toBe(403);
    expect(await service.findById("SR-FORBIDDEN")).toBeNull();
  });
});
