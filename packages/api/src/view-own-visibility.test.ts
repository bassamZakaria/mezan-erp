/**
 * The `.view_own` visibility tier (D31/D70): a caller whose ONLY visibility
 * grant is `<module>.view_own` sees the records they are the salesperson on,
 * and must not receive anybody elses — not in the list, not by direct id, and
 * not smuggled into a total.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  Qty,
  StockLedgerService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  DocumentService,
  createDocumentWorkflowGate,
  createJournalGlHook,
  createSalesReturnDocumentType,
} from "@mezan/domain";
import {
  createSqliteSalesInvoiceStore,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";
import { createSalesReturnsRoutes } from "./sales-returns-routes.js";

const AR = "1105";
const REVENUE = "4000";
const TAX = "2201";
const NOW = "2026-08-22T10:00:00.000Z";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function harness() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const stock = createSqliteStockLedgerStore();
  const repo = createSqliteSalesInvoiceStore();
  closers.push(ledger, accounts, periods, stock, repo);

  for (const [id, type, natural] of [
    [AR, "asset", "debit"],
    [REVENUE, "revenue", "credit"],
    [TAX, "liability", "credit"],
  ] as const) {
    await accounts.create({ id, code: id, nameAr: id, nameEn: null, type, naturalBalance: natural, parentId: null, isHeader: false, status: "active" });
  }
  await periods.create({ id: "P1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const stockService = new StockLedgerService({
    ledger: stock.ledger,
    layers: stock.layers,
    snapshots: stock.snapshots,
    policy: { allowNegativeStock: true },
    transaction: stock.transaction,
    clock: () => NOW,
  });

  const deps: SalesInvoiceRoutesDeps = {
    repo,
    numbering: { next: () => ledger.numbering.next("SALES_INVOICE") },
    gl: createSalesInvoiceGlHook({ ledger, accounts, periods, numbering: ledger.numbering, now: () => NOW, actor: "u1" }),
    stock: createSalesInvoiceStockHook(stockService),
    now: () => NOW,
  };
  return { app: createSalesInvoicesRoutes(deps), repo };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  headers.set("x-user-id", init.userId ?? "rep-a");
  if (init.body) headers.set("content-type", "application/json");
  return new Request("http://local" + path, { ...init, headers });
}

function draft(id: string, salespersonId: string, customerNameAr: string, unitPrice: string) {
  return {
    id,
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-" + salespersonId,
    customerNameAr,
    warehouseId: "WH1",
    branchId: "BR1",
    salespersonId,
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      { lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice, taxRatePercent: 0, revenueAccountId: REVENUE },
    ],
  };
}

const OWN = "sales.invoice.view_own";
const ADMIN = "*";

async function seedTwoInvoices(app: { fetch(r: Request): Response | Promise<Response> }) {
  // Two reps, two customers, two very different figures, so a leak shows up in
  // the total as well as in the rows.
  expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-mine", "rep-a", "عميل المندوب أ", "1250.50")) }))).status).toBe(201);
  expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-theirs", "rep-b", "عميل المندوب ب", "9999.99")) }))).status).toBe(201);
  expect((await app.fetch(req("/inv-mine/confirm", { method: "POST", permissions: ADMIN, body: "{}" }))).status).toBe(200);
  expect((await app.fetch(req("/inv-theirs/confirm", { method: "POST", permissions: ADMIN, body: "{}" }))).status).toBe(200);
}

describe("sales invoices — a `.view_own` caller sees their own work and only their own", () => {
  it("lists their own invoice and leaves no trace of the other one in the body", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const res = await app.fetch(req("/", { permissions: OWN, userId: "rep-a" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const rows = JSON.parse(text) as { id: string; salespersonId: string; totals: { grandTotal: string } }[];

    expect(rows.map((r) => r.id)).toEqual(["inv-mine"]);
    expect(rows[0]!.totals.grandTotal).toBe("1250.500000");
    expect(text).not.toContain("inv-theirs");
    expect(text).not.toContain("rep-b");
    expect(text).not.toContain("9999.99");
    expect(text).not.toContain("عميل المندوب ب");
  });

  it("answers 404 — not 403 — for the other reps invoice by direct id, with no fields in the body", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const res = await app.fetch(req("/inv-theirs", { permissions: OWN, userId: "rep-a" }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "NOT_FOUND" });
    expect(text).not.toContain("9999.99");
    expect(text).not.toContain("عميل المندوب ب");
    expect(text).not.toContain("rep-b");
  });

  it("serves their OWN invoice by id, at its real figures", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const res = await app.fetch(req("/inv-mine", { permissions: OWN, userId: "rep-a" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; totals: { grandTotal: string }; salespersonId: string; lines: { unitCost?: string }[] };
    expect(body.id).toBe("inv-mine");
    expect(body.salespersonId).toBe("rep-a");
    expect(body.totals.grandTotal).toBe("1250.500000");
    // No `.view_cost` in the grant, so the cost field is ABSENT, not null.
    expect(Object.keys(body.lines[0]!)).not.toContain("unitCost");
  });

  it("narrows the KPI strip and the chip counts to the same set — a total is information too", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const stats = (await (await app.fetch(req("/stats", { permissions: OWN, userId: "rep-a" }))).json()) as { count: number; sales: string; remaining: string };
    expect(stats.count).toBe(1);
    expect(stats.sales).toBe("1250.500000");
    expect(stats.remaining).toBe("1250.500000");

    const counts = (await (await app.fetch(req("/counts", { permissions: OWN, userId: "rep-a" }))).json()) as { all: number; confirmed: number };
    expect(counts.all).toBe(1);
    expect(counts.confirmed).toBe(1);
  });

  it("shows the whole tenant to a `.view` holder, so the narrowing above is the tier and not an empty database", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const rows = (await (await app.fetch(req("/", { permissions: "sales.invoice.view", userId: "rep-a" }))).json()) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["inv-mine", "inv-theirs"]);

    const stats = (await (await app.fetch(req("/stats", { permissions: "sales.invoice.view", userId: "rep-a" }))).json()) as { sales: string };
    expect(stats.sales).toBe("11250.490000");
  });

  it("shows a `.view_own` caller nothing at all when the session carries no user id", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const headers = new Headers({ "x-permissions": OWN });
    const rows = (await (await app.fetch(new Request("http://local/", { headers }))).json()) as unknown[];
    expect(rows).toEqual([]);
  });
});

describe("LIMITATION (D70): sibling modules gate on `.view` and lock out a `.view_own` holder", () => {
  /**
   * The catalog grants SALES_REP and VAN_SALES `sales.return.view_own`,
   * `sales.quote.view_own` and `field.van_trip.view_own` (demo-seed/access.ts).
   * Sales invoices gate on `gateAny(view, view_all, view_own)` and then NARROW.
   * Returns, quotes and van trips gate on the plain `.view` tier, so the rep
   * is refused their OWN work with a 403 rather than being narrowed to it.
   *
   * When D70 is closed these become 200 with the callers own rows only.
   */
  async function returnsApp() {
    const ledger = createSqliteLedgerStore();
    const accounts = createSqliteAccountRepository();
    const periods = createSqliteFiscalPeriodRepository();
    const repo = createStandaloneSqliteSalesReturnStore();
    closers.push(ledger, accounts, periods, repo);
    const service = new DocumentService(
      createSalesReturnDocumentType({
        accountsReceivableId: AR,
        salesReturnsAccountId: "4100",
        outputTaxPayableAccountId: TAX,
        inventoryAccountId: "1200",
        cogsAccountId: "5000",
      }),
      {
        repo,
        numbering: { next: () => ledger.numbering.next("SALES_RETURN") },
        gl: createJournalGlHook({ ledger, accounts, periods, numbering: ledger.numbering }),
        workflow: createDocumentWorkflowGate(() => null),
      },
    );
    return createSalesReturnsRoutes(service);
  }

  it("refuses a `sales.return.view_own` holder with 403 on the returns list", async () => {
    const app = await returnsApp();
    const res = await app.fetch(req("/", { permissions: "sales.return.view_own", userId: "rep-a" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("sales.return.view");
  });

  it("refuses the same holder on the counts and stats endpoints too, so the screen has no fallback", async () => {
    const app = await returnsApp();
    expect((await app.fetch(req("/counts", { permissions: "sales.return.view_own", userId: "rep-a" }))).status).toBe(403);
    expect((await app.fetch(req("/stats", { permissions: "sales.return.view_own", userId: "rep-a" }))).status).toBe(403);
  });

  it("still admits the plain `.view` tier, which is what makes the 403 above the tier and not the route", async () => {
    const app = await returnsApp();
    const res = await app.fetch(req("/", { permissions: "sales.return.view", userId: "rep-a" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
