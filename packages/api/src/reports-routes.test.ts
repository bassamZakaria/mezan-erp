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
  createSqliteVanTripRepository,
} from "@mezan/persistence";
import {
  Money,
  Qty,
  purchaseInvoiceTotal,
  type SalesInvoice,
  type SalesInvoiceLine,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type Cheque,
  type Item,
  type Bom,
  type BomLine,
  type BomRepository,
  type Customer,
  type Supplier,
  type VanTrip,
  type InstallmentPlanDocument,
  type InstallmentLine,
  type VoucherLine,
  type FrameworkDocument,
  StockLedgerService,
} from "@mezan/domain";
import { createReportsRoutes, type ReportsRoutesDeps } from "./reports-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
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
  const app = createReportsRoutes(deps, insecureHeaderAuthContextResolver);
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
    const unwiredApp = createReportsRoutes({ ...deps, allocatable: undefined }, insecureHeaderAuthContextResolver);
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
    const unwiredApp = createReportsRoutes({ ...deps, cheques: undefined }, insecureHeaderAuthContextResolver);
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

describe("reports routes — D112: the aging reports tie to the AR/AP control account", () => {
  it("aging/customers' grand total EQUALS the AR (1105) control account balance, after a return and an unapplied cheque", async () => {
    const { app, deps, salesReturns, cheques } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-tie",
        docNo: "INV-TIE",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-tie",
        arAccountId: "1105",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
    await deps.ledger.save({
      id: "je-tie-invoice",
      date: "2026-01-01",
      memo: "invoice",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-tie",
      lines: [
        { accountId: "1105", debit: Money.fromMajor("1000.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("1000.00") },
      ],
    });

    await salesReturns.save({
      id: "sr-tie",
      docType: "SALES_RETURN",
      docNo: "SRT-TIE",
      date: "2026-02-01",
      memo: "return",
      status: "confirmed",
      lines: [
        {
          itemId: "item-1",
          warehouseId: "wh-1",
          customerId: "cust-tie",
          sourceInvoiceId: "inv-tie",
          sourceInvoiceNumber: "INV-TIE",
          reason: "DEFECTIVE",
          availableQty: Qty.fromMajor("1"),
          qty: Qty.fromMajor("1"),
          unitPrice: Money.fromMajor("300.00"),
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
    await deps.ledger.save({
      id: "je-tie-return",
      date: "2026-02-01",
      memo: "return",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_RETURN",
      sourceDocId: "sr-tie",
      lines: [
        { accountId: "4150", debit: Money.fromMajor("300.00"), credit: Money.zero() },
        { accountId: "1105", debit: Money.zero(), credit: Money.fromMajor("300.00") },
      ],
    });

    await cheques.save(
      makeCheque({ id: "chq-tie", partyId: "cust-tie", amount: Money.fromMajor("100.00"), dueDate: "2026-03-01", issueDate: "2026-03-01" }),
    );
    await deps.ledger.save({
      id: "je-tie-cheque",
      date: "2026-03-01",
      memo: "incoming cheque",
      status: "posted",
      source: "system",
      sourceDocType: "CHEQUE_RECEIPT",
      sourceDocId: "chq-tie",
      lines: [
        { accountId: "1320", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "1105", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });

    const asOfDate = "2026-08-22";
    const body = (await (await app.fetch(req(`/aging/customers?asOfDate=${asOfDate}`, "sales.invoice.view"))).json()) as {
      rows: { customerId: string; total: number }[];
    };
    const row = body.rows.find((r) => r.customerId === "cust-tie");
    expect(row).toBeDefined();

    // The report's own figure...
    const reportTotal = row!.total;
    // ...independently recomputed from the ledger's own AR control account:
    // 1000 invoiced, less 300 returned, less 100 collected via the cheque.
    const controlBalance = await deps.ledger.accountBalance("1105", asOfDate);
    expect(Number(controlBalance.balance.toString())).toBe(700 - 100);
    expect(reportTotal).toBe(600);
    expect(reportTotal).not.toBe(0);
    expect(reportTotal).toBe(Number(controlBalance.balance.toString()));
  });

  it("aging/suppliers' grand total EQUALS the AP (2100) control account balance", async () => {
    const { app, deps } = await newApp();
    const invoice = makePurchaseInvoice({ id: "pi-tie", number: "PI-TIE", supplierId: "sup-tie", date: "2026-01-01", dueDate: "2026-01-01" });
    await deps.purchaseInvoices.create(invoice);
    const total = purchaseInvoiceTotal(invoice);
    expect(total.toString()).toBe("100.000000");
    await deps.ledger.save({
      id: "je-tie-purchase",
      date: "2026-01-01",
      memo: "purchase invoice",
      status: "posted",
      source: "system",
      sourceDocType: "PURCHASE_INVOICE",
      sourceDocId: "pi-tie",
      lines: [
        { accountId: "1200", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });

    const asOfDate = "2026-08-22";
    const body = (await (await app.fetch(req(`/aging/suppliers?asOfDate=${asOfDate}`, "purchases.invoice.view"))).json()) as {
      rows: { supplierId: string; total: number }[];
    };
    const row = body.rows.find((r) => r.supplierId === "sup-tie");
    expect(row).toBeDefined();
    const controlBalance = await deps.ledger.accountBalance("2100", asOfDate);
    // 2100 is a liability/control account: credit − debit is what is owed.
    const owed = -Number(controlBalance.balance.toString());
    expect(owed).toBe(100);
    expect(owed).not.toBe(0);
    expect(row!.total).toBe(owed);
  });
});

describe("reports routes — D111: branch scope is NOT applied to any non-inventory report (pinned LIMITATION)", () => {
  it("LIMITATION (D111): a caller scoped to one branch still sees every branch's invoices in /sales/by-period", async () => {
    const { app, deps } = await newApp();
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-br1", docNo: "INV-BR1", date: "2026-08-10", branchId: "br-1", customerId: "cust-br1" }),
    );
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-br2", docNo: "INV-BR2", date: "2026-08-10", branchId: "br-2", customerId: "cust-br2" }),
    );

    const scoped = await app.fetch(
      new Request("http://local/sales/by-period?dateFrom=2026-08-01&dateTo=2026-08-31", {
        headers: { "x-permissions": "sales.invoice.view", "x-branch-scope": "br-1" },
      }),
    );
    const body = (await scoped.json()) as { kpis: { key: string; value: number }[] };
    const revenueKpi = body.kpis.find((k) => k.key === "net");
    // No branch narrowing exists on this route at all: a br-1-scoped caller's
    // KPI still reflects BOTH invoices' revenue, not just br-1's.
    expect(revenueKpi).toBeDefined();
    expect(revenueKpi!.value).toBeGreaterThan(0);

    const rows = (await (
      await app.fetch(req("/sales/by-customer?dateFrom=2026-08-01&dateTo=2026-08-31", "sales.invoice.view"))
    ).json()) as { rows: { customerId: string }[] };
    const scopedRows = await app.fetch(
      new Request("http://local/sales/by-customer?dateFrom=2026-08-01&dateTo=2026-08-31", {
        headers: { "x-permissions": "sales.invoice.view", "x-branch-scope": "br-1" },
      }),
    );
    const scopedBody = (await scopedRows.json()) as { rows: { customerId: string }[] };
    // Both customers appear even though the request was scoped to br-1 only —
    // the same rows an unscoped caller gets.
    expect(scopedBody.rows.map((r) => r.customerId).sort()).toEqual(rows.rows.map((r) => r.customerId).sort());
    expect(scopedBody.rows.some((r) => r.customerId === "cust-br2")).toBe(true);
  });
});

function fakeBomRepository(list: readonly Bom[]): BomRepository {
  return {
    async findById(id) {
      return list.find((b) => b.id === id) ?? null;
    },
    async list() {
      return [...list];
    },
    async listByProduct(productItemId) {
      return list.filter((b) => b.productItemId === productItemId);
    },
    async create() {
      throw new Error("not implemented in this fake");
    },
    async update() {
      throw new Error("not implemented in this fake");
    },
  };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "fin-1",
    code: "SHIRT-1",
    nameAr: "قميص",
    nameEn: null,
    type: "finished_good",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    description: null,
    defaultSupplierId: null,
    seasonId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  } as Item;
}

function makeBomLine(overrides: Partial<BomLine> = {}): BomLine {
  return { itemId: "raw-1", qty: Qty.fromMajor("5"), wastePercent: 0, optional: false, notes: null, ...overrides };
}

function makeBom(overrides: Partial<Bom> = {}): Bom {
  return {
    id: "bom-1",
    number: "BOM-000001",
    productItemId: "fin-1",
    version: 1,
    standardQty: Qty.fromMajor("10"),
    unit: "PCS",
    laborCost: Money.fromMajor("0.00"),
    overheadCost: Money.fromMajor("0.00"),
    versionNotes: null,
    lines: [makeBomLine()],
    status: "active",
    custom: false,
    createdBy: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePurchaseInvoiceLine(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { itemId: "raw-1", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10.00"), taxRatePercent: 0, ...overrides };
}

describe("reports routes — manufacturing/make-vs-buy", () => {
  it("computes make cost from the BOM and buy cost from confirmed purchases, and picks the cheaper side", async () => {
    const { deps } = await newApp();
    await deps.items.create(makeItem());
    await deps.items.create(makeItem({ id: "raw-1", code: "RAW-1", nameAr: "قماش خام", type: "raw_material" }));
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-raw", number: "PI-RAW", lines: [makePurchaseInvoiceLine({ qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00") })] }),
    );
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-fin", number: "PI-FIN", lines: [makePurchaseInvoiceLine({ itemId: "fin-1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("3.00") })] }),
    );

    const app = createReportsRoutes({ ...deps, boms: fakeBomRepository([makeBom()]) }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/manufacturing/make-vs-buy", "manufacturing.bom.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { itemId: string; makeCost: number; buyCost: number; diff: number; verdict: string }[] };
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    // material = 5 × 20.00 = 100.00; make cost = 100.00 / standardQty(10) = 10.00
    expect(row.makeCost).toBe(10.0);
    expect(row.buyCost).toBe(3.0);
    expect(row.diff).toBe(-7.0);
    expect(row.verdict).toBe("buy");
  });

  it("is not mounted at all when no boms port is wired", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/manufacturing/make-vs-buy", "manufacturing.bom.view"));
    expect(res.status).toBe(404);
  });
});

describe("reports routes — field/van-sales", () => {
  function makeVanTrip(overrides: Partial<VanTrip> = {}): VanTrip {
    return {
      id: "trip-1",
      tripNo: "VT-000001",
      date: "2026-08-10",
      branchId: "br-1",
      vanId: null,
      vanWarehouseId: "wh-van",
      vanTreasuryAccountId: "tr-van",
      sourceWarehouseId: "wh-1",
      sourceTreasuryAccountId: "tr-main",
      openingCashFloat: Money.fromMajor("200.00"),
      crew: [],
      loadedStock: [{ itemId: "item-1", qty: Qty.fromMajor("50") }],
      cashMovements: [{ id: "cm-1", kind: "sale", amount: Money.fromMajor("300.00"), occurredAt: "2026-08-10T10:00:00.000Z", notes: null }],
      status: "settled",
      openedAt: "2026-08-10T08:00:00.000Z",
      settledAt: "2026-08-10T18:00:00.000Z",
      settlement: {
        expectedCash: Money.fromMajor("500.00"),
        countedCash: Money.fromMajor("500.00"),
        cashVariance: Money.zero(),
        stockCounts: [{ itemId: "item-1", expectedQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("10"), varianceQty: Qty.zero() }],
        settledAt: "2026-08-10T18:00:00.000Z",
      },
      notes: null,
      ...overrides,
    };
  }

  async function newVanApp() {
    const vanTrips = createSqliteVanTripRepository();
    handles.push(vanTrips);
    const { deps } = await newApp();
    return { app: createReportsRoutes({ ...deps, vanTrips }, insecureHeaderAuthContextResolver), vanTrips };
  }

  it("summarizes a settled trip's loaded/returned/dispatched qty and cash reconciliation exactly", async () => {
    const { app, vanTrips } = await newVanApp();
    await vanTrips.create(makeVanTrip());

    const res = await app.fetch(req("/field/van-sales?dateFrom=2026-08-01&dateTo=2026-08-31&status=all", "field.van_trip.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { tripId: string; loadedQty: number; returnedQty: number; dispatchedQty: number; salesCash: number; collectionsCash: number; countedCash: number; cashVariance: number }[];
    };
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    expect(row.loadedQty).toBe(50);
    expect(row.returnedQty).toBe(10);
    expect(row.dispatchedQty).toBe(40);
    expect(row.salesCash).toBe(300);
    expect(row.collectionsCash).toBe(0);
    expect(row.countedCash).toBe(500);
    expect(row.cashVariance).toBe(0);
  });

  it("is not mounted at all when no vanTrips port is wired", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/field/van-sales", "field.van_trip.view"));
    expect(res.status).toBe(404);
  });
});

describe("reports routes — tax/withholding", () => {
  it("reports gross/rate/withheld/net exactly for a confirmed voucher with a nonzero withholding, and excludes one with none", async () => {
    const { deps, vouchers } = await newApp();
    await deps.suppliers.save(makeSupplier({ id: "sup-wh", code: "SUP-WH", nameAr: "مورد الخصم" }));
    const withheldDoc: FrameworkDocument<VoucherLine> = {
      id: "v-wh-1",
      docType: "VOUCHER",
      docNo: "PAY-000001",
      date: "2026-05-15",
      memo: "supplier payment",
      status: "confirmed",
      lines: [
        {
          voucherType: "supplier_payment",
          direction: "payment",
          amount: Money.fromMajor("1000.00"),
          currency: "EGP",
          branchId: "br-1",
          paymentMethod: "bank",
          treasuryAccountId: "tr-1",
          treasuryGlAccountId: "1010",
          counterpartyGlAccountId: "2100",
          counterTreasuryAccountId: null,
          counterTreasuryGlAccountId: null,
          customerId: null,
          supplierId: "sup-wh",
          referenceNo: null,
          withholdingAmount: Money.fromMajor("50.00"),
          withholdingRatePercent: 5,
        },
      ],
      createdAt: "2026-05-15T00:00:00.000Z",
      confirmedAt: "2026-05-15T00:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    };
    const noWithholdingDoc: FrameworkDocument<VoucherLine> = {
      ...withheldDoc,
      id: "v-nowh",
      docNo: "PAY-000002",
      lines: [{ ...withheldDoc.lines[0]!, withholdingAmount: Money.zero(), withholdingRatePercent: 0 }],
    };
    await vouchers.documents.save(withheldDoc);
    await vouchers.documents.save(noWithholdingDoc);

    const res = await app_fetch(deps, "/tax/withholding?fromDate=2026-01-01&toDate=2026-12-31", "accounting.reports.view");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { voucherId: string; partyNameAr: string; grossAmount: number; ratePercent: number; withheldAmount: number; netPaidAmount: number }[];
    };
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    expect(row.voucherId).toBe("v-wh-1");
    expect(row.partyNameAr).toBe("مورد الخصم");
    expect(row.grossAmount).toBe(1000);
    expect(row.ratePercent).toBe(5);
    expect(row.withheldAmount).toBe(50);
    expect(row.netPaidAmount).toBe(950);
  });

  it("date range is inclusive at both boundaries", async () => {
    const { deps, vouchers } = await newApp();
    const doc = (offset: string, id: string): FrameworkDocument<VoucherLine> => ({
      id,
      docType: "VOUCHER",
      docNo: id,
      date: offset,
      memo: "",
      status: "confirmed",
      lines: [
        {
          voucherType: "supplier_payment",
          direction: "payment",
          amount: Money.fromMajor("100.00"),
          currency: "EGP",
          branchId: "br-1",
          paymentMethod: "cash",
          treasuryAccountId: "tr-1",
          treasuryGlAccountId: "1010",
          counterpartyGlAccountId: "2100",
          counterTreasuryAccountId: null,
          counterTreasuryGlAccountId: null,
          customerId: null,
          supplierId: null,
          referenceNo: null,
          withholdingAmount: Money.fromMajor("10.00"),
          withholdingRatePercent: 10,
        },
      ],
      createdAt: `${offset}T00:00:00.000Z`,
      confirmedAt: `${offset}T00:00:00.000Z`,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    await vouchers.documents.save(doc("2026-08-01", "v-first"));
    await vouchers.documents.save(doc("2026-08-31", "v-last"));
    await vouchers.documents.save(doc("2026-07-31", "v-before"));
    await vouchers.documents.save(doc("2026-09-01", "v-after"));

    const res = await app_fetch(deps, "/tax/withholding?fromDate=2026-08-01&toDate=2026-08-31", "accounting.reports.view");
    const body = (await res.json()) as { rows: { voucherId: string }[] };
    expect(body.rows.map((r) => r.voucherId).sort()).toEqual(["v-first", "v-last"]);
  });
});

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup-1",
    code: "SUP-1",
    nameAr: "مورد",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: Money.zero(),
    active: true,
    addressCity: null,
    addressDistrict: null,
    addressStreet: null,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    code: "CUST-1",
    nameAr: "عميل",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: Money.zero(),
    active: true,
    priceListId: null,
    creditLimit: Money.zero(),
    taxExempt: false,
    etaBuyerType: "B2B",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    ...overrides,
  } as Customer;
}

function app_fetch(deps: ReportsRoutesDeps, path: string, permission: string) {
  return createReportsRoutes(deps, insecureHeaderAuthContextResolver).fetch(req(path, permission));
}

describe("reports routes — installments/overdue", () => {
  function makePlan(overrides: Partial<InstallmentPlanDocument> = {}, lineOverrides: Partial<InstallmentLine> = {}): InstallmentPlanDocument {
    const id = overrides.id ?? "plan-1";
    return {
      id,
      docType: "INSTALLMENT_PLAN",
      docNo: `IPL-${id}`,
      date: "2026-01-01",
      memo: "",
      status: "confirmed",
      lines: [
        {
          no: 1,
          customerId: "cust-inst",
          sourceInvoiceId: "inv-inst",
          sourceInvoiceNumber: "INV-INST",
          frequency: "MONTHLY",
          downPayment: Money.zero(),
          dueDate: "2026-06-01",
          amount: Money.fromMajor("500.00"),
          paidAmount: Money.zero(),
          status: "pending",
          lateFeeAmount: Money.zero(),
          ...lineOverrides,
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: "2026-01-01T00:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
      ...overrides,
    };
  }

  it("ranks by days-late descending and computes the exact remaining amount", async () => {
    const { app, deps } = await newApp();
    await deps.installmentPlans.save(
      makePlan({ id: "plan-old" }, { dueDate: "2026-01-01", amount: Money.fromMajor("500.00"), paidAmount: Money.fromMajor("200.00") }),
    );
    await deps.installmentPlans.save(
      makePlan({ id: "plan-recent" }, { dueDate: "2026-08-01", amount: Money.fromMajor("300.00"), paidAmount: Money.zero() }),
    );
    // Not overdue: due date is after asOfDate.
    await deps.installmentPlans.save(
      makePlan({ id: "plan-future" }, { dueDate: "2026-09-01", amount: Money.fromMajor("100.00") }),
    );
    // Overdue by date but already paid — must not appear.
    await deps.installmentPlans.save(
      makePlan({ id: "plan-paid" }, { dueDate: "2026-01-01", amount: Money.fromMajor("100.00"), status: "paid" }),
    );

    const res = await app.fetch(req("/installments/overdue?asOfDate=2026-08-22", "installments.plan.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { planNo: string; amount: number; remaining: number; daysLate: number; rank: number }[] };
    expect(body.rows).toHaveLength(2);
    // Oldest due date is ranked first (largest days-late).
    expect(body.rows[0]?.planNo).toBe("IPL-plan-old");
    expect(body.rows[0]?.remaining).toBe(300); // 500 - 200 paid
    expect(body.rows[0]?.rank).toBe(1);
    expect(body.rows[1]?.remaining).toBe(300); // 300 - 0 paid
    expect(body.rows[1]?.rank).toBe(2);
    expect(body.rows[0]!.daysLate).toBeGreaterThan(body.rows[1]!.daysLate);
  });

  it("date boundary: a line due exactly on asOfDate is NOT yet overdue, one day earlier IS", async () => {
    const { app, deps } = await newApp();
    await deps.installmentPlans.save(makePlan({ id: "plan-on-date" }, { dueDate: "2026-08-22" }));
    await deps.installmentPlans.save(makePlan({ id: "plan-day-before" }, { dueDate: "2026-08-21" }));

    const res = await app.fetch(req("/installments/overdue?asOfDate=2026-08-22", "installments.plan.view"));
    const body = (await res.json()) as { rows: { planNo: string }[] };
    expect(body.rows.map((r) => r.planNo)).toEqual(["IPL-plan-day-before"]);
  });
});

describe("reports routes — drill-down/customer/:id", () => {
  it("404s an unknown customer", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/drill-down/customer/nope", "sales.customer.view"));
    expect(res.status).toBe(404);
  });

  it("returns exact billed/outstanding totals and a capped, sorted document list for a known customer", async () => {
    const { app, deps } = await newApp();
    await deps.customers.save(makeCustomer({ id: "cust-dd", code: "CUST-DD", nameAr: "عميل التفاصيل", creditLimit: Money.fromMajor("5000.00") }));
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-dd-1", docNo: "INV-DD-1", date: "2026-08-01", customerId: "cust-dd", amountPaid: Money.fromMajor("50.00"), lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("200.00"), qty: Qty.fromMajor("1") })] }),
    );
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-dd-2", docNo: "INV-DD-2", date: "2026-08-05", customerId: "cust-dd", amountPaid: Money.fromMajor("100.00"), lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("100.00"), qty: Qty.fromMajor("1") })] }),
    );
    // A draft invoice must not count — it never left the customer owing anything real.
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-dd-draft", docNo: "INV-DD-DRAFT", date: "2026-08-06", status: "draft", customerId: "cust-dd", lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("9999.00"), qty: Qty.fromMajor("1") })] }),
    );

    const res = await app.fetch(req("/drill-down/customer/cust-dd", "sales.customer.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      titleAr: string;
      facts: { key: string; value: string }[];
      documents: { id: string; amount: number }[];
      documentCount: number;
    };
    expect(body.titleAr).toBe("عميل التفاصيل");
    const billed = body.facts.find((f) => f.key === "billed");
    const outstanding = body.facts.find((f) => f.key === "outstanding");
    // billed: 200 + 100 = 300 (draft excluded)
    expect(billed?.value).toBe("300.00");
    // outstanding: (200-50) + (100-100) = 150
    expect(outstanding?.value).toBe("150.00");
    expect(body.documentCount).toBe(2);
    // Newest first.
    expect(body.documents.map((d) => d.id)).toEqual(["inv-dd-2", "inv-dd-1"]);
  });
});

describe("reports routes — drill-down/supplier/:id", () => {
  it("404s an unknown supplier", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/drill-down/supplier/nope", "purchases.supplier.view"));
    expect(res.status).toBe(404);
  });

  it("returns exact billed total and invoice count for a known supplier, excluding a non-confirmed invoice", async () => {
    const { app, deps } = await newApp();
    await deps.suppliers.save(makeSupplier({ id: "sup-dd", code: "SUP-DD", nameAr: "مورد التفاصيل" }));
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-dd-1", number: "PI-DD-1", supplierId: "sup-dd", date: "2026-08-01" }),
    );
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-dd-2", number: "PI-DD-2", supplierId: "sup-dd", date: "2026-08-05" }),
    );
    await deps.purchaseInvoices.create(
      makePurchaseInvoice({ id: "pi-dd-draft", number: "PI-DD-DRAFT", supplierId: "sup-dd", date: "2026-08-06", status: "draft" }),
    );

    const res = await app.fetch(req("/drill-down/supplier/sup-dd", "purchases.supplier.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { titleAr: string; facts: { key: string; value: string }[]; documentCount: number };
    expect(body.titleAr).toBe("مورد التفاصيل");
    // 2 confirmed invoices at 100.00 each = 200.00; the draft is excluded.
    expect(body.facts.find((f) => f.key === "billed")?.value).toBe("200.00");
    expect(body.documentCount).toBe(2);
  });
});

describe("reports routes — drill-down/item/:id", () => {
  it("404s an unknown item", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/drill-down/item/nope", "inventory.item.view"));
    expect(res.status).toBe(404);
  });

  it("returns exact on-hand/value from snapshots and a movement history for a known item", async () => {
    const { app, deps } = await newApp();
    await deps.items.create(makeItem({ id: "item-dd", code: "ITEM-DD", nameAr: "صنف التفاصيل", baseUnitCode: "PCS" }));
    const stockService = new StockLedgerService({
      ledger: deps.stockLedger,
      layers: deps.costLayers,
      snapshots: deps.wacSnapshots,
      policy: { allowNegativeStock: false },
      transaction: async (fn) => fn(),
    });
    await stockService.recordOpeningBalance({
      adjustmentId: "adj-dd",
      warehouseId: "wh-1",
      lines: [{ itemId: "item-dd", qty: Qty.fromMajor("40"), unitCost: Money.fromMajor("25.00") }],
    });

    const res = await app.fetch(req("/drill-down/item/item-dd", "inventory.item.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      titleAr: string;
      facts: { key: string; value: string }[];
      documents: { id: string; amount: number }[];
      documentCount: number;
    };
    expect(body.titleAr).toBe("صنف التفاصيل");
    expect(body.facts.find((f) => f.key === "onHand")?.value).toBe("40");
    expect(body.facts.find((f) => f.key === "value")?.value).toBe("1000.00");
    expect(body.documentCount).toBe(1);
  });
});

describe("reports routes — drill-down/account/:id", () => {
  it("404s an unknown account", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/drill-down/account/nope", "accounting.reports.view"));
    expect(res.status).toBe(404);
  });

  it("returns exact debit/credit/balance, including a REVERSED entry alongside its reversal", async () => {
    const { app, deps } = await newApp();
    await deps.accounts.create({
      id: "acct-dd",
      code: "1105",
      nameAr: "حساب العملاء",
      nameEn: null,
      type: "asset",
      naturalBalance: "debit",
      parentId: null,
      isHeader: false,
      status: "active",
    });
    await deps.ledger.save({
      id: "je-dd-1",
      date: "2026-08-01",
      memo: "original",
      status: "reversed",
      source: "system",
      lines: [
        { accountId: "acct-dd", debit: Money.fromMajor("500.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("500.00") },
      ],
    });
    await deps.ledger.save({
      id: "je-dd-2",
      date: "2026-08-02",
      memo: "reversal",
      status: "posted",
      reversesEntryId: "je-dd-1",
      source: "system",
      lines: [
        { accountId: "acct-dd", debit: Money.zero(), credit: Money.fromMajor("500.00") },
        { accountId: "4100", debit: Money.fromMajor("500.00"), credit: Money.zero() },
      ],
    });
    // An unrelated, unreversed posting on the same account.
    await deps.ledger.save({
      id: "je-dd-3",
      date: "2026-08-03",
      memo: "unrelated",
      status: "posted",
      source: "system",
      lines: [
        { accountId: "acct-dd", debit: Money.fromMajor("120.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("120.00") },
      ],
    });

    const res = await app.fetch(req("/drill-down/account/acct-dd", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { titleAr: string; facts: { key: string; value: string }[]; documentCount: number };
    expect(body.titleAr).toBe("حساب العملاء");
    // debit: 500 (original) + 120 (unrelated) = 620; credit: 500 (reversal) = 500; balance = 120.
    expect(body.facts.find((f) => f.key === "debit")?.value).toBe("620.00");
    expect(body.facts.find((f) => f.key === "credit")?.value).toBe("500.00");
    expect(body.facts.find((f) => f.key === "balance")?.value).toBe("120.00");
    // All three postings touched this account: the original, its reversal, and the unrelated one.
    expect(body.documentCount).toBe(3);
  });
});
