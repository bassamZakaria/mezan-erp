import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  Qty,
  NextNumberService,
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  postJournalEntry,
  applyAllocatedSettlement,
  type Account,
} from "@mezan/domain";
import { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "@mezan/persistence";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const COGS = "5000";
const INVENTORY = "1200";
const TREASURY_GL = "1310";
const TREASURY_ACCOUNT = "ta-cash";
const NOW = "2026-08-22T10:00:00.000Z";

const closers: SqliteSalesInvoiceStoreHandle[] = [];
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

class MemLedger {
  rows = new Map<string, any>();
  async save(e: any) {
    this.rows.set(e.id, e);
  }
  async update(e: any) {
    this.rows.set(e.id, e);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEntryNo() {
    return null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async accountBalance(accountId: string) {
    return { accountId, debit: Money.zero(), credit: Money.zero(), balance: Money.zero() };
  }
  async accountLedger() {
    return [];
  }
  async transaction<T>(fn: () => Promise<T>) {
    return fn();
  }
}
class MemSeq {
  m = new Map<string, number>();
  async increment(code: string, period: number | null) {
    const k = `${code}:${period ?? ""}`;
    const n = (this.m.get(k) ?? 0) + 1;
    this.m.set(k, n);
    return n;
  }
}
class MemStockLedger {
  rows: any[] = [];
  async append(m: any) {
    this.rows.push(m);
  }
  async listByPosition(i: string, w: string) {
    return this.rows.filter((m) => m.itemId === i && m.warehouseId === w);
  }
  async listByItem() {
    return [];
  }
  async listByWarehouse() {
    return [];
  }
  async listPositions() {
    return [];
  }
}
class MemLayers {
  rows = new Map<string, any>();
  async add(l: any) {
    this.rows.set(l.id, l);
  }
  async listByPosition(i: string, w: string) {
    return [...this.rows.values()].filter((l) => l.itemId === i && l.warehouseId === w);
  }
  async updateRemaining(id: string, q: any) {
    const l = this.rows.get(id);
    if (l) this.rows.set(id, { ...l, remainingQty: q });
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}
class MemSnaps {
  rows = new Map<string, any>();
  key(i: string, w: string) {
    return `${i}:${w}`;
  }
  async get(i: string, w: string) {
    return this.rows.get(this.key(i, w)) ?? null;
  }
  async save(s: any) {
    this.rows.set(this.key(s.itemId, s.warehouseId), s);
  }
  async list() {
    return [...this.rows.values()];
  }
}

interface HarnessOptions {
  readonly withCollect?: boolean;
  readonly currencyRefusal?: string;
  readonly knownItems?: readonly string[];
  readonly returnedCredit?: Money;
  readonly periodOpen?: boolean;
}

async function harness(opts: HarnessOptions = {}) {
  const accounts = {
    map: new Map<string, Account>([
      [AR, account(AR)],
      [REVENUE, account(REVENUE, { type: "revenue", naturalBalance: "credit" })],
      [TAX, account(TAX, { type: "liability", naturalBalance: "credit" })],
      [COGS, account(COGS, { type: "expense" })],
      [INVENTORY, account(INVENTORY)],
      [TREASURY_GL, account(TREASURY_GL)],
    ]),
    async findById(id: string) {
      return this.map.get(id) ?? null;
    },
  };
  const periods = {
    async findByDate(date: string) {
      if (opts.periodOpen === false) return null;
      return date >= "2026-08-01" && date <= "2026-08-31"
        ? {
            id: "fp",
            year: 2026,
            periodNumber: 8,
            startDate: "2026-08-01",
            endDate: "2026-08-31",
            status: "open" as const,
          }
        : null;
    },
  };
  const ledger = new MemLedger();
  const glHook = createSalesInvoiceGlHook({
    ledger: ledger as never,
    accounts,
    periods,
    numbering: new NextNumberService(new MemSeq()),
    now: () => NOW,
    actor: "u1",
  });
  const stockService = new StockLedgerService({
    ledger: new MemStockLedger() as never,
    layers: new MemLayers() as never,
    snapshots: new MemSnaps() as never,
    policy: { allowNegativeStock: true },
    clock: () => NOW,
  });
  await stockService.recordOpeningBalance({
    adjustmentId: "open-A",
    warehouseId: "WH1",
    lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("1000"), unitCost: Money.fromMajor("10") }],
  });

  const repo = createSqliteSalesInvoiceStore();
  closers.push(repo);

  const collectionNumbering = new NextNumberService(new MemSeq());
  let docSeq = 0;
  const deps: SalesInvoiceRoutesDeps = {
    repo,
    numbering: {
      next: async () => {
        const value = ++docSeq;
        return { value, formatted: `INV-${String(value).padStart(6, "0")}` };
      },
    },
    gl: glHook,
    stock: createSalesInvoiceStockHook(stockService),
    now: () => NOW,
    idGen: (() => {
      let n = 0;
      return () => `inv-${++n}`;
    })(),
    itemCheck: opts.knownItems
      ? { findById: async (id: string) => (opts.knownItems!.includes(id) ? { id } : null) }
      : undefined,
    currencyCheck: opts.currencyRefusal ? async () => opts.currencyRefusal! : undefined,
    returns:
      opts.returnedCredit === undefined
        ? undefined
        : {
            list: async () =>
              [
                {
                  id: "sr-1",
                  status: "confirmed",
                  lines: [
                    {
                      sourceInvoiceId: "inv-1",
                      qty: Qty.fromMajor("1"),
                      unitPrice: opts.returnedCredit,
                      taxAmount: Money.zero(),
                    },
                  ],
                },
              ] as never,
          },
    collect: opts.withCollect
      ? async (input) => {
          const voucherId = `COLL:${input.invoiceId}`;
          await postJournalEntry(
            {
              id: voucherId,
              date: input.date,
              memo: input.memo ?? "",
              source: "system",
              sourceDocType: "VOUCHER",
              sourceDocId: voucherId,
              lines: [
                { accountId: TREASURY_GL, debit: input.amount, credit: Money.zero() },
                { accountId: AR, debit: Money.zero(), credit: input.amount },
              ],
            },
            {
              ledger: ledger as never,
              accounts,
              periods,
              numbering: collectionNumbering,
              now: () => NOW,
              actor: "u1",
            },
          );
          const invoice = await repo.findById(input.invoiceId);
          await applyAllocatedSettlement(
            repo,
            input.invoiceId,
            (invoice?.amountPaid ?? Money.zero()).add(input.amount),
          );
          return { voucherId };
        }
      : undefined,
  };
  return { app: createSalesInvoicesRoutes(deps), ledger, repo };
}

type App = Awaited<ReturnType<typeof harness>>["app"];

const ADMIN = "*";

function req(
  path: string,
  init: RequestInit & { permissions?: string; userId?: string; branchScope?: string; warehouseScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", init.userId ?? "u1");
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.warehouseScope !== undefined) headers.set("x-warehouse-scope", init.warehouseScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      {
        lineId: "L1",
        itemId: "ITEM-A",
        itemNameAr: "صنف أ",
        isStock: true,
        qty: "10",
        unitPrice: "25",
        taxRatePercent: 14,
        revenueAccountId: REVENUE,
        cogsAccountId: COGS,
        inventoryAccountId: INVENTORY,
      },
    ],
    ...overrides,
  };
}

describe("sales-invoices-routes — every axis the list, the chips and the strip share", () => {
  async function seeded(app: App) {
    // inv-1: confirmed, due in the future, unpaid  → open
    await post(app, "/", draft({ id: "inv-1" }));
    await post(app, "/inv-1/confirm", {});
    // inv-2: confirmed, due date already past      → open AND overdue
    await post(app, "/", draft({ id: "inv-2", dueDate: "2026-08-01", customerId: "cust-2", branchId: "BR2", warehouseId: "WH1" }));
    await post(app, "/inv-2/confirm", {});
    // inv-3: still a draft                          → neither
    await post(app, "/", draft({ id: "inv-3", customerId: "cust-2" }));
  }

  async function idsOf(app: App, query: string, init: ReqInit = {}) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`, init));
    return rows.map((r) => r.id);
  }

  it("filters by stored status, customer, branch, warehouse, dates and free text", async () => {
    const { app } = await harness();
    await seeded(app);

    expect(await idsOf(app, "")).toHaveLength(3);
    expect(await idsOf(app, "?status=draft")).toEqual(["inv-3"]);
    expect(await idsOf(app, "?status=confirmed")).toEqual(expect.arrayContaining(["inv-1", "inv-2"]));
    expect(await idsOf(app, "?customerId=cust-2")).toEqual(expect.arrayContaining(["inv-2", "inv-3"]));
    expect(await idsOf(app, "?branchId=BR2")).toEqual(["inv-2"]);
    expect(await idsOf(app, "?warehouseId=WH1")).toHaveLength(3);
    expect(await idsOf(app, "?fromDate=2026-08-22")).toHaveLength(3);
    expect(await idsOf(app, "?toDate=2026-08-01")).toEqual([]);
    expect(await idsOf(app, "?search=INV-000001")).toEqual(["inv-1"]);
  });

  it("resolves the derived open and overdue chips server-side, from the remaining balance", async () => {
    const { app } = await harness();
    await seeded(app);

    expect(await idsOf(app, "?status=open")).toEqual(expect.arrayContaining(["inv-1", "inv-2"]));
    expect(await idsOf(app, "?status=overdue")).toEqual(["inv-2"]);
    expect(await idsOf(app, "?status=all")).toHaveLength(3);
  });

  it("never shows a caller invoices outside their branch or warehouse scope", async () => {
    const { app } = await harness();
    await seeded(app);

    expect(await idsOf(app, "", { branchScope: "BR2" })).toEqual(["inv-2"]);
    expect(await idsOf(app, "", { warehouseScope: "WH-OTHER" })).toEqual([]);
  });

  it("pages the rows while the chips and the strip stay over the whole filtered set", async () => {
    const { app } = await harness();
    await seeded(app);

    const page1 = await idsOf(app, "?page=1&pageSize=2");
    expect(page1).toHaveLength(2);
    const page2 = await idsOf(app, "?page=2&pageSize=2");
    expect(page2).toHaveLength(1);
    expect(page1).not.toContain(page2[0]);

    const counts = await json<Record<string, number>>(await get(app, "/counts?page=1&pageSize=2"));
    expect(counts.all).toBe(3);

    // A derived chip pages after the fact, over its own set.
    expect(await idsOf(app, "?status=open&page=1&pageSize=1")).toHaveLength(1);
  });

  it("counts every chip from the same filtered set, dropping only the status axis", async () => {
    const { app } = await harness();
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=draft"));
    expect(counts).toMatchObject({
      all: 3,
      draft: 1,
      confirmed: 2,
      partially_paid: 0,
      paid: 0,
      cancelled: 0,
      open: 2,
      overdue: 1,
    });

    const forOneCustomer = await json<Record<string, number>>(await get(app, "/counts?customerId=cust-2"));
    expect(forOneCustomer.all).toBe(2);
  });

  it("sums the strip in Money, leaving drafts and cancelled invoices out of the receivable", async () => {
    const { app } = await harness({ withCollect: true });
    await seeded(app);
    await post(app, "/inv-1/payments", { amount: "100.00", treasuryAccountId: TREASURY_ACCOUNT });

    const stats = await json<{
      count: number;
      sales: string;
      collected: string;
      returned: string;
      remaining: string;
    }>(await get(app, "/stats"));

    expect(stats.count).toBe(2);
    expect(stats.sales).toBe("570.000000");
    expect(stats.collected).toBe("100.000000");
    expect(stats.returned).toBe("0.000000");
    expect(stats.remaining).toBe("470.000000");
  });

  it("takes a confirmed return's credit off what the invoice still owes", async () => {
    const { app } = await harness({ returnedCredit: Money.fromMajor("85.00") });
    await post(app, "/", draft({ id: "inv-1" }));
    await post(app, "/inv-1/confirm", {});

    const one = await json<{ remainingBalance: string }>(await get(app, "/inv-1"));
    expect(one.remainingBalance).toBe("200.000000");

    const stats = await json<{ returned: string; remaining: string }>(await get(app, "/stats"));
    expect(stats.returned).toBe("85.000000");
    expect(stats.remaining).toBe("200.000000");
  });

  it("400s a list, counts or stats query the contract refuses", async () => {
    const { app } = await harness();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await get(app, `${path}?status=imaginary`);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
    }
    expect((await get(app, "/?pageSize=500")).status).toBe(400);
  });
});

describe("sales-invoices-routes — the visibility tiers the catalogue defines", () => {
  async function twoSalespeople(app: App) {
    await post(app, "/", draft({ id: "inv-1", salespersonId: "u1" }));
    await post(app, "/", draft({ id: "inv-2", salespersonId: "u2" }));
  }

  it("shows a view_own caller only their own rows, in the list and the chips alike", async () => {
    const { app } = await harness();
    await twoSalespeople(app);

    const own = { permissions: "sales.invoice.view_own", userId: "u1" };
    const rows = await json<Array<{ id: string }>>(await get(app, "/", own));
    expect(rows.map((r) => r.id)).toEqual(["inv-1"]);

    const counts = await json<Record<string, number>>(await get(app, "/counts", own));
    expect(counts.all).toBe(1);
  });

  it("404s — never 403s — a view_own caller reading someone else's invoice", async () => {
    const { app } = await harness();
    await twoSalespeople(app);

    const res = await get(app, "/inv-2", { permissions: "sales.invoice.view_own", userId: "u1" });
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).toBe("NOT_FOUND");
  });

  it("hides unit cost from a caller without sales.invoice.view_cost, on the list and the detail", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));

    const withCost = await json<Array<{ lines: Array<Record<string, unknown>> }>>(
      await get(app, "/", { permissions: "sales.invoice.view,sales.invoice.view_cost" }),
    );
    expect(withCost[0]!.lines[0]).toHaveProperty("unitCost");

    const without = await json<Array<{ lines: Array<Record<string, unknown>> }>>(
      await get(app, "/", { permissions: "sales.invoice.view" }),
    );
    expect(without[0]!.lines[0]).not.toHaveProperty("unitCost");

    const detail = await json<{ lines: Array<Record<string, unknown>> }>(
      await get(app, "/inv-1", { permissions: "sales.invoice.view" }),
    );
    expect(detail.lines[0]).not.toHaveProperty("unitCost");
  });

  it("403s a caller with no sales visibility at all", async () => {
    const { app } = await harness();
    expect((await get(app, "/", { permissions: "inventory.item.view" })).status).toBe(403);
    expect((await get(app, "/counts", { permissions: "inventory.item.view" })).status).toBe(403);
    expect((await get(app, "/stats", { permissions: "inventory.item.view" })).status).toBe(403);
  });
});

describe("sales-invoices-routes — reading, cancelling and refusing", () => {
  it("serves an invoice by its document number as well as by its id", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));
    await post(app, "/inv-1/confirm", {});

    const byNumber = await json<{ id: string }>(await get(app, "/INV-000001"));
    expect(byNumber.id).toBe("inv-1");
  });

  it("404s an invoice that is not there, and a confirm or cancel naming one", async () => {
    const { app } = await harness();
    expect((await get(app, "/nope")).status).toBe(404);
    expect((await post(app, "/nope/confirm", {})).status).toBe(404);
    expect((await post(app, "/nope/cancel")).status).toBe(404);
  });

  it("cancels a draft and refuses to confirm it afterwards", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));

    const cancelled = await post(app, "/inv-1/cancel");
    expect(cancelled.status).toBe(200);
    expect((await json<{ status: string }>(cancelled)).status).toBe("cancelled");

    expect((await post(app, "/inv-1/confirm", {})).status).toBe(409);
  });

  it("409s a second invoice reusing an id already in the books", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));
    const again = await post(app, "/", draft({ id: "inv-1" }));
    expect(again.status).toBe(409);
  });

  it("422s a document in a currency the tenant has not enabled", async () => {
    const { app } = await harness({ currencyRefusal: "العملة USD غير مُدرجة" });
    const res = await post(app, "/", draft({ currency: "USD" }));
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("CURRENCY_NOT_ALLOWED");
  });

  it("422s a line naming an item the catalogue does not hold (D38)", async () => {
    const { app } = await harness({ knownItems: ["ITEM-A"] });
    const res = await post(
      app,
      "/",
      draft({
        lines: [
          {
            lineId: "L1",
            itemId: "ITEM-1",
            itemNameAr: "مخترع",
            isStock: false,
            qty: "1",
            unitPrice: "5",
            taxRatePercent: 0,
            revenueAccountId: REVENUE,
          },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("ITEM_NOT_FOUND");
  });

  it("422s — never 500s — a confirm whose date falls outside every fiscal period", async () => {
    const { app } = await harness({ periodOpen: false });
    await post(app, "/", draft({ id: "inv-1" }));
    const res = await post(app, "/inv-1/confirm", {});
    expect(res.status).toBe(422);
  });

  it("treats a confirm with no body at all as an empty one", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));
    const res = await app.fetch(req("/inv-1/confirm", { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe("confirmed");
  });

  it("400s a confirm or a payment body the schema rejects", async () => {
    const { app } = await harness({ withCollect: true });
    await post(app, "/", draft({ id: "inv-1" }));
    expect((await post(app, "/inv-1/confirm", { requestId: 5 })).status).toBe(400);
    expect((await post(app, "/inv-1/payments", { amount: "10.00" })).status).toBe(400);
  });
});

describe("sales-invoices-routes — تحصيل من عميل", () => {
  it("503s when no treasury module is mounted, rather than marking the invoice paid (D1)", async () => {
    const { app } = await harness();
    await post(app, "/", draft({ id: "inv-1" }));
    await post(app, "/inv-1/confirm", {});

    const res = await post(app, "/inv-1/payments", { amount: "50.00", treasuryAccountId: TREASURY_ACCOUNT });
    expect(res.status).toBe(503);
    expect((await json<{ error: string }>(res)).error).toBe("COLLECTION_UNAVAILABLE");
  });

  it("posts a real voucher, and the invoice's amountPaid follows the allocation", async () => {
    const { app, ledger } = await harness({ withCollect: true });
    await post(app, "/", draft({ id: "inv-1" }));
    await post(app, "/inv-1/confirm", {});

    const res = await post(app, "/inv-1/payments", {
      amount: "285.00",
      treasuryAccountId: TREASURY_ACCOUNT,
      paymentMethod: "bank",
      referenceNo: "TRX-1",
      notes: "دفعة",
    });
    expect(res.status).toBe(200);
    const payload = await json<{ voucherId: string; amountPaid: string; status: string }>(res);
    expect(payload.voucherId).toBe("COLL:inv-1");
    expect(payload.amountPaid).toBe("285.000000");
    expect(await ledger.findById("COLL:inv-1")).not.toBeNull();
  });

  it("422s collecting more than the invoice still owes, and collecting on a draft", async () => {
    const { app } = await harness({ withCollect: true });
    await post(app, "/", draft({ id: "inv-1" }));

    const onDraft = await post(app, "/inv-1/payments", { amount: "10.00", treasuryAccountId: TREASURY_ACCOUNT });
    expect(onDraft.status).toBe(422);

    await post(app, "/inv-1/confirm", {});
    const tooMuch = await post(app, "/inv-1/payments", { amount: "9999.00", treasuryAccountId: TREASURY_ACCOUNT });
    expect(tooMuch.status).toBe(422);
  });

  it("404s collecting against an invoice that does not exist", async () => {
    const { app } = await harness({ withCollect: true });
    const res = await post(app, "/nope/payments", { amount: "10.00", treasuryAccountId: TREASURY_ACCOUNT });
    expect(res.status).toBe(404);
  });
});
