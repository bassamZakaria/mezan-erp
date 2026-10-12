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

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const AR = "1105";
const REVENUE = "4000";
const TAX = "2201";
const NOW = "2026-08-22T10:00:00.000Z";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

/** A user id is not an employee id. `salespersonId` holds the employee's (D147). */
const USER_TO_EMPLOYEE = new Map([
  ["rep-a", "emp-a"],
  ["rep-b", "emp-b"],
]);

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
    taxPolicy: () => ({ enabled: true, defaultRatePercent: 0, inclusive: false }),
    taxRates: { list: async () => [] },
    // The two id spaces must DIFFER in this harness. They used to be the same
    // string, which is why D147 — `view_own` comparing an employee id against a
    // user id — passed every test in this file while showing a real rep nothing.
    users: {
      findById: async (id: string) =>
        USER_TO_EMPLOYEE.has(id)
          ? ({ id, employeeId: USER_TO_EMPLOYEE.get(id)! } as Awaited<ReturnType<NonNullable<SalesInvoiceRoutesDeps["users"]>["findById"]>>)
          : null,
    },
    numbering: { next: () => ledger.numbering.next("SALES_INVOICE") },
    gl: createSalesInvoiceGlHook({ ledger, accounts, periods, numbering: ledger.numbering, now: () => NOW, actor: "u1" }),
    stock: createSalesInvoiceStockHook(stockService),
    now: () => NOW,
  };
  return { app: createSalesInvoicesRoutes(deps, insecureHeaderAuthContextResolver), repo };
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
  expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-mine", "emp-a", "عميل المندوب أ", "1250.50")) }))).status).toBe(201);
  expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-theirs", "emp-b", "عميل المندوب ب", "9999.99")) }))).status).toBe(201);
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
    expect(text).not.toContain("emp-b");
    expect(text).not.toContain("9999.99");
    expect(text).not.toContain("عميل المندوب ب");
  });

  it("an invoice an own-records rep raises without naming a salesperson is theirs: they can open it and confirm it, and a colleague cannot", async () => {
    const { app } = await harness();
    const REP = "sales.invoice.create,sales.invoice.confirm";
    const { salespersonId: _unnamed, ...unassigned } = draft("inv-unnamed", "emp-a", "عميل المندوب أ", "100");
    const created = await app.fetch(req("/", { method: "POST", permissions: REP, userId: "rep-a", body: JSON.stringify(unassigned) }));
    expect(created.status).toBe(201);
    expect(((await created.json()) as { salespersonId: string | null }).salespersonId).toBe("emp-a");
    expect((await app.fetch(req("/inv-unnamed", { permissions: REP, userId: "rep-a" }))).status).toBe(200);
    expect((await app.fetch(req("/inv-unnamed/confirm", { method: "POST", permissions: REP, userId: "rep-b", body: "{}" }))).status).toBe(404);
    expect((await app.fetch(req("/inv-unnamed/confirm", { method: "POST", permissions: REP, userId: "rep-a", body: "{}" }))).status).toBe(200);
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
    expect(text).not.toContain("emp-b");
  });

  it("serves their OWN invoice by id, at its real figures", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    const res = await app.fetch(req("/inv-mine", { permissions: OWN, userId: "rep-a" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; totals: { grandTotal: string }; salespersonId: string; lines: { unitCost?: string }[] };
    expect(body.id).toBe("inv-mine");
    expect(body.salespersonId).toBe("emp-a");
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

  it("resolves the caller's employee id — an invoice stamped with their USER id is not theirs (D147)", async () => {
    const { app } = await harness();
    // The trap the old code fell into: `salespersonId` set to the caller's USER
    // id. `view_own` compared the two directly, so this looked like a match
    // while a real invoice — stamped with the EMPLOYEE id — matched nothing.
    expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-userid", "rep-a", "عميل بمعرّف مستخدم", "77.00")) }))).status).toBe(201);
    expect((await app.fetch(req("/", { method: "POST", permissions: ADMIN, body: JSON.stringify(draft("inv-empid", "emp-a", "عميل بمعرّف موظف", "1250.50")) }))).status).toBe(201);

    const rows = (await (await app.fetch(req("/", { permissions: OWN, userId: "rep-a" }))).json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["inv-empid"]);

    expect((await app.fetch(req("/inv-userid", { permissions: OWN, userId: "rep-a" }))).status).toBe(404);
    expect((await app.fetch(req("/inv-empid", { permissions: OWN, userId: "rep-a" }))).status).toBe(200);
  });

  it("shows a `.view_own` caller with no employee link nothing, rather than the whole tenant", async () => {
    const { app } = await harness();
    await seedTwoInvoices(app);

    // `rep-c` is not in USER_TO_EMPLOYEE, so no employee id resolves. The tier
    // must fail CLOSED: dropping the clause would widen the list to everyone.
    const res = await app.fetch(req("/", { permissions: OWN, userId: "rep-c" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual([]);
    expect(text).not.toContain("9999.99");
    expect(text).not.toContain("1250.50");
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

describe("D70 closed: sales returns admit the `.view_own` tier and narrow it (DEC-14)", () => {
  /**
   * The catalog grants SALES_REP and VAN_SALES `sales.return.view_own`
   * (demo-seed/access.ts) and the list gated on `sales.return.view` alone, so
   * the rep was refused their OWN returns with a 403 — and counts and stats
   * refused too, so the screen had no fallback.
   *
   * A return document records no author, so "own" is resolved the way
   * `sales-quotes-routes.ts` resolves it for a quote: by the scope the session
   * already carries. A return puts goods back into a WAREHOUSE and a van rep
   * is scoped to their van, so that is the narrowing key — and a `view_own`
   * caller carrying the all-warehouse sentinel sees nothing at all rather than
   * the whole tenant.
   */
  const returnIn = (id: string, warehouseId: string, unitPrice: string) => ({
    id,
    date: "2026-08-22",
    memo: "",
    lines: [
      {
        itemId: "ITEM1",
        warehouseId,
        customerId: "CUST1",
        sourceInvoiceId: "INV1",
        sourceInvoiceNumber: "INV-000014",
        reason: "DEFECTIVE",
        availableQty: "5",
        qty: "1",
        unitPrice,
        unitCost: "60",
        taxAmount: "0",
      },
    ],
  });

  function scoped(path: string, permissions: string, warehouses?: string) {
    const headers = new Headers({ "x-permissions": permissions, "x-user-id": "rep-a" });
    if (warehouses !== undefined) headers.set("x-warehouse-scope", warehouses);
    return new Request("http://local" + path, { headers });
  }

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
    return createSalesReturnsRoutes(service, insecureHeaderAuthContextResolver);
  }

  it("admits a `sales.return.view_own` holder on the list, the counts and the stats", async () => {
    const app = await returnsApp();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await app.fetch(scoped(path, "sales.return.view_own", "WH-VAN"));
      expect(res.status, `${path} refused a view_own holder`).toBe(200);
    }
  });

  it("narrows a `view_own` holder to the warehouse they are scoped to, totals included", async () => {
    const app = await returnsApp();
    for (const body of [returnIn("sr-mine", "WH-VAN", "100"), returnIn("sr-theirs", "WH-MAIN", "9999.99")]) {
      const res = await app.fetch(
        new Request("http://local/", {
          method: "POST",
          headers: { "x-permissions": "*", "x-user-id": "admin", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(201);
    }

    const listed = await app.fetch(scoped("/", "sales.return.view_own", "WH-VAN"));
    const text = await listed.text();
    expect((JSON.parse(text) as { id: string }[]).map((r) => r.id)).toEqual(["sr-mine"]);
    expect(text).not.toContain("sr-theirs");
    expect(text).not.toContain("9999.99");

    const counts = (await (await app.fetch(scoped("/counts", "sales.return.view_own", "WH-VAN"))).json()) as { all: number };
    expect(counts.all).toBe(1);

    // The plain `.view` tier still sees both, so the narrowing above is the
    // tier at work rather than an empty database.
    const all = (await (await app.fetch(scoped("/", "sales.return.view"))).json()) as { id: string }[];
    expect(all.map((r) => r.id).sort()).toEqual(["sr-mine", "sr-theirs"]);
  });

  it("shows a `view_own` holder NOTHING when their scope is every warehouse — a widened gate with no narrowing key is a leak", async () => {
    const app = await returnsApp();
    const res = await app.fetch(
      new Request("http://local/", {
        method: "POST",
        headers: { "x-permissions": "*", "x-user-id": "admin", "content-type": "application/json" },
        body: JSON.stringify(returnIn("sr-any", "WH-MAIN", "100")),
      }),
    );
    expect(res.status).toBe(201);

    const listed = await app.fetch(scoped("/", "sales.return.view_own"));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);
    // And by direct id it is a 404, not a 403: whether it exists is itself
    // information.
    expect((await app.fetch(scoped("/sr-any", "sales.return.view_own"))).status).toBe(404);
  });

  it("still admits the plain `.view` tier, unchanged by the widening", async () => {
    const app = await returnsApp();
    const res = await app.fetch(req("/", { permissions: "sales.return.view", userId: "rep-a" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
