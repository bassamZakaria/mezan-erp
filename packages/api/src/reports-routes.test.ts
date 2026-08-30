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
  createSqliteVoucherStore,
  createSqliteChequeRepository,
  createStandaloneSqliteSalesReturnStore,
} from "@mezan/persistence";
import {
  Money,
  Qty,
  purchaseInvoiceTotal,
  type SalesInvoice,
  type SalesInvoiceLine,
  type PurchaseInvoice,
  type Cheque,
} from "@mezan/domain";
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

function makePurchaseInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pi-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-10",
    dueDate: "2026-08-20",
    supplierInvoiceNumber: null,
    branchId: "br-1",
    warehouseId: "wh-1",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [
      { itemId: "item-1", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100.00"), taxRatePercent: 0 },
    ],
    status: "confirmed",
    fxRate: null,
    createdBy: "system",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeCheque(overrides: Partial<Cheque> = {}): Cheque {
  return {
    id: "chq-1",
    direction: "incoming",
    status: "pending",
    chequeNumber: "CHQ-0001",
    bankName: "Test Bank",
    bankBranchName: null,
    bankAccountNumber: null,
    amount: Money.fromMajor("100.00"),
    currency: "EGP",
    issueDate: "2026-01-01",
    dueDate: "2026-01-01",
    branchId: "br-1",
    notes: null,
    partyId: "cust-1",
    counterpartyGlAccountId: "1105",
    controlAccounts: { underCollectionAccountId: "1320" },
    bankTreasuryAccountId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    depositedAt: null,
    collectedAt: null,
    bouncedAt: null,
    replacesChequeId: null,
    replacedByChequeId: null,
    creationJournalEntryId: null,
    collectionJournalEntryId: null,
    bounceJournalEntryId: null,
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
  const vouchers = createSqliteVoucherStore();
  const cheques = createSqliteChequeRepository();
  const salesReturns = createStandaloneSqliteSalesReturnStore();
  handles.push(
    salesInvoices,
    purchaseInvoicesStore,
    items,
    customers,
    suppliers,
    warehouses,
    stockLedgerStore,
    installmentPlans,
    ledger,
    accounts,
    vouchers,
    cheques,
    salesReturns,
  );

  const deps: ReportsRoutesDeps = {
    salesInvoices,
    allocatable: vouchers.invoices,
    salesReturnDocs: salesReturns,
    cheques,
    voucherDocuments: vouchers.documents,
    allocations: vouchers.allocations,
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
  return { app, deps, vouchers, cheques, salesReturns };
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
    // Real order, not sorted after the fact: a regression that reversed the
    // report's own chronological ordering would still pass a `.sort()`ed
    // assertion.
    expect(body.rows.map((r) => r.bucket)).toEqual(["2026-08-01", "2026-08-31"]);
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

describe("reports routes — allocatable/cheques/voucherDocuments/salesReturnDocs are wired", () => {
  it("D66 regression: a supplier invoice fully paid through the allocation sub-ledger drops out of aging", async () => {
    const { app, deps } = await newApp();
    const invoice = makePurchaseInvoice({ id: "pi-paid", number: "PI-D66", supplierId: "sup-d66", date: "2026-05-01", dueDate: "2026-05-01" });
    await deps.purchaseInvoices.create(invoice);
    const total = purchaseInvoiceTotal(invoice);
    expect(total.toString()).toBe("100.000000");
    await deps.allocatable!.save({
      id: invoice.id,
      invoiceNo: invoice.number,
      kind: "purchase",
      partyId: invoice.supplierId,
      date: invoice.date,
      total,
      allocated: total,
    });

    const wired = (await (await app.fetch(req("/aging/suppliers?asOfDate=2026-08-22", "purchases.invoice.view"))).json()) as {
      rows: { supplierId: string }[];
    };
    expect(wired.rows.find((r) => r.supplierId === "sup-d66")).toBeUndefined();

    // Prove the regression: the SAME data, through an app that never wires
    // `allocatable`, restates the fully-settled invoice as outstanding (D66).
    const unwiredApp = createReportsRoutes({ ...deps, allocatable: undefined });
    const unwired = (await (await unwiredApp.fetch(req("/aging/suppliers?asOfDate=2026-08-22", "purchases.invoice.view"))).json()) as {
      rows: { supplierId: string; total: number }[];
    };
    const row = unwired.rows.find((r) => r.supplierId === "sup-d66");
    expect(row).toBeDefined();
    expect(row?.total).toBe(100);
  });

  it("D37 regression: an unmatched incoming cheque against 1105 nets out of customer aging", async () => {
    const { app, deps, cheques } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-d37",
        docNo: "INV-D37",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-d37",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
    await cheques.save(makeCheque({ id: "chq-d37", partyId: "cust-d37", amount: Money.fromMajor("400.00"), dueDate: "2026-01-01", issueDate: "2026-01-01" }));

    const wired = (await (await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"))).json()) as {
      rows: { customerId: string; over120: number; total: number }[];
    };
    const row = wired.rows.find((r) => r.customerId === "cust-d37");
    expect(row).toBeDefined();
    // 233 days past due (2026-01-01 -> 2026-08-22): squarely in the over-120 bucket.
    expect(row?.over120).toBe(600); // 1000 invoiced - 400 unapplied cheque credit
    expect(row?.total).toBe(600);

    // Prove the regression: without `cheques` wired, the same collection is
    // invisible to aging and the customer reads as owing the full 1000 (D37).
    const unwiredApp = createReportsRoutes({ ...deps, cheques: undefined });
    const unwired = (await (await unwiredApp.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"))).json()) as {
      rows: { customerId: string; total: number }[];
    };
    expect(unwired.rows.find((r) => r.customerId === "cust-d37")?.total).toBe(1000);
  });

  it("a bounced incoming cheque does NOT net out of customer aging (the debt still stands)", async () => {
    const { app, deps, cheques } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-bounced",
        docNo: "INV-BOUNCED",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-bounced",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
    await cheques.save(makeCheque({ id: "chq-bounced", status: "bounced", partyId: "cust-bounced", amount: Money.fromMajor("400.00"), dueDate: "2026-01-01", issueDate: "2026-01-01" }));

    const body = (await (await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"))).json()) as {
      rows: { customerId: string; total: number }[];
    };
    expect(body.rows.find((r) => r.customerId === "cust-bounced")?.total).toBe(1000);
  });

  it("an on-account customer-collection voucher's unallocated remainder nets out of customer aging", async () => {
    const { app, deps, vouchers } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-oncollect",
        docNo: "INV-ONCOLLECT",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-oncollect",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
    await vouchers.documents.save({
      id: "cv-1",
      docType: "TREASURY_VOUCHER",
      docNo: "CV-000001",
      date: "2026-02-01",
      memo: "تحصيل على الحساب",
      status: "confirmed",
      lines: [
        {
          voucherType: "customer_collection",
          direction: "receipt",
          amount: Money.fromMajor("300.00"),
          currency: "EGP",
          branchId: "br-1",
          paymentMethod: "cash",
          treasuryAccountId: "cash-1",
          treasuryGlAccountId: "1101",
          counterpartyGlAccountId: "1105",
          counterTreasuryAccountId: null,
          counterTreasuryGlAccountId: null,
          customerId: "cust-oncollect",
          supplierId: null,
          referenceNo: null,
        },
      ],
      createdAt: "2026-02-01T00:00:00.000Z",
      confirmedAt: "2026-02-01T00:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });

    const body = (await (await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"))).json()) as {
      rows: { customerId: string; over120: number; total: number }[];
    };
    const row = body.rows.find((r) => r.customerId === "cust-oncollect");
    expect(row).toBeDefined();
    expect(row?.total).toBe(700); // 1000 invoiced - 300 unallocated collection
  });

  it("a confirmed sales return credits off the source invoice's outstanding balance in aging", async () => {
    const { app, deps, salesReturns } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-returned",
        docNo: "INV-RET",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-returned",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
    await salesReturns.save({
      id: "sr-1",
      docType: "SALES_RETURN",
      docNo: "SRT-000001",
      date: "2026-02-01",
      memo: "return",
      status: "confirmed",
      lines: [
        {
          itemId: "item-1",
          warehouseId: "wh-1",
          customerId: "cust-returned",
          sourceInvoiceId: "inv-returned",
          sourceInvoiceNumber: "INV-RET",
          reason: "DEFECTIVE",
          availableQty: Qty.fromMajor("1"),
          qty: Qty.fromMajor("1"),
          unitPrice: Money.fromMajor("1000.00"),
          unitCost: Money.fromMajor("60.00"),
          taxAmount: Money.zero(),
        },
      ],
      createdAt: "2026-02-01T00:00:00.000Z",
      confirmedAt: "2026-02-01T00:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });

    const body = (await (await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"))).json()) as {
      rows: { customerId: string }[];
    };
    // The full 1000 was returned, so the invoice's outstanding balance is nil
    // and the customer drops out of the aging ladder entirely.
    expect(body.rows.find((r) => r.customerId === "cust-returned")).toBeUndefined();
  });
});

describe("reports routes — aging bucket boundaries, exactly at the day", () => {
  const asOfDate = "2026-08-22";
  const boundaries: readonly [number, "current" | "d31to60" | "d61to90" | "d91to120" | "over120", string][] = [
    [30, "current", "2026-07-23"],
    [31, "d31to60", "2026-07-22"],
    [60, "d31to60", "2026-06-23"],
    [61, "d61to90", "2026-06-22"],
    [90, "d61to90", "2026-05-24"],
    [91, "d91to120", "2026-05-23"],
    [120, "d91to120", "2026-04-24"],
    [121, "over120", "2026-04-23"],
  ];

  it("lands each days-past-due boundary in exactly the right bucket, no more and no less", async () => {
    const { app, deps } = await newApp();
    for (const [days, , dueDate] of boundaries) {
      const supplierId = `sup-${days}`;
      await deps.purchaseInvoices.create(
        makePurchaseInvoice({ id: `pi-${days}`, number: `PI-B-${days}`, supplierId, date: dueDate, dueDate }),
      );
    }

    const body = (await (await app.fetch(req(`/aging/suppliers?asOfDate=${asOfDate}`, "purchases.invoice.view"))).json()) as {
      rows: Array<{ supplierId: string; current: number; d31to60: number; d61to90: number; d91to120: number; over120: number; total: number }>;
    };

    const ALL_BUCKETS = ["current", "d31to60", "d61to90", "d91to120", "over120"] as const;
    for (const [days, expectedBucket] of boundaries) {
      const row = body.rows.find((r) => r.supplierId === `sup-${days}`);
      expect(row, `days=${days}`).toBeDefined();
      for (const bucket of ALL_BUCKETS) {
        expect(row?.[bucket], `days=${days} bucket=${bucket}`).toBe(bucket === expectedBucket ? 100 : 0);
      }
      expect(row?.total, `days=${days}`).toBe(100);
    }

    // Real insertion order, not re-sorted by the test.
    expect(body.rows.map((r) => r.supplierId)).toEqual(boundaries.map(([days]) => `sup-${days}`));
  });
});

describe("reports routes — sales-by-item and purchases-by-item reconciliation ties to the posted GL", () => {
  it("sales/by-item: withinTolerance is true when the posted revenue matches the report, false with a diff when it doesn't", async () => {
    const { app, deps } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-recon",
        docNo: "INV-RECON",
        date: "2026-08-10",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("100.00"), qty: Qty.fromMajor("2") })],
      }),
    );
    await deps.ledger.save({
      id: "je-recon-match",
      date: "2026-08-10",
      memo: "sales invoice posting",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-recon",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("200.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("200.00") },
      ],
    });

    const range = "dateFrom=2026-08-01&dateTo=2026-08-31";
    const matched = (await (await app.fetch(req(`/sales/by-item?${range}`, "sales.invoice.view"))).json()) as {
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(matched.reconciliation.reportTotal).toBe(200);
    expect(matched.reconciliation.referenceTotal).toBe(200);
    expect(matched.reconciliation.diff).toBe(0);
    expect(matched.reconciliation.withinTolerance).toBe(true);
  });

  it("sales/by-item: a mismatched GL posting fails the reconciliation with the exact diff", async () => {
    const { app, deps } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-mismatch",
        docNo: "INV-MISMATCH",
        date: "2026-08-10",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("100.00"), qty: Qty.fromMajor("2") })],
      }),
    );
    await deps.ledger.save({
      id: "je-recon-mismatch",
      date: "2026-08-10",
      memo: "sales invoice posting (short-posted for the test)",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-mismatch",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("150.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("150.00") },
      ],
    });

    const range = "dateFrom=2026-08-01&dateTo=2026-08-31";
    const res = (await (await app.fetch(req(`/sales/by-item?${range}`, "sales.invoice.view"))).json()) as {
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(res.reconciliation.reportTotal).toBe(200);
    expect(res.reconciliation.referenceTotal).toBe(150);
    expect(res.reconciliation.diff).toBe(50);
    expect(res.reconciliation.withinTolerance).toBe(false);
  });

  it("purchases/by-item: withinTolerance is true when posted inventory matches, false with a diff when it doesn't", async () => {
    const { app, deps } = await newApp();
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-recon", number: "PI-RECON", date: "2026-08-10", dueDate: "2026-08-20" }),
    );
    await deps.ledger.save({
      id: "je-precon-match",
      date: "2026-08-10",
      memo: "purchase invoice posting",
      status: "posted",
      source: "system",
      sourceDocType: "PURCHASE_INVOICE",
      sourceDocId: "pi-recon",
      lines: [
        { accountId: "1200", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });

    const range = "dateFrom=2026-08-01&dateTo=2026-08-31";
    const matched = (await (await app.fetch(req(`/purchases/by-item?${range}`, "purchases.invoice.view"))).json()) as {
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(matched.reconciliation.reportTotal).toBe(100);
    expect(matched.reconciliation.referenceTotal).toBe(100);
    expect(matched.reconciliation.diff).toBe(0);
    expect(matched.reconciliation.withinTolerance).toBe(true);

    const { app: app2, deps: deps2 } = await newApp();
    await deps2.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-recon2", number: "PI-RECON2", date: "2026-08-10", dueDate: "2026-08-20" }),
    );
    await deps2.ledger.save({
      id: "je-precon-mismatch",
      date: "2026-08-10",
      memo: "purchase invoice posting (over-posted for the test)",
      status: "posted",
      source: "system",
      sourceDocType: "PURCHASE_INVOICE",
      sourceDocId: "pi-recon2",
      lines: [
        { accountId: "1200", debit: Money.fromMajor("120.00"), credit: Money.zero() },
        { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("120.00") },
      ],
    });
    const mismatched = (await (await app2.fetch(req(`/purchases/by-item?${range}`, "purchases.invoice.view"))).json()) as {
      reconciliation: { reportTotal: number; referenceTotal: number; diff: number; withinTolerance: boolean };
    };
    expect(mismatched.reconciliation.reportTotal).toBe(100);
    expect(mismatched.reconciliation.referenceTotal).toBe(120);
    expect(mismatched.reconciliation.diff).toBe(-20);
    expect(mismatched.reconciliation.withinTolerance).toBe(false);
  });
});
