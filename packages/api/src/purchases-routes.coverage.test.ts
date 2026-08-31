import { describe, it, expect, afterEach } from "vitest";
import {
  StockLedgerService,
  Money,
  AllocationExceedsError,
  type Account,
  type PurchasePolicy,
} from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqlitePurchasingStores,
  createSqliteStockLedgerStore,
  createSqliteVoucherStore,
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

interface AppOptions {
  readonly policy?: PurchasePolicy;
  readonly periodStatus?: "open" | "closed" | "locked";
  readonly inventoryAccountId?: string;
  readonly now?: string;
  readonly withAllocatable?: boolean;
  readonly withPay?: boolean;
  readonly payThrows?: unknown;
  readonly knownItems?: readonly string[];
  readonly currencyRefusal?: string;
  readonly withLayers?: boolean;
}

async function newApp(opts: AppOptions = {}) {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const purchasing = createSqlitePurchasingStores();
  const stockStore = createSqliteStockLedgerStore();
  const vouchers = createSqliteVoucherStore();
  closers.push(uow, ledger, accounts, periods, purchasing, stockStore, vouchers);

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
    status: opts.periodStatus ?? "open",
  });

  const stock = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });

  const now = opts.now ?? "2026-08-21T09:00:00.000Z";
  const paid: Array<{ invoiceId: string; amount: Money }> = [];

  const app = createApp(uow, {
    purchases: {
      orders: purchasing.orders,
      receipts: purchasing.receipts,
      invoices: purchasing.invoices,
      numbering: ledger.numbering,
      stock,
      gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => now },
      accounts: {
        inventoryAccountId: opts.inventoryAccountId ?? "1300-inv",
        payableAccountId: "2100-ap",
        taxAccountId: "1360-vat",
        freightAccountId: "5200-freight",
      },
      allocatable: opts.withAllocatable ? vouchers.invoices : undefined,
      itemCheck: opts.knownItems
        ? { findById: async (id: string) => (opts.knownItems!.includes(id) ? { id } : null) }
        : undefined,
      currencyCheck: opts.currencyRefusal ? async () => opts.currencyRefusal! : undefined,
      pay: opts.withPay
        ? async (input) => {
            if (opts.payThrows) throw opts.payThrows;
            const open = await vouchers.invoices.findById(input.invoiceId);
            if (open) {
              await vouchers.invoices.save({ ...open, allocated: open.allocated.add(input.amount) });
            }
            paid.push({ invoiceId: input.invoiceId, amount: input.amount });
            return { voucherId: `pv-${paid.length}`, voucherNo: `PV-0000${paid.length}` };
          }
        : undefined,
      resolveTaxRate: () => 14,
      now: () => now,
      layers: opts.withLayers ? stockStore.layers : undefined,
      policy: opts.policy,
    },
  });
  return { app, ledger, stock, vouchers, paid };
}

const ADMIN = "*";

function req(
  path: string,
  init: RequestInit & { permissions?: string; branchScope?: string; warehouseScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.warehouseScope !== undefined) headers.set("x-warehouse-scope", init.warehouseScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    supplierId: "sup-1",
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    lines: [{ itemId: "item-A", qty: "10", unitPrice: "25.00" }],
    ...overrides,
  };
}

function manualInvoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi-1",
    supplierId: "sup-1",
    date: "2026-08-22",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    lines: [{ itemId: "item-A", qty: "10", unitCost: "25.00", taxRatePercent: 14 }],
    ...overrides,
  };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];
type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, {
      method: "POST",
      permissions: ADMIN,
      ...init,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, { permissions: ADMIN, ...init }));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("purchases-routes — the refusals the domain raises reach the caller as status codes", () => {
  it("404s a confirm or cancel naming an order, receipt or invoice that is not there", async () => {
    const { app } = await newApp();
    expect((await post(app, "/purchases/orders/nope/confirm")).status).toBe(404);
    expect((await post(app, "/purchases/orders/nope/cancel")).status).toBe(404);
    expect((await post(app, "/purchases/receipts/nope/confirm")).status).toBe(404);
    expect((await post(app, "/purchases/invoices/nope/confirm")).status).toBe(404);
  });

  it("409s a second document reusing an id already in the books", async () => {
    const { app } = await newApp();
    expect((await post(app, "/purchases/orders", orderBody())).status).toBe(201);
    const again = await post(app, "/purchases/orders", orderBody({ supplierId: "sup-2" }));
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("DUPLICATE_PURCHASE_DOCUMENT");
  });

  it("409s confirming a goods receipt that has already left draft", async () => {
    const { app } = await newApp();
    await post(app, "/purchases/orders", orderBody());
    await post(app, "/purchases/orders/po-1/confirm");
    await post(app, "/purchases/receipts", { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" });
    expect((await post(app, "/purchases/receipts/gr-1/confirm")).status).toBe(200);
    const twice = await post(app, "/purchases/receipts/gr-1/confirm");
    expect(twice.status).toBe(409);
    expect((await json<{ error: string }>(twice)).error).toBe("PURCHASE_DOCUMENT_NOT_DRAFT");
  });

  it("409s receiving against an order that is still draft", async () => {
    const { app } = await newApp();
    await post(app, "/purchases/orders", orderBody());
    const res = await post(app, "/purchases/receipts", {
      id: "gr-1",
      purchaseOrderId: "po-1",
      date: "2026-08-22",
    });
    expect(res.status).toBe(409);
  });

  it("422s a line the domain rejects, and names every reason", async () => {
    const { app } = await newApp();
    const res = await post(
      app,
      "/purchases/orders",
      orderBody({ lines: [{ itemId: "item-A", qty: "0", unitPrice: "25.00" }] }),
    );
    expect(res.status).toBe(422);
    const payload = await json<{ error: string; reasons: string[] }>(res);
    expect(payload.error).toBe("INVALID_PURCHASE_DOCUMENT");
    expect(payload.reasons.join(" ")).toContain("qty must be positive");
  });

  it("422s over-receiving a purchase order when the policy blocks it", async () => {
    const { app } = await newApp({
      policy: {
        requirePoForGrn: false,
        requireReceiptForInvoice: false,
        blockOverReceipt: true,
        trackSoldPurchaseItems: true,
      },
    });
    await post(app, "/purchases/orders", orderBody());
    await post(app, "/purchases/orders/po-1/confirm");
    const res = await post(app, "/purchases/receipts", {
      id: "gr-1",
      purchaseOrderId: "po-1",
      date: "2026-08-22",
      lines: [{ itemId: "item-A", qty: "99", unitCost: "25.00" }],
    });
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("PURCHASE_OVER_RECEIPT");
  });

  it("422s an invoice raised with no receipt when the policy requires one", async () => {
    const { app } = await newApp({
      policy: {
        requirePoForGrn: false,
        requireReceiptForInvoice: true,
        blockOverReceipt: false,
        trackSoldPurchaseItems: true,
      },
    });
    const res = await post(app, "/purchases/invoices", {
      id: "pi-1",
      supplierId: "sup-1",
      date: "2026-08-22",
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      lines: [{ itemId: "item-A", qty: "1", unitCost: "10.00" }],
    });
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("PURCHASE_RECEIPT_REQUIRED");
  });

  it("422s — never 500s — an invoice confirm that lands in a closed period (D20)", async () => {
    const { app } = await newApp({ periodStatus: "closed" });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    const res = await post(app, "/purchases/invoices/pi-1/confirm");
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });

  it("422s a confirm whose configured GL account does not exist", async () => {
    const { app } = await newApp({ inventoryAccountId: "9999-missing" });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    const res = await post(app, "/purchases/invoices/pi-1/confirm");
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("404s a receipt whose purchase order does not exist", async () => {
    const { app } = await newApp();
    const res = await post(app, "/purchases/receipts", {
      id: "gr-1",
      purchaseOrderId: "po-nope",
      date: "2026-08-22",
    });
    expect(res.status).toBe(404);
  });
});

describe("purchases-routes — the create guards in front of the domain", () => {
  it("400s a body the schema rejects", async () => {
    const { app } = await newApp();
    const res = await post(app, "/purchases/orders", { id: "po-1" });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
  });

  it("400s an invoice that names neither lines nor a receipt", async () => {
    const { app } = await newApp();
    const res = await post(app, "/purchases/invoices", {
      id: "pi-1",
      supplierId: "sup-1",
      date: "2026-08-22",
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
    });
    expect(res.status).toBe(400);
    expect((await json<{ message: string }>(res)).message).toBe("lines or receiptId is required");
  });

  it("404s an invoice built from a receipt that is not there", async () => {
    const { app } = await newApp();
    const res = await post(app, "/purchases/invoices", {
      id: "pi-1",
      supplierId: "sup-1",
      date: "2026-08-22",
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      receiptId: "gr-nope",
    });
    expect(res.status).toBe(404);
  });

  it("422s a document in a currency the tenant has not enabled", async () => {
    const { app } = await newApp({ currencyRefusal: "العملة USD غير مُدرجة" });
    const order = await post(app, "/purchases/orders", orderBody({ currency: "USD" }));
    expect(order.status).toBe(422);
    expect((await json<{ error: string }>(order)).error).toBe("CURRENCY_NOT_ALLOWED");

    const invoice = await post(app, "/purchases/invoices", {
      id: "pi-1",
      supplierId: "sup-1",
      date: "2026-08-22",
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      currency: "USD",
      lines: [{ itemId: "item-A", qty: "1", unitCost: "10.00" }],
    });
    expect(invoice.status).toBe(422);
  });

  it("422s a line naming an item the catalogue does not hold, on all three documents", async () => {
    const { app } = await newApp({ knownItems: ["item-A"] });
    const order = await post(
      app,
      "/purchases/orders",
      orderBody({ lines: [{ itemId: "ITEM-1", qty: "1", unitPrice: "5.00" }] }),
    );
    expect(order.status).toBe(422);
    expect((await json<{ itemIds: string[] }>(order)).itemIds).toEqual(["ITEM-1"]);

    const receipt = await post(app, "/purchases/receipts", {
      id: "gr-1",
      date: "2026-08-22",
      supplierId: "sup-1",
      warehouseId: "MAIN-WH",
      lines: [{ itemId: "ITEM-1", qty: "1", unitCost: "5.00" }],
    });
    expect(receipt.status).toBe(422);

    const invoice = await post(app, "/purchases/invoices", {
      id: "pi-1",
      supplierId: "sup-1",
      date: "2026-08-22",
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      lines: [{ itemId: "ITEM-1", qty: "1", unitCost: "5.00" }],
    });
    expect(invoice.status).toBe(422);
  });
});

async function twoOrders(app: App) {
  await post(app, "/purchases/orders", orderBody({ id: "po-1", date: "2026-08-05" }));
  await post(
    app,
    "/purchases/orders",
    orderBody({
      id: "po-2",
      supplierId: "sup-2",
      date: "2026-08-20",
      branchId: "BR2",
      warehouseId: "WH2",
    }),
  );
}

describe("purchases-routes — every axis the order screen narrows by", () => {
  async function idsOf(app: App, query: string) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/purchases/orders${query}`));
    return rows.map((r) => r.id);
  }

  it("filters by supplier, both date bounds, branch, warehouse and free text", async () => {
    const { app } = await newApp();
    await twoOrders(app);

    expect(await idsOf(app, "")).toEqual(["po-1", "po-2"]);
    expect(await idsOf(app, "?status=all")).toEqual(["po-1", "po-2"]);
    expect(await idsOf(app, "?supplierId=sup-2")).toEqual(["po-2"]);
    expect(await idsOf(app, "?fromDate=2026-08-10")).toEqual(["po-2"]);
    expect(await idsOf(app, "?toDate=2026-08-10")).toEqual(["po-1"]);
    expect(await idsOf(app, "?branchId=BR2")).toEqual(["po-2"]);
    expect(await idsOf(app, "?warehouseId=MAIN-WH")).toEqual(["po-1"]);
    expect(await idsOf(app, "?search=PO-000002")).toEqual(["po-2"]);
    expect(await idsOf(app, "?search=SUP-1")).toEqual(["po-1"]);
    expect(await idsOf(app, "?search=%20%20")).toEqual(["po-1", "po-2"]);
  });

  it("counts and sums the same filtered set the rows came from", async () => {
    const { app } = await newApp();
    await twoOrders(app);
    await post(app, "/purchases/orders/po-2/confirm");

    const counts = await json<Record<string, number>>(await get(app, "/purchases/orders/counts?supplierId=sup-2"));
    expect(counts).toMatchObject({ all: 1, draft: 0, sent: 1 });

    const stats = await json<{ count: number; sent: number; received: number; value: string }>(
      await get(app, "/purchases/orders/stats?supplierId=sup-2"),
    );
    expect(stats).toMatchObject({ count: 1, sent: 1, received: 0, value: "250.000000" });
  });

  it("leaves a cancelled order out of the order-book value but not out of the count", async () => {
    const { app } = await newApp();
    await twoOrders(app);
    await post(app, "/purchases/orders/po-1/cancel");

    const stats = await json<{ count: number; value: string }>(await get(app, "/purchases/orders/stats"));
    expect(stats.count).toBe(2);
    expect(stats.value).toBe("250.000000");

    const counts = await json<Record<string, number>>(await get(app, "/purchases/orders/counts"));
    expect(counts.cancelled).toBe(1);
  });

  it("shows a caller only the branches and warehouses their scope reaches", async () => {
    const { app } = await newApp();
    await twoOrders(app);

    const branchScoped = await json<Array<{ id: string }>>(
      await get(app, "/purchases/orders", { branchScope: "BR2" }),
    );
    expect(branchScoped.map((r) => r.id)).toEqual(["po-2"]);

    const warehouseScoped = await json<Array<{ id: string }>>(
      await get(app, "/purchases/orders", { warehouseScope: "MAIN-WH" }),
    );
    expect(warehouseScoped.map((r) => r.id)).toEqual(["po-1"]);

    // A query parameter cannot widen a scope it sits inside.
    const both = await json<Array<{ id: string }>>(
      await get(app, "/purchases/orders?branchId=MAIN", { branchScope: "BR2" }),
    );
    expect(both).toEqual([]);
  });
});

describe("purchases-routes — every axis the goods-receipt screen narrows by", () => {
  async function twoReceipts(app: App) {
    await twoOrders(app);
    await post(app, "/purchases/orders/po-1/confirm");
    await post(app, "/purchases/orders/po-2/confirm");
    await post(app, "/purchases/receipts", { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-06" });
    await post(app, "/purchases/receipts", { id: "gr-2", purchaseOrderId: "po-2", date: "2026-08-21" });
    await post(app, "/purchases/receipts/gr-1/confirm");
  }

  async function idsOf(app: App, query: string) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/purchases/receipts${query}`));
    return rows.map((r) => r.id);
  }

  it("filters by supplier, date bounds, warehouse, the invoiced flag and free text", async () => {
    const { app } = await newApp();
    await twoReceipts(app);

    expect(await idsOf(app, "?supplierId=sup-2")).toEqual(["gr-2"]);
    expect(await idsOf(app, "?fromDate=2026-08-10")).toEqual(["gr-2"]);
    expect(await idsOf(app, "?toDate=2026-08-10")).toEqual(["gr-1"]);
    expect(await idsOf(app, "?warehouseId=WH2")).toEqual(["gr-2"]);
    expect(await idsOf(app, "?status=confirmed")).toEqual(["gr-1"]);
    expect(await idsOf(app, "?invoiced=false")).toEqual(["gr-1", "gr-2"]);
    expect(await idsOf(app, "?invoiced=true")).toEqual([]);
    expect(await idsOf(app, "?invoiced=")).toEqual(["gr-1", "gr-2"]);
    expect(await idsOf(app, "?search=GR-000002")).toEqual(["gr-2"]);
    expect(await idsOf(app, "?search=sup-2")).toEqual(["gr-2"]);
  });

  it("counts the invoiced and uninvoiced chips over the filtered set", async () => {
    const { app } = await newApp();
    await twoReceipts(app);
    const counts = await json<Record<string, number>>(await get(app, "/purchases/receipts/counts?status=draft"));
    expect(counts).toMatchObject({ all: 2, draft: 1, confirmed: 1, invoiced: 0, uninvoiced: 2 });
  });

  it("values only the confirmed receipts in the KPI strip", async () => {
    const { app } = await newApp();
    await twoReceipts(app);
    const stats = await json<{ count: number; confirmed: number; uninvoiced: number; value: string }>(
      await get(app, "/purchases/receipts/stats"),
    );
    expect(stats).toMatchObject({ count: 2, confirmed: 1, uninvoiced: 2, value: "250.000000" });
  });
});

describe("purchases-routes — the payment states the invoice list derives from the sub-ledger", () => {
  const NOW = "2026-08-21T09:00:00.000Z";

  async function seedInvoices(app: App) {
    await post(app, "/purchases/invoices", manualInvoiceBody({ id: "pi-overdue", dueDate: "2026-08-10" }));
    await post(app, "/purchases/invoices", manualInvoiceBody({ id: "pi-soon", dueDate: "2026-08-25" }));
    await post(app, "/purchases/invoices", manualInvoiceBody({ id: "pi-open", dueDate: null }));
    for (const id of ["pi-overdue", "pi-soon", "pi-open"]) {
      await post(app, `/purchases/invoices/${id}/confirm`);
    }
  }

  it("marks an invoice overdue, due soon, partially paid or paid from the allocations alone", async () => {
    const { app } = await newApp({ now: NOW, withAllocatable: true, withPay: true });
    await seedInvoices(app);

    await post(app, "/purchases/invoices/pi-open/payments", { amount: "100.00", treasuryAccountId: "cash-1" });

    const idsFor = async (status: string) => {
      const rows = await json<Array<{ id: string }>>(await get(app, `/purchases/invoices?status=${status}`));
      return rows.map((r) => r.id);
    };

    expect(await idsFor("overdue")).toEqual(["pi-overdue"]);
    expect(await idsFor("due_soon")).toEqual(["pi-soon"]);
    expect(await idsFor("partially_paid")).toEqual(["pi-open"]);
    expect(await idsFor("paid")).toEqual([]);
    expect(await idsFor("confirmed")).toHaveLength(3);
    expect(await idsFor("draft")).toEqual([]);

    // Settle the rest of it: the same invoice must leave "partially paid" and land in "paid".
    await post(app, "/purchases/invoices/pi-open/payments", { amount: "185.00", treasuryAccountId: "cash-1" });
    expect(await idsFor("partially_paid")).toEqual([]);
    expect(await idsFor("paid")).toEqual(["pi-open"]);
  });

  it("counts every payment chip and sums paid against still-unpaid in the KPI strip", async () => {
    const { app } = await newApp({ now: NOW, withAllocatable: true, withPay: true });
    await seedInvoices(app);
    await post(app, "/purchases/invoices/pi-open/payments", { amount: "100.00", treasuryAccountId: "cash-1" });

    const counts = await json<Record<string, number>>(await get(app, "/purchases/invoices/counts?status=paid"));
    expect(counts).toMatchObject({
      all: 3,
      confirmed: 3,
      overdue: 1,
      due_soon: 1,
      partially_paid: 1,
      paid: 0,
    });

    const stats = await json<{ count: number; purchases: string; paid: string; unpaid: string }>(
      await get(app, "/purchases/invoices/stats"),
    );
    expect(stats.count).toBe(3);
    expect(stats.purchases).toBe("855.000000");
    expect(stats.paid).toBe("100.000000");
    expect(stats.unpaid).toBe("755.000000");
  });

  it("filters invoices by supplier, dates, branch, warehouse and the supplier's own number", async () => {
    const { app } = await newApp({ now: NOW });
    await post(app, "/purchases/invoices", manualInvoiceBody({ id: "pi-1", supplierInvoiceNumber: "S-77" }));
    await post(
      app,
      "/purchases/invoices",
      manualInvoiceBody({
        id: "pi-2",
        supplierId: "sup-2",
        date: "2026-08-28",
        branchId: "BR2",
        warehouseId: "WH2",
      }),
    );

    const idsOf = async (query: string) => {
      const rows = await json<Array<{ id: string }>>(await get(app, `/purchases/invoices${query}`));
      return rows.map((r) => r.id);
    };

    expect(await idsOf("?supplierId=sup-2")).toEqual(["pi-2"]);
    expect(await idsOf("?fromDate=2026-08-25")).toEqual(["pi-2"]);
    expect(await idsOf("?toDate=2026-08-25")).toEqual(["pi-1"]);
    expect(await idsOf("?branchId=BR2")).toEqual(["pi-2"]);
    expect(await idsOf("?warehouseId=MAIN-WH")).toEqual(["pi-1"]);
    expect(await idsOf("?search=s-77")).toEqual(["pi-1"]);
    expect(await idsOf("?search=PI-000002")).toEqual(["pi-2"]);
  });

  it("400s a list, counts or stats query carrying a status the contract does not know", async () => {
    const { app } = await newApp();
    for (const path of ["/purchases/invoices", "/purchases/invoices/counts", "/purchases/invoices/stats"]) {
      const res = await get(app, `${path}?status=nonsense`);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
    }
  });
});

describe("purchases-routes — سداد للمورد off the invoice", () => {
  const paymentBody = { amount: "50.00", treasuryAccountId: "cash-1" };

  it("503s when the treasury module is not wired, rather than flipping the invoice to paid (D40)", async () => {
    const { app } = await newApp({ withAllocatable: true });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    await post(app, "/purchases/invoices/pi-1/confirm");
    const res = await post(app, "/purchases/invoices/pi-1/payments", paymentBody);
    expect(res.status).toBe(503);
    expect((await json<{ error: string }>(res)).error).toBe("PAYMENT_UNAVAILABLE");
  });

  it("400s a payment body the schema rejects and 404s an invoice that is not there", async () => {
    const { app } = await newApp({ withAllocatable: true, withPay: true });
    expect((await post(app, "/purchases/invoices/pi-1/payments", { amount: "50.00" })).status).toBe(400);
    expect((await post(app, "/purchases/invoices/nope/payments", paymentBody)).status).toBe(404);
  });

  it("422s paying a draft invoice, a zero amount, or more than the invoice still owes", async () => {
    const { app } = await newApp({ withAllocatable: true, withPay: true });
    await post(app, "/purchases/invoices", manualInvoiceBody());

    const draft = await post(app, "/purchases/invoices/pi-1/payments", paymentBody);
    expect(draft.status).toBe(422);
    expect((await json<{ error: string }>(draft)).error).toBe("INVOICE_NOT_PAYABLE");

    await post(app, "/purchases/invoices/pi-1/confirm");

    const zero = await post(app, "/purchases/invoices/pi-1/payments", { ...paymentBody, amount: "0" });
    expect(zero.status).toBe(422);
    expect((await json<{ error: string }>(zero)).error).toBe("INVALID_PAYMENT");

    const tooMuch = await post(app, "/purchases/invoices/pi-1/payments", { ...paymentBody, amount: "999.00" });
    expect(tooMuch.status).toBe(422);
    expect((await json<{ error: string }>(tooMuch)).error).toBe("PAYMENT_EXCEEDS_BALANCE");
  });

  it("pays the invoice through a real voucher and reports what is settled", async () => {
    const { app, paid } = await newApp({ withAllocatable: true, withPay: true });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    await post(app, "/purchases/invoices/pi-1/confirm");

    const res = await post(app, "/purchases/invoices/pi-1/payments", {
      amount: "85.00",
      treasuryAccountId: "cash-1",
      paymentMethod: "bank",
      date: "2026-08-23",
      referenceNo: "TRX-9",
      notes: "دفعة أولى",
    });
    expect(res.status).toBe(200);
    const payload = await json<{
      voucherId: string;
      voucherNo: string;
      amountPaid: string;
      remainingBalance: string;
    }>(res);
    expect(payload.voucherId).toBe("pv-1");
    expect(payload.voucherNo).toBe("PV-00001");
    expect(payload.amountPaid).toBe("85.000000");
    expect(payload.remainingBalance).toBe("200.000000");
    expect(paid[0]?.amount.toString()).toBe("85.000000");
  });

  it("422s — never 500s — a refusal raised inside the voucher engine", async () => {
    const { app } = await newApp({
      withAllocatable: true,
      withPay: true,
      payThrows: new AllocationExceedsError("التخصيص يتجاوز رصيد الفاتورة"),
    });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    await post(app, "/purchases/invoices/pi-1/confirm");
    const res = await post(app, "/purchases/invoices/pi-1/payments", paymentBody);
    expect(res.status).toBe(422);
  });
});

describe("purchases-routes — what an invoice delivered and what is left of it", () => {
  it("404s the fulfilment of an invoice that is not there", async () => {
    const { app } = await newApp();
    expect((await get(app, "/purchases/invoices/nope/fulfilment")).status).toBe(404);
  });

  it("reports a draft manual invoice as having received nothing", async () => {
    const { app } = await newApp({ withLayers: true });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    const res = await json<{ sourceDocId: string | null; sourceDocType: string | null; lines: Array<{ receivedQty: string }> }>(
      await get(app, "/purchases/invoices/pi-1/fulfilment"),
    );
    expect(res.sourceDocId).toBeNull();
    expect(res.sourceDocType).toBeNull();
    expect(res.lines[0]?.receivedQty).toBe("0.000000");
  });

  it("treats a confirmed manual invoice as its own receiving document", async () => {
    const { app } = await newApp({ withLayers: true });
    await post(app, "/purchases/invoices", manualInvoiceBody());
    await post(app, "/purchases/invoices/pi-1/confirm");
    const res = await json<{
      sourceDocType: string | null;
      lines: Array<{ receivedQty: string; remainingQty: string; consumedQty: string }>;
    }>(await get(app, "/purchases/invoices/pi-1/fulfilment"));
    expect(res.sourceDocType).toBe("PURCHASE_INVOICE");
    expect(res.lines[0]).toMatchObject({
      receivedQty: "10.000000",
      remainingQty: "10.000000",
      consumedQty: "0.000000",
    });
  });

  it("reports a non-inventory line as delivering no quantity at all", async () => {
    const { app } = await newApp({ withLayers: true });
    await post(
      app,
      "/purchases/invoices",
      manualInvoiceBody({
        lines: [
          { itemId: "item-A", qty: "10", unitCost: "25.00", taxRatePercent: 14 },
          { kind: "expense", description: "شحن", qty: "1", unitCost: "40.00" },
        ],
      }),
    );
    await post(app, "/purchases/invoices/pi-1/confirm");
    const res = await json<{ lines: Array<{ itemId: string | null; receivedQty: string; invoicedQty: string }> }>(
      await get(app, "/purchases/invoices/pi-1/fulfilment"),
    );
    expect(res.lines[1]).toMatchObject({ itemId: null, invoicedQty: "1.000000", receivedQty: "0.000000" });
  });

  it("reports zero remaining when the cost layers are not wired at all", async () => {
    const { app } = await newApp();
    await post(app, "/purchases/invoices", manualInvoiceBody());
    await post(app, "/purchases/invoices/pi-1/confirm");
    const res = await json<{ lines: Array<{ remainingQty: string; consumedQty: string }> }>(
      await get(app, "/purchases/invoices/pi-1/fulfilment"),
    );
    expect(res.lines[0]).toMatchObject({ remainingQty: "0.000000", consumedQty: "10.000000" });
  });
});
