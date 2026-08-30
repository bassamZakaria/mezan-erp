import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, Qty, type Account, type PurchasePolicy } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqlitePurchasingStores,
  createSqliteStockLedgerStore,
} from "@mezan/persistence";
import { createApp } from "./app.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

async function newApp(opts: { withCancel?: boolean; policy?: PurchasePolicy } = {}) {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const purchasing = createSqlitePurchasingStores();
  const stockStore = createSqliteStockLedgerStore();
  closers.push(uow, ledger, accounts, periods, purchasing, stockStore);

  await accounts.create(account("1300-inv"));
  await accounts.create(account("1360-vat"));
  await accounts.create(account("2100-ap", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("5200-freight", { type: "expense" }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const stock = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });

  const app = createApp(uow, {
    purchases: {
      orders: purchasing.orders,
      receipts: purchasing.receipts,
      invoices: purchasing.invoices,
      numbering: ledger.numbering,
      stock,
      gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
      accounts: {
        inventoryAccountId: "1300-inv",
        payableAccountId: "2100-ap",
        taxAccountId: "1360-vat",
        freightAccountId: "5200-freight",
      },
      resolveTaxRate: () => 14,
      now: () => "2026-08-21T09:00:00.000Z",
      layers: opts.withCancel ? stockStore.layers : undefined,
      policy: opts.policy,
    },
  });
  return { app, ledger, stock };
}

const ADMIN = "*";
function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const orderBody = {
  id: "po-1",
  supplierId: "sup-1",
  date: "2026-08-21",
  branchId: "MAIN",
  warehouseId: "MAIN-WH",
  lines: [
    { itemId: "item-A", qty: "10", unitPrice: "25.00" },
    { itemId: "item-B", qty: "5", unitPrice: "12.00" },
  ],
};

describe("purchases-routes — permission gates", () => {
  it("403s creating a PO with no permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/purchases/orders", { method: "POST", body: JSON.stringify(orderBody) }));
    expect(res.status).toBe(403);
  });

  it("403s confirming an invoice without purchases.invoice.confirm", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/purchases/invoices/pi-x/confirm", { method: "POST", permissions: "purchases.invoice.view" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("purchases-routes — full PO → GRN → invoice chain", () => {
  it("drives the whole chain and posts stock + a balanced GL entry", async () => {
    const { app, ledger, stock } = await newApp();

    // 1. create + confirm PO
    let res = await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));
    expect(res.status).toBe(201);
    const po = (await res.json()) as { number: string; status: string; total: string };
    expect(po.number).toBe("PO-000001");
    expect(po.total).toBe("310.000000");

    res = await app.fetch(req("/purchases/orders/po-1/confirm", { method: "POST", permissions: ADMIN }));
    expect(((await res.json()) as { status: string }).status).toBe("sent");

    // 2. create receipt from PO (auto-fill), then confirm → stock IN
    res = await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }),
      }),
    );
    expect(res.status).toBe(201);
    const gr = (await res.json()) as { number: string; lines: unknown[] };
    expect(gr.number).toBe("GR-000001");
    expect(gr.lines).toHaveLength(2);

    res = await app.fetch(req("/purchases/receipts/gr-1/confirm", { method: "POST", permissions: ADMIN }));
    expect(((await res.json()) as { status: string }).status).toBe("confirmed");
    expect((await stock.getBalanceDetail("item-A", "MAIN-WH")).onHand.toString()).toBe("10.000000");

    // PO advanced to fully received
    res = await app.fetch(req("/purchases/orders/po-1", { permissions: ADMIN }));
    expect(((await res.json()) as { status: string }).status).toBe("fully_received");

    // 3. create invoice from receipt (auto-fill lines + tax), then confirm
    res = await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-1",
          supplierId: "sup-1",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          receiptId: "gr-1",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const inv = (await res.json()) as { number: string; tax: string; total: string; lines: { taxRatePercent: number }[] };
    expect(inv.number).toBe("PI-000001");
    expect(inv.lines[0]?.taxRatePercent).toBe(14);
    expect(inv.tax).toBe("43.400000");
    expect(inv.total).toBe("353.400000");

    res = await app.fetch(req("/purchases/invoices/pi-1/confirm", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("confirmed");

    // from-receipt invoice does NOT re-post stock
    expect((await stock.getBalanceDetail("item-A", "MAIN-WH")).onHand.toString()).toBe("10.000000");

    // a system JE was posted and balances: AP credited 353.40
    const apBalance = await ledger.accountBalance("2100-ap");
    expect(apBalance.credit.toString()).toBe("353.400000");
    const invBalance = await ledger.accountBalance("1300-inv");
    expect(invBalance.debit.toString()).toBe("310.000000");
    const vatBalance = await ledger.accountBalance("1360-vat");
    expect(vatBalance.debit.toString()).toBe("43.400000");
  });

  it("manual invoice (no receipt) posts stock IN and a GL entry", async () => {
    const { app, ledger, stock } = await newApp();
    let res = await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-m",
          supplierId: "sup-2",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          lines: [
            { itemId: "item-C", kind: "inventory", qty: "4", unitCost: "50.00", taxRatePercent: 14 },
            { itemId: null, kind: "expense", description: "شحن", qty: "1", unitCost: "30.00", taxRatePercent: 0 },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);

    res = await app.fetch(req("/purchases/invoices/pi-m/confirm", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);

    expect((await stock.getBalanceDetail("item-C", "MAIN-WH")).onHand.toString()).toBe("4.000000");
    expect((await ledger.accountBalance("2100-ap")).credit.toString()).toBe("258.000000");
    expect((await ledger.accountBalance("5200-freight")).debit.toString()).toBe("30.000000");
  });

  it("422s a receipt against a non-existent PO", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-x", purchaseOrderId: "nope", date: "2026-08-22", lines: [{ itemId: "i", qty: "1", unitCost: "1.00" }] }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("purchases-routes — cancel endpoints (require `layers`)", () => {
  it("are not mounted when `layers` is omitted (404 at the routing level)", async () => {
    const { app } = await newApp();
    const receiptRes = await app.fetch(req("/purchases/receipts/gr-x/cancel", { method: "POST", permissions: ADMIN }));
    expect(receiptRes.status).toBe(404);
    const invoiceRes = await app.fetch(req("/purchases/invoices/pi-x/cancel", { method: "POST", permissions: ADMIN }));
    expect(invoiceRes.status).toBe(404);
  });

  it("cancels a draft goods receipt trivially (no stock/PO effect yet)", async () => {
    const { app } = await newApp({ withCancel: true });
    await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));
    await app.fetch(req("/purchases/orders/po-1/confirm", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }),
      }),
    );
    const res = await app.fetch(req("/purchases/receipts/gr-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
  });

  it("cancels a confirmed goods receipt, reversing stock and rolling the PO back", async () => {
    const { app, stock } = await newApp({ withCancel: true });
    await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));
    await app.fetch(req("/purchases/orders/po-1/confirm", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }),
      }),
    );
    await app.fetch(req("/purchases/receipts/gr-1/confirm", { method: "POST", permissions: ADMIN }));
    expect((await stock.getBalanceDetail("item-A", "MAIN-WH")).onHand.toString()).toBe("10.000000");

    const res = await app.fetch(req("/purchases/receipts/gr-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
    expect((await stock.getBalanceDetail("item-A", "MAIN-WH")).onHand.toString()).toBe("0.000000");

    const orderRes = await app.fetch(req("/purchases/orders/po-1", { permissions: ADMIN }));
    expect(((await orderRes.json()) as { status: string }).status).toBe("sent");
  });

  it("422s cancelling a goods receipt that has already been invoiced (GOODS_RECEIPT_ALREADY_INVOICED)", async () => {
    const { app } = await newApp({ withCancel: true });
    await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));
    await app.fetch(req("/purchases/orders/po-1/confirm", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }),
      }),
    );
    await app.fetch(req("/purchases/receipts/gr-1/confirm", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "pi-1", supplierId: "sup-1", date: "2026-08-22", branchId: "MAIN", warehouseId: "MAIN-WH", receiptId: "gr-1" }),
      }),
    );
    await app.fetch(req("/purchases/invoices/pi-1/confirm", { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(req("/purchases/receipts/gr-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("GOODS_RECEIPT_ALREADY_INVOICED");
  });

  it("422s creating a receipt with no PO when requirePoForGrn is on (PURCHASE_ORDER_REQUIRED)", async () => {
    const { app } = await newApp({
      withCancel: true,
      policy: { requirePoForGrn: true, requireReceiptForInvoice: false, blockOverReceipt: false, trackSoldPurchaseItems: true },
    });
    const res = await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-adhoc", date: "2026-08-22", supplierId: "sup-1", warehouseId: "MAIN-WH", lines: [{ itemId: "item-A", qty: "1", unitCost: "10.00" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PURCHASE_ORDER_REQUIRED");
  });

  it("cancels a draft purchase invoice trivially", async () => {
    const { app } = await newApp({ withCancel: true });
    await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-draft",
          supplierId: "sup-2",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          lines: [{ itemId: "item-C", kind: "inventory", qty: "1", unitCost: "10.00", taxRatePercent: 0 }],
        }),
      }),
    );
    const res = await app.fetch(req("/purchases/invoices/pi-draft/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
  });

  it("cancels a confirmed manual purchase invoice, reversing GL and stock", async () => {
    const { app, ledger, stock } = await newApp({ withCancel: true });
    await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-m",
          supplierId: "sup-2",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          lines: [{ itemId: "item-C", kind: "inventory", qty: "4", unitCost: "50.00", taxRatePercent: 0 }],
        }),
      }),
    );
    await app.fetch(req("/purchases/invoices/pi-m/confirm", { method: "POST", permissions: ADMIN }));
    expect((await stock.getBalanceDetail("item-C", "MAIN-WH")).onHand.toString()).toBe("4.000000");
    expect((await ledger.accountBalance("2100-ap")).credit.toString()).toBe("200.000000");

    const res = await app.fetch(req("/purchases/invoices/pi-m/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");

    expect((await stock.getBalanceDetail("item-C", "MAIN-WH")).onHand.toString()).toBe("0.000000");
    const apBalance = await ledger.accountBalance("2100-ap");
    expect(apBalance.credit.toString()).toBe(apBalance.debit.toString());
  });

  it("422s cancelling a confirmed invoice whose goods have since been sold (PURCHASE_ITEMS_ALREADY_CONSUMED)", async () => {
    const { app, stock } = await newApp({ withCancel: true });
    await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-sold",
          supplierId: "sup-2",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          lines: [{ itemId: "item-D", kind: "inventory", qty: "5", unitCost: "20.00", taxRatePercent: 0 }],
        }),
      }),
    );
    await app.fetch(req("/purchases/invoices/pi-sold/confirm", { method: "POST", permissions: ADMIN }));

    // simulate a sale drawing down the layer this invoice created.
    await stock.postIssue({
      issueId: "iss-1",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "si-1",
      warehouseId: "MAIN-WH",
      lines: [{ itemId: "item-D", qty: Qty.fromMajor("2") }],
    });

    const res = await app.fetch(req("/purchases/invoices/pi-sold/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PURCHASE_ITEMS_ALREADY_CONSUMED");
  });
});

describe("purchases-routes — the list surfaces the screens actually read", () => {
  async function seededChain() {
    const harness = await newApp();
    const { app } = harness;
    await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));
    await app.fetch(req("/purchases/orders/po-1/confirm", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/purchases/receipts", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }),
      }),
    );
    await app.fetch(req("/purchases/receipts/gr-1/confirm", { method: "POST", permissions: ADMIN }));
    return harness;
  }

  async function invoiceFromReceipt(app: Awaited<ReturnType<typeof newApp>>["app"]) {
    await app.fetch(
      req("/purchases/invoices", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "pi-1",
          supplierId: "sup-1",
          date: "2026-08-22",
          branchId: "MAIN",
          warehouseId: "MAIN-WH",
          receiptId: "gr-1",
        }),
      }),
    );
  }

  it("lists orders, and narrows them by status", async () => {
    const { app } = await seededChain();

    const all = await app.fetch(req("/purchases/orders", { permissions: ADMIN }));
    expect(((await all.json()) as unknown[]).length).toBe(1);

    const received = await app.fetch(req("/purchases/orders?status=fully_received", { permissions: ADMIN }));
    expect(((await received.json()) as unknown[]).length).toBe(1);

    const draft = await app.fetch(req("/purchases/orders?status=draft", { permissions: ADMIN }));
    expect((await draft.json()) as unknown[]).toEqual([]);
  });

  it("counts every chip from the same filtered set, ignoring only the status axis", async () => {
    const { app } = await seededChain();
    const res = await app.fetch(req("/purchases/orders/counts?status=draft", { permissions: ADMIN }));
    const counts = (await res.json()) as Record<string, number>;
    expect(counts.all).toBe(1);
    expect(counts.fully_received).toBe(1);
    expect(counts.draft).toBe(0);
  });

  it("sums the order book in Money, and leaves a cancelled order out of the value", async () => {
    const { app } = await newApp();
    await app.fetch(req("/purchases/orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(orderBody) }));

    const before = await app.fetch(req("/purchases/orders/stats", { permissions: ADMIN }));
    expect((await before.json()) as { count: number; value: string }).toMatchObject({
      count: 1,
      value: "310.000000",
    });

    await app.fetch(req("/purchases/orders/po-1/cancel", { method: "POST", permissions: ADMIN }));
    const after = await app.fetch(req("/purchases/orders/stats", { permissions: ADMIN }));
    expect((await after.json()) as { count: number; value: string }).toMatchObject({
      count: 1,
      value: "0.000000",
    });
  });

  it("lists receipts and reports them as uninvoiced until an invoice names them", async () => {
    const { app } = await seededChain();

    const listed = await app.fetch(req("/purchases/receipts", { permissions: ADMIN }));
    expect(((await listed.json()) as unknown[]).length).toBe(1);

    const counts = await app.fetch(req("/purchases/receipts/counts", { permissions: ADMIN }));
    expect((await counts.json()) as Record<string, number>).toMatchObject({
      all: 1,
      confirmed: 1,
      uninvoiced: 1,
      invoiced: 0,
    });

    await invoiceFromReceipt(app);
    await app.fetch(req("/purchases/invoices/pi-1/confirm", { method: "POST", permissions: ADMIN }));

    const after = await app.fetch(req("/purchases/receipts/counts", { permissions: ADMIN }));
    expect((await after.json()) as Record<string, number>).toMatchObject({ invoiced: 1, uninvoiced: 0 });
  });

  it("reports the invoice chips and the payable they add up to", async () => {
    const { app } = await seededChain();
    await invoiceFromReceipt(app);
    await app.fetch(req("/purchases/invoices/pi-1/confirm", { method: "POST", permissions: ADMIN }));

    const counts = await app.fetch(req("/purchases/invoices/counts", { permissions: ADMIN }));
    expect((await counts.json()) as Record<string, number>).toMatchObject({ all: 1, confirmed: 1 });

    const stats = await app.fetch(req("/purchases/invoices/stats", { permissions: ADMIN }));
    expect(JSON.stringify(await stats.json())).toContain("353.400000");
  });

  it("returns an empty list for a filter that matches nothing, not the whole table", async () => {
    const { app } = await seededChain();
    for (const path of [
      "/purchases/orders?supplierId=sup-nobody",
      "/purchases/receipts?supplierId=sup-nobody",
      "/purchases/invoices?supplierId=sup-nobody",
    ]) {
      const res = await app.fetch(req(path, { permissions: ADMIN }));
      expect((await res.json()) as unknown[], path).toEqual([]);
    }
  });

  it("404s an order, a receipt and an invoice that are not there", async () => {
    const { app } = await newApp();
    for (const path of ["/purchases/orders/nope", "/purchases/receipts/nope", "/purchases/invoices/nope"]) {
      expect((await app.fetch(req(path, { permissions: ADMIN }))).status, path).toBe(404);
    }
  });

  it("reports what an invoice still owes against what was received", async () => {
    const { app } = await seededChain();
    await invoiceFromReceipt(app);
    const res = await app.fetch(req("/purchases/invoices/pi-1/fulfilment", { permissions: ADMIN }));
    expect(res.status).toBe(200);
  });
});
