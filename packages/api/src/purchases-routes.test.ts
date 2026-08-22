import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, type Account } from "@mezan/domain";
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

async function newApp() {
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
