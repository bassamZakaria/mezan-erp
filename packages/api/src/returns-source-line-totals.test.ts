import { describe, it, expect, afterEach } from "vitest";
import {
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createPurchaseReturnDocumentType,
  createReturnConfirmGuard,
  createSalesReturnDocumentType,
  returnedQtyBySourceLine,
  Money,
  Qty,
  StockLedgerService,
  type PurchaseInvoiceLookupPort,
  type PurchaseReturnLine,
  type SalesInvoiceLookupPort,
  type SalesReturnLine,
} from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createStandaloneSqlitePurchaseReturnStore,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import { createSalesReturnsRoutes } from "./sales-returns-routes.js";
import { createPurchaseReturnsRoutes } from "./purchase-returns-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const AR = "1105";
const AP = "2100";
const OUTPUT_VAT = "2200";
const INPUT_VAT = "1400";
const INVENTORY = "1200";
const SALES_RETURNS = "4100";
const COGS = "5000";
const VARIANCE = "5190";

const SOLD = [
  { sourceLineId: "L1", itemId: "ITEM-X", qty: "3", unit: "100.00", cost: "40.00", tax: "42.00" },
  { sourceLineId: "L2", itemId: "ITEM-X", qty: "3", unit: "100.00", cost: "40.00", tax: "42.00" },
] as const;

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function books() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const stock = createSqliteStockLedgerStore();
  closers.push(ledger, accounts, periods, stock);
  for (const id of [AR, AP, OUTPUT_VAT, INPUT_VAT, INVENTORY, SALES_RETURNS, COGS, VARIANCE]) {
    await accounts.create({ id, code: id, nameAr: id, nameEn: id, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });
  }
  await periods.create({ id: "P1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  const stockService = new StockLedgerService({
    ledger: stock.ledger,
    layers: stock.layers,
    snapshots: stock.snapshots,
    policy: { allowNegativeStock: false },
    transaction: stock.transaction,
  });
  await stockService.recordOpeningBalance({
    adjustmentId: "OPEN-1",
    warehouseId: "WH1",
    occurredAt: "2026-08-01T00:00:00.000Z",
    lines: [{ itemId: "ITEM-X", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("40.00") }],
  });
  const gl = createJournalGlHook({ ledger, accounts, periods, numbering: ledger.numbering });
  const net = async (accountId: string): Promise<string> => {
    let total = Money.zero();
    for (const entry of await ledger.list()) {
      for (const line of entry.lines) if (line.accountId === accountId) total = total.add(line.debit).add(line.credit.negate());
    }
    return total.toString();
  };
  const onHand = async (): Promise<string> => (await stockService.getBalanceDetail("ITEM-X", "WH1")).onHand.toString();
  return { ledger, gl, stockService, net, onHand };
}

function req(path: string, body?: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "x-permissions": "*", "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function salesRig() {
  const b = await books();
  const repo = createStandaloneSqliteSalesReturnStore();
  closers.push(repo);
  const invoices: SalesInvoiceLookupPort = {
    async findConfirmedInvoice(id) {
      if (id !== "INV-1") return null;
      const returned = (await service.list()).filter((d) => d.status === "confirmed" && !d.reversesDocId).flatMap((d) => d.lines);
      const already = returnedQtyBySourceLine(SOLD.map((l) => ({ ...l, qty: Qty.fromMajor(l.qty) })), returned);
      return {
        id: "INV-1",
        number: "INV-000001",
        customerId: "CUST-1",
        warehouseId: "WH1",
        date: "2026-08-20",
        status: "confirmed",
        lines: SOLD.map((l, i) => ({
          sourceLineId: l.sourceLineId,
          itemId: l.itemId,
          itemName: "صنف",
          qty: Qty.fromMajor(l.qty),
          alreadyReturnedQty: already[i] ?? Qty.zero(),
          unitPrice: Money.fromMajor(l.unit),
          unitCost: Money.fromMajor(l.cost),
          taxAmount: Money.fromMajor(l.tax),
          taxRatePercent: 14,
          taxRateId: "VAT14",
        })),
      };
    },
  };
  const service: DocumentService<SalesReturnLine> = new DocumentService(
    createSalesReturnDocumentType({
      accountsReceivableId: AR,
      salesReturnsAccountId: SALES_RETURNS,
      outputTaxPayableAccountId: OUTPUT_VAT,
      inventoryAccountId: INVENTORY,
      cogsAccountId: COGS,
    }),
    {
      repo,
      numbering: { next: () => b.ledger.numbering.next("SALES_RETURN") },
      gl: b.gl,
      stock: createInventoryStockHook(b.stockService),
      workflow: createDocumentWorkflowGate(() => null),
      confirmGuard: createReturnConfirmGuard("SALES_RETURN", (id) => invoices.findConfirmedInvoice(id)),
    },
  );
  const app = createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver, invoices);
  const line = (sourceLineId: string | undefined, qty: string) => ({
    itemId: "ITEM-X",
    warehouseId: "WH1",
    customerId: "CUST-1",
    sourceInvoiceId: "INV-1",
    sourceInvoiceNumber: "INV-000001",
    ...(sourceLineId ? { sourceLineId } : {}),
    reason: "DEFECTIVE" as const,
    availableQty: "3",
    qty,
    unitPrice: "100",
    unitCost: "40",
    taxAmount: "0",
  });
  const draft = (id: string, lines: ReturnType<typeof line>[]) => app.fetch(req("/", { id, date: "2026-08-21", memo: "", lines }));
  return { ...b, app, service, line, draft };
}

async function purchaseRig() {
  const b = await books();
  const repo = createStandaloneSqlitePurchaseReturnStore();
  closers.push(repo);
  const invoices: PurchaseInvoiceLookupPort = {
    async findConfirmedInvoice(id) {
      if (id !== "PI-1") return null;
      const returned = (await service.list()).filter((d) => d.status === "confirmed" && !d.reversesDocId).flatMap((d) => d.lines);
      const bought = SOLD.map((l, i) => ({ sourceLineId: String(i), itemId: l.itemId, qty: Qty.fromMajor(l.qty) }));
      const already = returnedQtyBySourceLine(bought, returned);
      return {
        id: "PI-1",
        number: "PI-000001",
        supplierId: "SUP-1",
        warehouseId: "WH1",
        date: "2026-08-20",
        status: "confirmed",
        lines: bought.map((l, i) => ({
          ...l,
          itemName: "صنف",
          alreadyReturnedQty: already[i] ?? Qty.zero(),
          unitCost: Money.fromMajor("40.00"),
          taxAmount: Money.fromMajor("16.80"),
          taxRatePercent: 14,
          taxRateId: "VAT14",
        })),
      };
    },
  };
  const service: DocumentService<PurchaseReturnLine> = new DocumentService(
    createPurchaseReturnDocumentType({
      accountsPayableId: AP,
      inputTaxPayableId: INPUT_VAT,
      inventoryAccountId: INVENTORY,
      priceVarianceAccountId: VARIANCE,
    }),
    {
      repo,
      numbering: { next: () => b.ledger.numbering.next("PURCHASE_RETURN") },
      gl: b.gl,
      stock: createInventoryStockHook(b.stockService),
      workflow: createDocumentWorkflowGate(() => null),
      confirmGuard: createReturnConfirmGuard("PURCHASE_RETURN", (id) => invoices.findConfirmedInvoice(id)),
    },
  );
  const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver, invoices);
  const line = (sourceLineId: string | undefined, qty: string) => ({
    itemId: "ITEM-X",
    warehouseId: "WH1",
    supplierId: "SUP-1",
    sourceInvoiceId: "PI-1",
    sourceInvoiceNumber: "PI-000001",
    ...(sourceLineId ? { sourceLineId } : {}),
    reason: "DEFECTIVE" as const,
    availableQty: "3",
    qty,
    unitCost: "40",
    taxAmount: "0",
  });
  const draft = (id: string, lines: ReturnType<typeof line>[]) => app.fetch(req("/", { id, date: "2026-08-21", memo: "", lines }));
  return { ...b, app, service, line, draft };
}

const errorOf = async (res: Response) => (await res.json()) as { error?: string; message?: string };
const ARABIC = /[؀-ۿ]/;

describe("a sales return cannot return one invoice line more than once over (D79 round 3)", () => {
  it("refuses one document carrying the same invoice line twice — 3 + 3 against 3 sold — and the books do not move", async () => {
    const rig = await salesRig();
    const res = await rig.draft("SR-TWICE", [rig.line("L1", "3"), rig.line("L1", "3")]);
    expect(res.status).toBe(422);
    const body = await errorOf(res);
    expect(body.message).toMatch(/6\.000000/);
    expect(body.message).toMatch(ARABIC);
    expect(await rig.service.findById("SR-TWICE")).toBeNull();
    expect(await rig.onHand()).toBe("100.000000");
    expect(await rig.net(AR)).toBe("0.000000");
    expect(await rig.net(OUTPUT_VAT)).toBe("0.000000");
    expect(await rig.net(INVENTORY)).toBe("0.000000");
  });

  it("credits the customer and reverses 2200 for the line once: 3 back is 300.00 + 42.00, never 684.00", async () => {
    const rig = await salesRig();
    expect((await rig.draft("SR-TWICE", [rig.line("L1", "3"), rig.line("L1", "3")])).status).toBe(422);
    expect((await rig.draft("SR-ONCE", [rig.line("L1", "3")])).status).toBe(201);
    expect((await rig.app.fetch(req("/SR-ONCE/confirm"))).status).toBe(200);
    expect(await rig.onHand()).toBe("103.000000");
    expect(await rig.net(AR)).toBe("-342.000000");
    expect(await rig.net(OUTPUT_VAT)).toBe("42.000000");
    expect(await rig.net(SALES_RETURNS)).toBe("300.000000");
    expect(await rig.net(INVENTORY)).toBe("120.000000");
  });

  it("lets two lines split one invoice line when together they take exactly what it has", async () => {
    const rig = await salesRig();
    expect((await rig.draft("SR-SPLIT", [rig.line("L1", "1"), rig.line("L1", "2")])).status).toBe(201);
    expect((await rig.app.fetch(req("/SR-SPLIT/confirm"))).status).toBe(200);
    expect(await rig.onHand()).toBe("103.000000");
    expect(await rig.net(AR)).toBe("-342.000000");
  });

  it("lets only ONE of two drafts raised against the same line confirm — the second is refused and posts nothing", async () => {
    const rig = await salesRig();
    expect((await rig.draft("SR-A", [rig.line("L1", "3")])).status).toBe(201);
    expect((await rig.draft("SR-B", [rig.line("L1", "3")])).status).toBe(201);
    expect((await rig.app.fetch(req("/SR-A/confirm"))).status).toBe(200);
    const second = await rig.app.fetch(req("/SR-B/confirm"));
    expect(second.status).toBe(422);
    expect((await errorOf(second)).message).toMatch(ARABIC);
    expect((await rig.service.findById("SR-B"))?.status).toBe("draft");
    expect(await rig.onHand()).toBe("103.000000");
    expect(await rig.net(AR)).toBe("-342.000000");
    expect(await rig.net(OUTPUT_VAT)).toBe("42.000000");
    expect(await rig.net(INVENTORY)).toBe("120.000000");
  });

  it("answers RETURN_LINE_NOT_ON_INVOICE for a line id the invoice does not carry, on POST / — not «exceeds available (0)»", async () => {
    const rig = await salesRig();
    const res = await rig.draft("SR-FOREIGN", [rig.line("L-NOPE", "1")]);
    expect(res.status).toBe(422);
    const body = await errorOf(res);
    expect(body.error).toBe("RETURN_LINE_NOT_ON_INVOICE");
    expect(body.message).toMatch(ARABIC);
    expect(await rig.service.findById("SR-FOREIGN")).toBeNull();
  });

  it("refuses /from-invoice when ONE requested line is not on the invoice, instead of drafting the rest without it", async () => {
    const rig = await salesRig();
    const res = await rig.app.fetch(
      req("/from-invoice", {
        id: "SR-PARTIAL",
        date: "2026-08-21",
        memo: "",
        sourceInvoiceId: "INV-1",
        warehouseId: "WH1",
        reason: "DEFECTIVE",
        requested: [
          { itemId: "ITEM-X", sourceLineId: "L1", qty: "1" },
          { itemId: "ITEM-X", sourceLineId: "L-NOPE", qty: "1" },
        ],
      }),
    );
    expect(res.status).toBe(422);
    const body = await errorOf(res);
    expect(body.error).toBe("RETURN_LINE_NOT_ON_INVOICE");
    expect(body.message).toMatch(ARABIC);
    expect(await rig.service.findById("SR-PARTIAL")).toBeNull();
  });
});

describe("a purchase return cannot return one invoice line more than once over (D79 round 3)", () => {
  it("refuses one document carrying the same invoice line twice, and the books do not move", async () => {
    const rig = await purchaseRig();
    const res = await rig.draft("PR-TWICE", [rig.line("0", "3"), rig.line("0", "3")]);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toMatch(/6\.000000/);
    expect(await rig.service.findById("PR-TWICE")).toBeNull();
    expect(await rig.onHand()).toBe("100.000000");
    expect(await rig.net(AP)).toBe("0.000000");
    expect(await rig.net(INPUT_VAT)).toBe("0.000000");
    expect(await rig.net(INVENTORY)).toBe("0.000000");
  });

  it("debits the supplier and reverses 1400 for the line once: 3 back is 120.00 + 16.80, never 273.60", async () => {
    const rig = await purchaseRig();
    expect((await rig.draft("PR-TWICE", [rig.line("0", "3"), rig.line("0", "3")])).status).toBe(422);
    expect((await rig.draft("PR-ONCE", [rig.line("0", "3")])).status).toBe(201);
    expect((await rig.app.fetch(req("/PR-ONCE/confirm"))).status).toBe(200);
    expect(await rig.onHand()).toBe("97.000000");
    expect(await rig.net(AP)).toBe("136.800000");
    expect(await rig.net(INPUT_VAT)).toBe("-16.800000");
    expect(await rig.net(INVENTORY)).toBe("-120.000000");
  });

  it("lets only ONE of two drafts raised against the same line confirm", async () => {
    const rig = await purchaseRig();
    expect((await rig.draft("PR-A", [rig.line("0", "3")])).status).toBe(201);
    expect((await rig.draft("PR-B", [rig.line("0", "3")])).status).toBe(201);
    expect((await rig.app.fetch(req("/PR-A/confirm"))).status).toBe(200);
    const second = await rig.app.fetch(req("/PR-B/confirm"));
    expect(second.status).toBe(422);
    expect((await rig.service.findById("PR-B"))?.status).toBe("draft");
    expect(await rig.onHand()).toBe("97.000000");
    expect(await rig.net(AP)).toBe("136.800000");
    expect(await rig.net(INPUT_VAT)).toBe("-16.800000");
    expect(await rig.net(INVENTORY)).toBe("-120.000000");
  });

  it("answers RETURN_LINE_NOT_ON_INVOICE for a line id the invoice does not carry", async () => {
    const rig = await purchaseRig();
    const res = await rig.draft("PR-FOREIGN", [rig.line("7", "1")]);
    expect(res.status).toBe(422);
    const body = await errorOf(res);
    expect(body.error).toBe("RETURN_LINE_NOT_ON_INVOICE");
    expect(body.message).toMatch(ARABIC);
    expect(await rig.service.findById("PR-FOREIGN")).toBeNull();
  });
});
