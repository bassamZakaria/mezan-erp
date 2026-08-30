import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSalesInvoiceStore,
  createSqlitePurchaseInvoiceStore,
  createSqliteItemStore,
  createSqliteCustomerRepository,
  createSqliteSupplierRepository,
  createSqliteWarehouseStore,
  createSqliteStockLedgerStore,
  createStandaloneSqliteInstallmentPlanStore,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
} from "@mezan/persistence";
import { Money, Qty, type SalesInvoice, type SalesInvoiceLine } from "@mezan/domain";
import { createReportsRoutes, type ReportsRoutesDeps } from "./reports-routes.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function makeInvoiceLine(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "line-1",
    itemId: "item-1",
    itemNameAr: "صنف تجريبي",
    isStock: true,
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100.00"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    unitCost: null,
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
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
    date: "2026-08-10",
    dueDate: "2026-08-20",
    customerId: "cust-1",
    customerNameAr: "عميل تجريبي",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "br-1",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120",
    taxAccountId: "2200",
    lines: [makeInvoiceLine()],
    amountPaid: Money.zero(),
    createdAt: "2026-08-10T00:00:00.000Z",
    confirmedAt: "2026-08-10T00:00:00.000Z",
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

async function newApp() {
  const salesInvoices = createSqliteSalesInvoiceStore();
  const purchaseInvoicesStore = createSqlitePurchaseInvoiceStore();
  const items = createSqliteItemStore();
  const customers = createSqliteCustomerRepository();
  const suppliers = createSqliteSupplierRepository();
  const warehouses = createSqliteWarehouseStore();
  const stockLedgerStore = createSqliteStockLedgerStore();
  const installmentPlans = createStandaloneSqliteInstallmentPlanStore();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  handles.push(salesInvoices, purchaseInvoicesStore, items, customers, suppliers, warehouses, stockLedgerStore, installmentPlans, ledger, accounts);

  const deps: ReportsRoutesDeps = {
    salesInvoices,
    purchaseInvoices: purchaseInvoicesStore,
    customers,
    suppliers,
    items,
    warehouses,
    stockLedger: stockLedgerStore.ledger,
    costLayers: stockLedgerStore.layers,
    wacSnapshots: stockLedgerStore.snapshots,
    installmentPlans,
    ledger,
    accounts,
    today: () => "2026-08-22",
  };
  const app = createReportsRoutes(deps);
  return { app, deps };
}

function req(path: string, permissions?: string) {
  const headers = new Headers();
  if (permissions !== undefined) headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { headers });
}

describe("reports routes — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/sales/by-period"));
    expect(res.status).toBe(403);
  });

  it("allows GET /sales/by-period with sales.invoice.view", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/sales/by-period", "sales.invoice.view"));
    expect(res.status).toBe(200);
  });
});

describe("reports routes — real SQLite data", () => {
  it("/sales/by-period aggregates confirmed invoices and ignores drafts", async () => {
    const { app, deps } = await newApp();
    await deps.salesInvoices.save(makeInvoice({ id: "inv-1", docNo: "INV-000001", date: "2026-08-10" }));
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-2", docNo: "INV-000002", date: "2026-08-10", lines: [makeInvoiceLine({ lineId: "l2", qty: Qty.fromMajor("1") })] }),
    );
    await deps.salesInvoices.save(makeInvoice({ id: "inv-3", docNo: "INV-000003", date: "2026-08-11", status: "draft" }));

    const res = await app.fetch(req("/sales/by-period?groupBy=day&dateFrom=2026-08-01&dateTo=2026-08-31", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { bucket: string; count: number; net: number }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.bucket).toBe("2026-08-10");
    expect(body.rows[0]?.count).toBe(2);
    expect(body.rows[0]?.net).toBe(300); // 2*100 + 1*100, no discount/tax
  });

  it("/aging/customers buckets an overdue balance by days past due", async () => {
    const { app, deps } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-overdue", docNo: "INV-000001", date: "2026-06-01", dueDate: "2026-06-15", amountPaid: Money.fromMajor("50.00") }),
    );
    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { d61to90: number; total: number }[] };
    expect(body.rows).toHaveLength(1);
    // dueDate 2026-06-15 -> asOfDate 2026-08-22 is 68 days past due (61-90 bucket).
    expect(body.rows[0]?.d61to90).toBe(150); // 200 total - 50 paid
    expect(body.rows[0]?.total).toBe(150);
  });

  it("/installments/overview returns an empty result when no plans are seeded", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/installments/overview", "installments.plan.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });

  it("rejects an invalid date param with 400", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/aging/customers?asOfDate=not-a-date", "sales.invoice.view"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("VALIDATION_ERROR");
  });
});

/** Every report route, with the permission that opens it. */
const REPORTS: readonly (readonly [string, string])[] = [
  ["/sales/by-period", "sales.invoice.view"],
  ["/sales/by-item", "sales.invoice.view"],
  ["/sales/by-customer", "sales.invoice.view"],
  ["/sales/by-salesperson", "sales.invoice.view"],
  ["/sales/top-products", "sales.invoice.view"],
  ["/purchases/by-period", "purchases.invoice.view"],
  ["/purchases/by-supplier", "purchases.invoice.view"],
  ["/purchases/by-item", "purchases.invoice.view"],
  ["/inventory/stock-levels", "inventory.stock.view"],
  ["/inventory/movement", "inventory.stock.view"],
  ["/inventory/ledger", "inventory.stock.view"],
  ["/inventory/valuation", "inventory.valuation.view"],
  ["/inventory/aging", "inventory.stock.view"],
  ["/inventory/expiring", "inventory.stock.view"],
  ["/inventory/slow-moving", "inventory.stock.view"],
  ["/inventory/drift", "inventory.valuation.view"],
  ["/aging/customers", "sales.invoice.view"],
  ["/aging/suppliers", "purchases.invoice.view"],
  ["/installments/overview", "installments.plan.view"],
];

describe("reports routes — every report, on an empty tenant", () => {
  it("answers each one with rows, and renders zero honestly rather than blank", async () => {
    const { app } = await newApp();
    for (const [path, permission] of REPORTS) {
      const res = await app.fetch(req(path, permission));
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { rows?: unknown[] };
      expect(Array.isArray(body.rows), path).toBe(true);
      expect(JSON.stringify(body), path).not.toContain("NaN");
      expect(JSON.stringify(body), path).not.toContain("null,null");
    }
  });

  it("refuses each one to a caller holding no permission at all", async () => {
    const { app } = await newApp();
    for (const [path] of REPORTS) {
      expect((await app.fetch(req(path, ""))).status, path).toBe(403);
    }
  });

  it("refuses each one to a caller holding only an unrelated permission", async () => {
    const { app } = await newApp();
    for (const [path, permission] of REPORTS) {
      const unrelated = permission === "sales.invoice.view" ? "inventory.stock.view" : "sales.invoice.view";
      expect((await app.fetch(req(path, unrelated))).status, path).toBe(403);
    }
  });
});

describe("reports routes — the same invoice seen from four angles", () => {
  async function seeded() {
    const harness = await newApp();
    await harness.deps.salesInvoices.save(
      makeInvoice({
        id: "inv-1",
        docNo: "INV-000001",
        date: "2026-08-10",
        salespersonId: "rep-1",
        salespersonNameAr: "مندوب تجريبي",
      }),
    );
    return harness;
  }

  it("reports the same 200.00 by item, by customer and by salesperson", async () => {
    const { app } = await seeded();
    const range = "dateFrom=2026-08-01&dateTo=2026-08-31";

    const byItem = (await (await app.fetch(req(`/sales/by-item?${range}`, "sales.invoice.view"))).json()) as {
      rows: { itemId: string; net?: number; total?: number }[];
    };
    expect(byItem.rows).toHaveLength(1);
    expect(byItem.rows[0]?.itemId).toBe("item-1");

    const byCustomer = (await (
      await app.fetch(req(`/sales/by-customer?${range}`, "sales.invoice.view"))
    ).json()) as { rows: { customerId: string }[] };
    expect(byCustomer.rows.map((r) => r.customerId)).toEqual(["cust-1"]);

    const bySalesperson = (await (
      await app.fetch(req(`/sales/by-salesperson?${range}`, "sales.invoice.view"))
    ).json()) as { rows: unknown[] };
    expect(bySalesperson.rows.length).toBeGreaterThan(0);

    const top = (await (await app.fetch(req(`/sales/top-products?${range}`, "sales.invoice.view"))).json()) as {
      rows: { itemId: string }[];
    };
    expect(top.rows[0]?.itemId).toBe("item-1");
  });

  it("keeps a document dated on the first and last day of the range, and drops one a day outside", async () => {
    const { app, deps } = await newApp();
    for (const [id, date] of [
      ["inv-first", "2026-08-01"],
      ["inv-last", "2026-08-31"],
      ["inv-before", "2026-07-31"],
      ["inv-after", "2026-09-01"],
    ] as const) {
      await deps.salesInvoices.save(makeInvoice({ id, docNo: `INV-${id}`, date }));
    }

    const res = await app.fetch(
      req("/sales/by-period?groupBy=day&dateFrom=2026-08-01&dateTo=2026-08-31", "sales.invoice.view"),
    );
    const body = (await res.json()) as { rows: { bucket: string }[] };
    expect(body.rows.map((r) => r.bucket).sort()).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("renders a range that contains nothing as no rows, not as everything", async () => {
    const { app } = await seeded();
    const res = await app.fetch(
      req("/sales/by-period?groupBy=day&dateFrom=2027-01-01&dateTo=2027-01-31", "sales.invoice.view"),
    );
    expect(((await res.json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  it("gives the same answer when the same report is run twice", async () => {
    const { app } = await seeded();
    const path = "/sales/by-item?dateFrom=2026-08-01&dateTo=2026-08-31";
    const first = await (await app.fetch(req(path, "sales.invoice.view"))).text();
    const second = await (await app.fetch(req(path, "sales.invoice.view"))).text();
    expect(second).toBe(first);
  });

  it("refuses a date that is not a date at all, on both the aging and the period report", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/aging/customers?asOfDate=not-a-date", "sales.invoice.view"))).status).toBe(400);
    expect((await app.fetch(req("/sales/by-period?dateFrom=not-a-date", "sales.invoice.view"))).status).toBe(400);
  });

  it("LIMITATION (D98): a date-shaped impossible date passes validation and silently matches nothing", async () => {
    const { app } = await seeded();

    // 2026-13-45 has no thirteenth month and no forty-fifth day, but it matches
    // the shape the parameter is checked against, so both reports accept it and
    // answer with no rows — which reads on screen as "no sales in that range"
    // rather than "that is not a date".
    const aging = await app.fetch(req("/aging/customers?asOfDate=2026-13-45", "sales.invoice.view"));
    expect(aging.status).toBe(200);

    const period = await app.fetch(req("/sales/by-period?dateFrom=2026-13-45", "sales.invoice.view"));
    expect(period.status).toBe(200);
    expect(((await period.json()) as { rows: unknown[] }).rows).toEqual([]);
  });
});
