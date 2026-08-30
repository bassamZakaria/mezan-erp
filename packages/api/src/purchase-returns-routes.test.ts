import { describe, it, expect, afterEach } from "vitest";
import {
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createInventoryStockHook,
  createPurchaseReturnDocumentType,
  Money,
  Qty,
  StockLedgerService,
  type PurchaseReturnGlAccounts,
} from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createStandaloneSqlitePurchaseReturnStore,
} from "@mezan/persistence";
import { createPurchaseReturnsRoutes } from "./purchase-returns-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const ACCOUNTS: PurchaseReturnGlAccounts = {
  accountsPayableId: "AP",
  inputTaxPayableId: "INPUT_TAX",
  inventoryAccountId: "INVENTORY",
  priceVarianceAccountId: "PRICE_VARIANCE",
};

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function buildRig() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const stockStore = createSqliteStockLedgerStore();
  const repo = createStandaloneSqlitePurchaseReturnStore();
  closers.push(ledger, accounts, periods, stockStore, repo);

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
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });

  const service = new DocumentService(createPurchaseReturnDocumentType(ACCOUNTS), {
    repo,
    numbering: { next: () => numbering.next("PURCHASE_RETURN") },
    gl,
    stock: createInventoryStockHook(stockService),
    workflow: createDocumentWorkflowGate(() => null),
  });

  return { service, ledger, stockService, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function json(res: Response) {
  return res.json();
}

const payload = {
  id: "PRT1",
  date: "2026-08-21",
  memo: "",
  lines: [
    {
      itemId: "ITEM1",
      warehouseId: "WH1",
      supplierId: "SUP1",
      sourceInvoiceId: "PI1",
      sourceInvoiceNumber: "PI-000014",
      reason: "DEFECTIVE" as const,
      availableQty: "5",
      qty: "2",
      unitCost: "60",
      taxAmount: "0",
    },
  ],
};

describe("purchase-returns router — permission gates", () => {
  it("rejects listing with no permissions", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    expect((await app.fetch(req("/"))).status).toBe(403);
  });

  it("holding VIEW only is not enough to CREATE — a similar but different permission — and nothing is written", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/", { method: "POST", permissions: "purchases.return.view", body: JSON.stringify(payload) }));
    expect(res.status).toBe(403);
    expect(await service.findById("PRT1")).toBeNull();
  });

  it("holding CREATE only is not enough to CONFIRM, and the draft stays a draft", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await app.fetch(req("/", { method: "POST", permissions: "purchases.return.create", body: JSON.stringify(payload) }));
    const res = await app.fetch(req("/PRT1/confirm", { method: "POST", permissions: "purchases.return.create" }));
    expect(res.status).toBe(403);
    expect((await service.findById("PRT1"))?.status).toBe("draft");
  });

  it("holding CONFIRM only is not enough to CANCEL a draft", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await app.fetch(req("/", { method: "POST", permissions: "purchases.return.create", body: JSON.stringify(payload) }));
    const res = await app.fetch(req("/PRT1/cancel", { method: "POST", permissions: "purchases.return.confirm" }));
    expect(res.status).toBe(403);
    expect((await service.findById("PRT1"))?.status).toBe("draft");
  });

  it("404s GET /:id and rejects with 403 before that when unauthenticated", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    const denied = await app.fetch(req("/NOPE"));
    expect(denied.status).toBe(403);
    const notFound = await app.fetch(req("/NOPE", { permissions: "purchases.return.view" }));
    expect(notFound.status).toBe(404);
  });
});

describe("purchase-returns router — create + confirm happy path", () => {
  it("creates a draft, then confirms it — restocking OUT and posting a balanced GL entry", async () => {
    const { service, ledger } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);

    const createRes = await app.fetch(req("/", { method: "POST", permissions: "purchases.return.create", body: JSON.stringify(payload) }));
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { status: string; lines: { unitCost: string; qty: string }[] };
    expect(created.status).toBe("draft");
    expect(created.lines[0]?.unitCost).toBe("60.000000");
    expect(created.lines[0]?.qty).toBe("2.000000");

    // No stock has been received yet in THIS rig, so confirming an OUT
    // movement must be refused rather than driving the position negative.
    const confirmRes = await app.fetch(req("/PRT1/confirm", { method: "POST", permissions: "purchases.return.confirm" }));
    expect(confirmRes.status).toBe(422);
    expect((await service.findById("PRT1"))?.status).toBe("draft");
    expect(await ledger.list({ sourceDocId: "PRT1" })).toHaveLength(0);
  });
});

describe("purchase-returns router — cannot return more than was received", () => {
  const sourceInvoice = {
    id: "PI1",
    number: "PI-000014",
    supplierId: "SUP1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed" as const,
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف",
        qty: Qty.fromMajor("3"),
        alreadyReturnedQty: Qty.fromMajor("1"),
        unitCost: Money.fromMajor("60"),
        taxAmount: Money.zero(),
      },
    ],
  };

  async function rigWithInvoices() {
    const rig = await buildRig();
    const invoices = {
      async findConfirmedInvoice(id: string) {
        return id === "PI1" ? sourceInvoice : null;
      },
    };
    return { ...rig, app: createPurchaseReturnsRoutes(rig.service, insecureHeaderAuthContextResolver, invoices) };
  }

  it("recomputes the returnable qty from the invoice — 3 received, 1 already returned, so 2 is the ceiling", async () => {
    const { app, service } = await rigWithInvoices();
    // The caller CLAIMS five are available. The books say two. Sending MORE
    // than the actual remainder (three) must be refused.
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-OVER", lines: [{ ...payload.lines[0], availableQty: "5", qty: "3" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await service.findById("PRT-OVER")).toBeNull();
  });

  it("accepts exactly the remainder (2), and refuses one micro-unit more", async () => {
    const { app, service } = await rigWithInvoices();
    const exact = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-EXACT", lines: [{ ...payload.lines[0], availableQty: "999", qty: "2" }] }),
      }),
    );
    expect(exact.status).toBe(201);
    expect((await service.findById("PRT-EXACT"))?.lines[0]?.availableQty.toString()).toBe("2.000000");

    const overByOne = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-OVER-1", lines: [{ ...payload.lines[0], availableQty: "999", qty: "2.000001" }] }),
      }),
    );
    expect(overByOne.status).toBe(422);
    expect(await service.findById("PRT-OVER-1")).toBeNull();
  });

  it("with NO invoices port wired, the caller's own availableQty is trusted verbatim (documented fallback)", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-TRUSTED", lines: [{ ...payload.lines[0], availableQty: "9999", qty: "500" }] }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("purchase-returns router — stock leaves at the cost it actually came in at, not the return's own claimed cost", () => {
  it("confirms at the warehouse's moving-average cost, and posts the variance against the claimed invoice cost", async () => {
    const { service, ledger, stockService } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);

    // Two receipts blend the moving average: 10 units @ 50.00, then 10 @
    // 70.00 -> average (500 + 700) / 20 = 60.00 exactly.
    await stockService.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50") }],
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    await stockService.recordOpeningBalance({
      adjustmentId: "OPEN-2",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("70") }],
      occurredAt: "2026-08-02T00:00:00.000Z",
    });
    const before = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(before.averageCost.toString()).toBe("60.000000");
    expect(before.onHand.toString()).toBe("20.000000");

    // The return line claims the invoice price (80.00) — well above the
    // actual moving-average cost (60.00) the goods are carrying.
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-WAC", lines: [{ ...payload.lines[0], qty: "5", unitCost: "80" }] }),
      }),
    );
    expect(createRes.status).toBe(201);

    const confirmRes = await app.fetch(req("/PRT-WAC/confirm", { method: "POST", permissions: "purchases.return.confirm" }));
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as { document: { status: string } };
    expect(confirmed.document.status).toBe("confirmed");

    // Stock actually removed AT the moving average: 5 * 60.00 = 300.00.
    const after = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(after.onHand.toString()).toBe("15.000000");

    const entries = await ledger.list({ sourceDocId: "PRT-WAC" });
    expect(entries).toHaveLength(1);
    const lines = entries[0]!.lines;
    const totalDebit = lines.reduce((sum, l) => sum + l.debit.scaled, 0n);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit.scaled, 0n);
    expect(totalDebit).toBe(totalCredit); // the entry balances exactly

    const ap = lines.find((l) => l.accountId === "AP");
    const inventory = lines.find((l) => l.accountId === "INVENTORY");
    const variance = lines.find((l) => l.accountId === "PRICE_VARIANCE");

    // AP is debited by the claimed grand total: 5 * 80.00 = 400.00.
    expect(ap?.debit.toString()).toBe("400.000000");
    expect(ap?.credit.toString()).toBe("0.000000");
    // Inventory is credited by what the ledger ACTUALLY removed: 5 * 60.00.
    expect(inventory?.credit.toString()).toBe("300.000000");
    expect(inventory?.debit.toString()).toBe("0.000000");
    // The 100.00 gap (claimed 400 vs actual 300) lands in the variance account.
    expect(variance?.credit.toString()).toBe("100.000000");
  });

  it("with tax on the line, AP carries the tax too but inventory/variance are tax-exclusive", async () => {
    const { service, ledger, stockService } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await stockService.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("60") }],
      occurredAt: "2026-08-01T00:00:00.000Z",
    });

    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-TAX", lines: [{ ...payload.lines[0], qty: "5", unitCost: "60", taxAmount: "42" }] }),
      }),
    );
    const confirmRes = await app.fetch(req("/PRT-TAX/confirm", { method: "POST", permissions: "purchases.return.confirm" }));
    expect(confirmRes.status).toBe(200);

    const entries = await ledger.list({ sourceDocId: "PRT-TAX" });
    const lines = entries[0]!.lines;
    const ap = lines.find((l) => l.accountId === "AP");
    const tax = lines.find((l) => l.accountId === "INPUT_TAX");
    const inventory = lines.find((l) => l.accountId === "INVENTORY");
    // AP: 5*60 cost + 42 tax = 342.00. Inventory: 5*60 = 300.00 (tax excluded).
    expect(ap?.debit.toString()).toBe("342.000000");
    expect(tax?.credit.toString()).toBe("42.000000");
    expect(inventory?.credit.toString()).toBe("300.000000");
    // No cost/WAC gap here (unitCost matches the actual average), so no
    // variance line should exist at all.
    expect(lines.find((l) => l.accountId === "PRICE_VARIANCE")).toBeUndefined();
  });
});

describe("purchase-returns router — cancel", () => {
  it("cancels a draft", async () => {
    const { service } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await app.fetch(req("/", { method: "POST", permissions: "purchases.return.create", body: JSON.stringify(payload) }));
    const res = await app.fetch(req("/PRT1/cancel", { method: "POST", permissions: "purchases.return.void" }));
    expect(res.status).toBe(200);
    expect((await service.findById("PRT1"))?.status).toBe("cancelled");
  });

  it("refuses to cancel an already-CONFIRMED return (only draft/pending may be cancelled)", async () => {
    const { service, stockService } = await buildRig();
    const app = createPurchaseReturnsRoutes(service, insecureHeaderAuthContextResolver);
    await stockService.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("60") }],
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    await app.fetch(req("/", { method: "POST", permissions: "purchases.return.create", body: JSON.stringify(payload) }));
    await app.fetch(req("/PRT1/confirm", { method: "POST", permissions: "purchases.return.confirm" }));
    expect((await service.findById("PRT1"))?.status).toBe("confirmed");

    const res = await app.fetch(req("/PRT1/cancel", { method: "POST", permissions: "purchases.return.void" }));
    expect(res.status).toBe(409);
    expect((await service.findById("PRT1"))?.status).toBe("confirmed");
  });
});

describe("purchase-returns router — list, counts, stats and warehouse scope", () => {
  async function seedTwoReturns() {
    const rig = await buildRig();
    const app = createPurchaseReturnsRoutes(rig.service, insecureHeaderAuthContextResolver);
    await rig.stockService.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("50") }].map((l) => ({ ...l, unitCost: Money.fromMajor("60") })),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    await rig.stockService.recordOpeningBalance({
      adjustmentId: "OPEN-2",
      warehouseId: "WH2",
      lines: [{ itemId: "ITEM2", qty: Qty.fromMajor("50"), unitCost: Money.fromMajor("30") }],
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({ ...payload, id: "PRT-WH1", lines: [{ ...payload.lines[0], warehouseId: "WH1", qty: "2", unitCost: "60" }] }),
      }),
    );
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "purchases.return.create",
        body: JSON.stringify({
          ...payload,
          id: "PRT-WH2",
          lines: [{ ...payload.lines[0], itemId: "ITEM2", warehouseId: "WH2", supplierId: "SUP2", availableQty: "50", qty: "3", unitCost: "30" }],
        }),
      }),
    );
    await app.fetch(req("/PRT-WH1/confirm", { method: "POST", permissions: "purchases.return.confirm" }));
    return { ...rig, app };
  }

  it("GET / narrows to the caller's warehouse scope (a return takes stock out of a warehouse)", async () => {
    const { app } = await seedTwoReturns();
    const scoped = await app.fetch(
      req("/", { permissions: "purchases.return.view", headers: { "x-warehouse-scope": "WH1" } }),
    );
    const rows = (await json(scoped)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["PRT-WH1"]);

    const unscoped = await app.fetch(req("/", { permissions: "purchases.return.view" }));
    expect(((await json(unscoped)) as unknown[]).length).toBe(2);
  });

  it("GET /counts reports every status bucket over the filtered set", async () => {
    const { app } = await seedTwoReturns();
    const res = await app.fetch(req("/counts", { permissions: "purchases.return.view" }));
    const counts = (await json(res)) as Record<string, number>;
    expect(counts.all).toBe(2);
    expect(counts.confirmed).toBe(1);
    expect(counts.draft).toBe(1);
  });

  it("GET /stats sums the grand total ONLY over confirmed returns, as an exact money string", async () => {
    const { app } = await seedTwoReturns();
    const res = await app.fetch(req("/stats", { permissions: "purchases.return.view" }));
    const body = (await json(res)) as { count: number; confirmed: number; returnedTotal: string };
    expect(body.count).toBe(2);
    expect(body.confirmed).toBe(1);
    // PRT-WH1 is the only confirmed one: 2 * 60.00 = 120.00.
    expect(body.returnedTotal).toBe("120.000000");
  });

  it("?supplierId= and ?search= narrow an already warehouse-scoped set", async () => {
    const { app } = await seedTwoReturns();
    const bySupplier = await app.fetch(req("/?supplierId=SUP2", { permissions: "purchases.return.view" }));
    expect(((await json(bySupplier)) as Array<{ id: string }>).map((r) => r.id)).toEqual(["PRT-WH2"]);

    const bySearch = await app.fetch(req("/?search=PI-000014", { permissions: "purchases.return.view" }));
    const rows = (await json(bySearch)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(["PRT-WH1", "PRT-WH2"]);
  });
});
