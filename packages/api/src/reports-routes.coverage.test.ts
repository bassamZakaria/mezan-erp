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
  type SalesInvoice,
  type SalesInvoiceLine,
  type Cheque,
  type Customer,
  type Supplier,
  type FrameworkDocument,
  type VoucherLine,
  type EmployeeRepository,
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

function makeVoucherLine(overrides: Partial<VoucherLine> = {}): VoucherLine {
  return {
    voucherType: "customer_collection",
    direction: "receipt",
    amount: Money.fromMajor("200.00"),
    currency: "EGP",
    branchId: "br-1",
    paymentMethod: "cash",
    treasuryAccountId: "tr-1",
    treasuryGlAccountId: "1010",
    counterpartyGlAccountId: "1105",
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: "cust-credits",
    supplierId: null,
    referenceNo: null,
    withholdingAmount: null,
    withholdingRatePercent: null,
    ...overrides,
  } as VoucherLine;
}

function makeVoucherDoc(overrides: Partial<FrameworkDocument<VoucherLine>> = {}): FrameworkDocument<VoucherLine> {
  return {
    id: "v-1",
    docType: "VOUCHER",
    docNo: "PAY-000001",
    date: "2026-05-15",
    memo: "voucher",
    status: "confirmed",
    lines: [makeVoucherLine()],
    createdAt: "2026-05-15T00:00:00.000Z",
    confirmedAt: "2026-05-15T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

const emptyEmployees: EmployeeRepository = {
  findById: async () => null,
  list: async () => [],
  create: async () => {},
  update: async () => {},
};

async function newDeps(overrides: Partial<ReportsRoutesDeps> = {}) {
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
    ...overrides,
  };
  return { deps, vouchers, cheques, salesReturns, ledger, accounts };
}

function req(path: string, permissions?: string) {
  const headers = new Headers();
  if (permissions !== undefined) headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { headers });
}

describe("reports routes — today falls back to the real calendar day", () => {
  it("uses the local calendar date, not a fixed override, when `today` is omitted", async () => {
    const { deps } = await newDeps({ today: undefined });
    const app = createReportsRoutes(deps);
    const res = await app.fetch(req("/sales/by-period", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { params: { dateTo: string } };
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(body.params.dateTo).toBe(expected);
  });
});

describe("reports routes — drill-down/account ties journal entries by date then id", () => {
  it("orders same-day postings by entry id when the account touches two entries on one date", async () => {
    const { deps, accounts, ledger } = await newDeps();
    const app = createReportsRoutes(deps);
    await accounts.create({
      id: "acct-tie",
      code: "1106",
      nameAr: "حساب تجريبي",
      nameEn: null,
      type: "asset",
      naturalBalance: "debit",
      parentId: null,
      isHeader: false,
      status: "active",
    });
    await ledger.save({
      id: "je-tie-b",
      date: "2026-08-05",
      memo: "second alphabetically, saved first",
      status: "posted",
      source: "system",
      lines: [
        { accountId: "acct-tie", debit: Money.fromMajor("10.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("10.00") },
      ],
    });
    await ledger.save({
      id: "je-tie-a",
      date: "2026-08-05",
      memo: "first alphabetically, saved second",
      status: "posted",
      source: "system",
      lines: [
        { accountId: "acct-tie", debit: Money.fromMajor("5.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("5.00") },
      ],
    });

    const res = await app.fetch(req("/drill-down/account/acct-tie", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: { id: string }[] };
    expect(body.documents.map((d) => d.id)).toEqual(["je-tie-a", "je-tie-b"]);
  });
});

describe("reports routes — sales/by-item posted-revenue window excludes out-of-range and off-type postings", () => {
  it("counts only postings inside the date range and tagged SALES_INVOICE", async () => {
    const { deps, ledger } = await newDeps();
    const app = createReportsRoutes(deps);
    await ledger.save({
      id: "je-before-range",
      date: "2026-07-31",
      memo: "before the window",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });
    await ledger.save({
      id: "je-after-range",
      date: "2026-09-01",
      memo: "after the window",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });
    await ledger.save({
      id: "je-wrong-doctype",
      date: "2026-08-15",
      memo: "opening balance, not a sale",
      status: "posted",
      source: "system",
      sourceDocType: "OPENING_BALANCE",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("100.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    });
    await ledger.save({
      id: "je-in-range",
      date: "2026-08-15",
      memo: "inside the window, right doc type",
      status: "posted",
      source: "system",
      sourceDocType: "SALES_INVOICE",
      lines: [
        { accountId: "1120", debit: Money.fromMajor("300.00"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("300.00") },
      ],
    });

    const res = await app.fetch(req("/sales/by-item?dateFrom=2026-08-01&dateTo=2026-08-31", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reconciliation: { referenceTotal: number } };
    expect(body.reconciliation.referenceTotal).toBe(300);
  });
});

describe("reports routes — aging/customers unapplied credits", () => {
  async function customerWithOutstandingInvoice(deps: ReportsRoutesDeps) {
    await deps.customers.save(makeCustomer({ id: "cust-credits", code: "CUST-CREDITS", nameAr: "عميل بأرصدة" }));
    await deps.salesInvoices.save(
      makeInvoice({
        id: "inv-credits",
        docNo: "INV-CREDITS",
        date: "2026-01-01",
        dueDate: "2026-01-01",
        customerId: "cust-credits",
        lines: [makeInvoiceLine({ unitPrice: Money.fromMajor("1000.00"), qty: Qty.fromMajor("1") })],
      }),
    );
  }

  it("nets a valid incoming cheque and accumulates a second one for the same customer, but ignores a bounced or zero-amount cheque", async () => {
    const { deps, cheques } = await newDeps();
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    await cheques.save(makeCheque({ id: "chq-valid-1", chequeNumber: "CHQ-0001", partyId: "cust-credits", amount: Money.fromMajor("100.00") }));
    await cheques.save(makeCheque({ id: "chq-valid-2", chequeNumber: "CHQ-0002", partyId: "cust-credits", amount: Money.fromMajor("50.00") }));
    await cheques.save(makeCheque({ id: "chq-bounced", chequeNumber: "CHQ-0003", partyId: "cust-credits", amount: Money.fromMajor("999.00"), status: "bounced" }));
    await cheques.save(makeCheque({ id: "chq-zero", chequeNumber: "CHQ-0005", partyId: "cust-credits", amount: Money.zero() }));

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    const row = body.rows.find((r) => r.customerId === "cust-credits");
    expect(row?.total).toBe(1000 - 150);
  });

  it("ignores a receipt voucher line that names no customer", async () => {
    const { deps, vouchers } = await newDeps();
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    await vouchers.documents.save(
      makeVoucherDoc({
        id: "v-no-customer",
        docNo: "PAY-NOCUST",
        lines: [makeVoucherLine({ customerId: null, amount: Money.fromMajor("999.00") })],
      }),
    );

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    expect(body.rows.find((r) => r.customerId === "cust-credits")?.total).toBe(1000);
  });

  it("nets an unallocated remainder of a confirmed receipt voucher, but ignores a payment voucher and one posted to the wrong control account", async () => {
    const { deps, vouchers } = await newDeps();
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    await vouchers.documents.save(
      makeVoucherDoc({
        id: "v-receipt-allocated",
        docNo: "PAY-A",
        lines: [makeVoucherLine({ amount: Money.fromMajor("200.00") })],
      }),
    );
    await vouchers.allocations.save({
      id: "alloc-1",
      voucherId: "v-receipt-allocated",
      invoiceId: "inv-credits",
      amount: Money.fromMajor("50.00"),
      status: "active",
      createdAt: "2026-05-15T00:00:00.000Z",
      reversedAt: null,
    });
    await vouchers.documents.save(
      makeVoucherDoc({
        id: "v-payment",
        docNo: "PAY-B",
        lines: [makeVoucherLine({ direction: "payment", amount: Money.fromMajor("500.00") })],
      }),
    );
    await vouchers.documents.save(
      makeVoucherDoc({
        id: "v-wrong-account",
        docNo: "PAY-C",
        lines: [makeVoucherLine({ counterpartyGlAccountId: "9999", amount: Money.fromMajor("500.00") })],
      }),
    );

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    const row = body.rows.find((r) => r.customerId === "cust-credits");
    // 1000 outstanding, less the receipt's unallocated remainder (200 - 50 = 150).
    expect(row?.total).toBe(1000 - 150);
  });

  it("does not crash when the voucher-documents port isn't wired at all, and skips a return with no lines", async () => {
    const { deps, salesReturns } = await newDeps({ voucherDocuments: undefined });
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    await salesReturns.save({
      id: "sr-empty",
      docType: "SALES_RETURN",
      docNo: "SRT-EMPTY",
      date: "2026-02-01",
      memo: "no lines at all",
      status: "confirmed",
      lines: [],
      createdAt: "2026-02-01T00:00:00.000Z",
      confirmedAt: "2026-02-01T00:00:00.000Z",
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    await salesReturns.save({
      id: "sr-draft",
      docType: "SALES_RETURN",
      docNo: "SRT-DRAFT",
      date: "2026-02-01",
      memo: "not confirmed",
      status: "draft",
      lines: [
        {
          itemId: "item-1",
          warehouseId: "wh-1",
          customerId: "cust-credits",
          sourceInvoiceId: "inv-credits",
          sourceInvoiceNumber: "INV-CREDITS",
          reason: "DEFECTIVE",
          availableQty: Qty.fromMajor("1"),
          qty: Qty.fromMajor("1"),
          unitPrice: Money.fromMajor("300.00"),
          unitCost: Money.fromMajor("60.00"),
          taxAmount: Money.zero(),
        },
      ],
      createdAt: "2026-02-01T00:00:00.000Z",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    const row = body.rows.find((r) => r.customerId === "cust-credits");
    // Neither the lineless return nor the unconfirmed one reduced the balance.
    expect(row?.total).toBe(1000);
  });

  it("does not crash and applies nothing when the allocations port isn't wired at all", async () => {
    const { deps, vouchers } = await newDeps({ allocations: undefined });
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    await vouchers.documents.save(
      makeVoucherDoc({ id: "v-no-allocations-port", docNo: "PAY-D", lines: [makeVoucherLine({ amount: Money.fromMajor("300.00") })] }),
    );

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    const row = body.rows.find((r) => r.customerId === "cust-credits");
    // With no allocations port, the full 300 counts as unapplied.
    expect(row?.total).toBe(1000 - 300);
  });

  it("does not crash when the sales-return-documents port isn't wired at all", async () => {
    const { deps } = await newDeps({ salesReturnDocs: undefined });
    await customerWithOutstandingInvoice(deps);
    const app = createReportsRoutes(deps);

    const res = await app.fetch(req("/aging/customers?asOfDate=2026-08-22", "sales.invoice.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { customerId: string; total: number }[] };
    expect(body.rows.find((r) => r.customerId === "cust-credits")?.total).toBe(1000);
  });
});

describe("reports routes — field/van-sales resolves crew names when the employees port is wired", () => {
  it("is wired without crashing when the employees repository is present but has no matching crew member", async () => {
    const { deps } = await newDeps();
    const app = createReportsRoutes({
      ...deps,
      vanTrips: {
        list: async () => [],
        findById: async () => null,
        create: async () => {},
        update: async () => {},
      } as never,
      employees: emptyEmployees,
    });
    const res = await app.fetch(req("/field/van-sales?dateFrom=2026-08-01&dateTo=2026-08-31&status=all", "field.van_trip.view"));
    expect(res.status).toBe(200);
  });
});

describe("reports routes — tax/withholding", () => {
  it("does not crash when the voucher-documents port isn't wired at all", async () => {
    const { deps } = await newDeps({ voucherDocuments: undefined });
    const app = createReportsRoutes(deps);
    const res = await app.fetch(req("/tax/withholding?fromDate=2026-01-01&toDate=2026-12-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });

  it("shows a dash for the party name when a withheld voucher line names no supplier", async () => {
    const { deps, vouchers } = await newDeps();
    const app = createReportsRoutes(deps);
    await deps.suppliers.save(makeSupplier({ id: "sup-wh", nameAr: "مورد الخصم" }));
    await vouchers.documents.save(
      makeVoucherDoc({
        id: "v-wh-no-supplier",
        docNo: "PAY-NOSUP",
        date: "2026-05-15",
        lines: [
          makeVoucherLine({
            voucherType: "supplier_payment",
            direction: "payment",
            customerId: null,
            supplierId: null,
            withholdingAmount: Money.fromMajor("10.00"),
            withholdingRatePercent: 5,
          }),
        ],
      }),
    );
    const res = await app.fetch(req("/tax/withholding?fromDate=2026-01-01&toDate=2026-12-31", "accounting.reports.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { partyNameAr: string }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.partyNameAr).toBe("—");
  });
});

describe("reports routes — drill-down/customer falls back to the invoice id when it has no doc number", () => {
  it("uses the invoice's own id as docNo when docNo is null", async () => {
    const { deps } = await newDeps();
    const app = createReportsRoutes(deps);
    await deps.customers.save(makeCustomer({ id: "cust-nodocno", code: "CUST-ND", nameAr: "عميل بدون رقم مستند" }));
    await deps.salesInvoices.save(
      makeInvoice({ id: "inv-nodocno", docNo: null, customerId: "cust-nodocno" }),
    );

    const res = await app.fetch(req("/drill-down/customer/cust-nodocno", "sales.customer.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: { docNo: string }[] };
    expect(body.documents[0]?.docNo).toBe("inv-nodocno");
  });
});
