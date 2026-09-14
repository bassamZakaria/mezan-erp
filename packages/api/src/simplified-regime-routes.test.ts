import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSalesInvoiceStore,
  createSqliteCustomerRepository,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createStandaloneSqliteSimplifiedRegimeStore,
} from "@mezan/persistence";
import {
  Money,
  Qty,
  type Customer,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SimplifiedRegimeRepository,
} from "@mezan/domain";
import { createSimplifiedRegimeRoutes } from "./simplified-regime-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function makeLine(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "line-1",
    itemId: "item-1",
    itemNameAr: "صنف تجريبي",
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("1000000.00"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    costCenterId: null,
    unitCost: null,
    unitCode: "",
    unitFactor: 1,
    discountType: "percent" as const,
    discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function makeInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-03-10",
    dueDate: "2026-03-20",
    customerId: "cust-1",
    customerNameAr: "عميل تجريبي",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "br-1",
    salespersonId: null,
    salespersonNameAr: null,
    projectId: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120",
    taxAccountId: "2200",
    lines: [makeLine()],
    amountPaid: Money.zero(),
    createdAt: "2026-03-10T00:00:00.000Z",
    confirmedAt: "2026-03-10T00:00:00.000Z",
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

function makeCustomer(id: string, nameAr: string): Customer {
  return {
    id,
    code: id,
    nameAr,
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 0,
    active: true,
    branchId: "br-1",
    openingBalance: Money.zero(),
    currency: "EGP",
    priceListId: null,
    creditLimit: Money.zero(),
    taxExempt: false,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  };
}

async function newApp(seed?: (deps: { regime: SimplifiedRegimeRepository }) => Promise<void>) {
  const salesInvoices = createSqliteSalesInvoiceStore();
  const customers = createSqliteCustomerRepository();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const regime = createStandaloneSqliteSimplifiedRegimeStore();
  handles.push(salesInvoices, customers, ledger, accounts, regime);
  if (seed) await seed({ regime });
  const app = createSimplifiedRegimeRoutes(
    { regime, salesInvoices, customers, accounts, ledger, now: () => "2026-06-30T00:00:00.000Z" },
    insecureHeaderAuthContextResolver,
  );
  return { app, salesInvoices, customers, regime };
}

function req(path: string, permissions?: string, init: RequestInit = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (permissions !== undefined) headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("simplified-regime routes — the gate", () => {
  it("refuses a caller with no permission", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/"))).status).toBe(403);
    expect((await app.fetch(req("/comparison"))).status).toBe(403);
  });
});

describe("GET / — the record, the table, and an ESTIMATE that says so", () => {
  it("reads 'nothing filed' on a fresh tenant rather than inventing a regime", async () => {
    const { app } = await newApp();
    const body = (await (await app.fetch(req("/", "*"))).json()) as any;
    expect(body.election.state).toBe("not_elected");
    expect(body.activeToday).toBe(false);
    expect(body.vatPeriod.mode).toBe("monthly");
  });

  it("prices the year from posted sales and marks the figure an estimate", async () => {
    const { app, salesInvoices } = await newApp();
    await salesInvoices.save(makeInvoice());
    const body = (await (await app.fetch(req("/", "*"))).json()) as any;
    // 1,000,000 of turnover sits in the 0.5% band → 5,000.
    expect(body.liability.turnover).toBe("1000000.000000");
    expect(body.liability.ratePercent).toBe(0.5);
    expect(body.liability.tax).toBe("5000.000000");
    expect(body.liability.estimate).toBe(true);
    expect(body.liability.sources.length).toBeGreaterThan(0);
  });

  it("surfaces the client-concentration figure without acting on it", async () => {
    const { app, salesInvoices, customers } = await newApp();
    await customers.save(makeCustomer("cust-1", "عميل كبير"));
    await customers.save(makeCustomer("cust-2", "عميل صغير"));
    await salesInvoices.save(makeInvoice());
    await salesInvoices.save(
      makeInvoice({
        id: "inv-2",
        docNo: "INV-000002",
        customerId: "cust-2",
        lines: [makeLine({ lineId: "line-2", unitPrice: Money.fromMajor("50000.00") })],
      }),
    );
    const body = (await (await app.fetch(req("/", "*"))).json()) as any;
    expect(body.concentration.topSharePercent).toBe(100);
    expect(body.concentration.mayDisqualify).toBe(true);
    expect(body.concentration.topClients[0].customerName).toBe("عميل كبير");
  });

  it("names the five Decree 420 books against reports that already exist", async () => {
    const { app } = await newApp();
    const body = (await (await app.fetch(req("/", "*"))).json()) as any;
    expect(body.books.map((book: { key: string }) => book.key)).toEqual([
      "fixedAssetRegister",
      "stockRegister",
      "salesJournal",
      "purchasesJournal",
      "taxSummaryBook",
    ]);
    for (const book of body.books) expect(book.screenKey).not.toBe("");
  });
});

describe("PUT / — recording a filing, never making one", () => {
  it("refuses an active regime with no Form 1/10 reference", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/", "*", { method: "PUT", body: JSON.stringify({ state: "active", electedOn: "2025-06-01" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("stores the filing, derives the irrevocability window, and turns the VAT return quarterly", async () => {
    const { app } = await newApp();
    const saved = await app.fetch(
      req("/", "*", {
        method: "PUT",
        body: JSON.stringify({
          state: "active",
          electedOn: "2025-06-01",
          form110Reference: "1/10-2025-0042",
          eInvoicingJoinedOn: "2025-01-15",
        }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as any).irrevocableUntil).toBe("2030-05-31");

    const body = (await (await app.fetch(req("/", "*"))).json()) as any;
    expect(body.election.form110Reference).toBe("1/10-2025-0042");
    expect(body.activeToday).toBe(true);
    expect(body.vatPeriod.mode).toBe("quarterly");
    expect(body.vatPeriod.windows).toHaveLength(4);
    expect(body.vatPeriod.windows[0].dueDate).toBe("2026-04-30");
    expect(body.vatPeriod.source).not.toBeNull();
  });
});

describe("GET /comparison", () => {
  it("validates its own parameters server-side", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/comparison?periodFrom=not-a-date", "*"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).errors.some((e: { field: string }) => e.field === "periodFrom")).toBe(true);
  });

  it("puts the two regimes side by side and keeps the tax base out of the totals", async () => {
    const { app, salesInvoices } = await newApp();
    await salesInvoices.save(makeInvoice());
    const body = (await (await app.fetch(req("/comparison", "*"))).json()) as any;
    const rows = body.rows as { key: string; simplified: number | null; normal: number | null }[];
    const incomeTax = rows.find((row) => row.key === "incomeTax");
    expect(incomeTax?.simplified).toBe(5000);
    // No posted ledger in this fixture, so the ordinary regime charges nothing
    // on nil profit — the comparison says so rather than guessing a profit.
    expect(incomeTax?.normal).toBe(0);
    expect(body.grandTotals.simplified).toBe(5000);
    expect(rows.some((row) => row.key === "base")).toBe(true);
  });
});
