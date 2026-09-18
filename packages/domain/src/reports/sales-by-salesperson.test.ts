import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createSalesBySalespersonReport, UNASSIGNED_SALESPERSON_KEY } from "./sales-by-salesperson.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "l1",
    itemId: "item-1",
    itemNameAr: "صنف أ",
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100.00"),
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

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-08-10",
    dueDate: "2026-08-20",
    customerId: "cust-1",
    customerNameAr: "عميل",
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
    lines: [line()],
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

describe("createSalesBySalespersonReport", () => {
  it("aggregates count, total and outstanding per salesperson, independently checked", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "i1", salespersonId: "sp-1", salespersonNameAr: "أحمد", lines: [line({ qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100") })], amountPaid: Money.fromMajor("100") }),
          invoice({ id: "i2", salespersonId: "sp-1", salespersonNameAr: "أحمد", lines: [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("50") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows.find((r) => r.salespersonId === "sp-1");
    expect(row?.count).toBe(2);
    // Independently: 200 + 50 = 250 billed; 250 − 100 paid = 150 outstanding.
    expect(row?.total).toBe(250);
    expect(row?.outstanding).toBe(150);
  });

  it("D219: outstanding nets each invoice's confirmed return credits", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "i1", salespersonId: "sp-1", salespersonNameAr: "أحمد", lines: [line({ qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100") })], amountPaid: Money.fromMajor("100") }),
          invoice({ id: "i2", salespersonId: "sp-1", salespersonNameAr: "أحمد", lines: [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("50") })] }),
        ],
        returnsByInvoiceId: new Map([["i1", Money.fromMajor("30")], ["i2", Money.fromMajor("50")]]),
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.salespersonId === "sp-1")?.outstanding).toBe(70);
  });

  it("buckets invoices with no salesperson into an explicit UNASSIGNED row, never dropping them", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      { invoices: [invoice({ id: "i1", salespersonId: null, lines: [line({ unitPrice: Money.fromMajor("40") })] })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]).toMatchObject({ salespersonId: UNASSIGNED_SALESPERSON_KEY, salespersonNameAr: "غير محدد", total: 40 });
  });

  it("sorts the unassigned row last regardless of its total, ahead of no one else", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "i1", salespersonId: null, lines: [line({ unitPrice: Money.fromMajor("9999") })] }),
          invoice({ id: "i2", salespersonId: "sp-1", lines: [line({ unitPrice: Money.fromMajor("1") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.salespersonId)).toEqual(["sp-1", UNASSIGNED_SALESPERSON_KEY]);
  });

  it("sums total revenue to 100% contribution across all rows, computed here not copied", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "i1", salespersonId: "sp-1", lines: [line({ unitPrice: Money.fromMajor("300") })] }),
          invoice({ id: "i2", salespersonId: "sp-2", lines: [line({ unitPrice: Money.fromMajor("100") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sp1 = outcome.rows.find((r) => r.salespersonId === "sp-1");
    const sp2 = outcome.rows.find((r) => r.salespersonId === "sp-2");
    expect(sp1?.contributionPercent).toBe(75);
    expect(sp2?.contributionPercent).toBe(25);
  });

  it("excludes non-active-status invoices from every aggregate", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      { invoices: [invoice({ status: "draft", salespersonId: "sp-1" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("includes an invoice dated exactly on dateFrom/dateTo and excludes one day outside each bound", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "before", date: "2026-07-31", salespersonId: "sp-1" }),
          invoice({ id: "on-from", date: "2026-08-01", salespersonId: "sp-1" }),
          invoice({ id: "on-to", date: "2026-08-31", salespersonId: "sp-1" }),
          invoice({ id: "after", date: "2026-09-01", salespersonId: "sp-1" }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.count).toBe(2);
  });

  it("renders no rows, honestly, over a date range with no invoices at all", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" }, { invoices: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.total).toBe(0);
  });

  it("taxMode 'exc' reports the pre-tax taxable total instead of the tax-inclusive grand total", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const withInvoice = (taxMode: "inc" | "exc") =>
      runReport(
        definition,
        { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode },
        { invoices: [invoice({ salespersonId: "sp-1", lines: [line({ unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })] })] },
      );
    const inc = withInvoice("inc");
    const exc = withInvoice("exc");
    expect(inc.ok && exc.ok).toBe(true);
    if (!inc.ok || !exc.ok) return;
    expect(inc.rows[0]?.total).toBe(114);
    expect(exc.rows[0]?.total).toBe(100);
  });

  it("never lets outstanding go negative when a customer overpays", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      { invoices: [invoice({ salespersonId: "sp-1", lines: [line({ unitPrice: Money.fromMajor("100") })], amountPaid: Money.fromMajor("150") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.outstanding).toBe(0);
  });

  it("rejects a malformed date via zod, not a throw", () => {
    const definition = createSalesBySalespersonReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "not-a-date", dateTo: "2026-08-31", taxMode: "inc" }, { invoices: [] });
    expect(outcome.ok).toBe(false);
  });
});

describe("createSalesBySalespersonReport — a foreign invoice (D201)", () => {
  it("credits the rep with the base value of a CHF invoice and states what is outstanding in base", () => {
    const definition = createSalesBySalespersonReport("2026-01-01", "2026-12-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      { invoices: [invoice({ salespersonId: "sp-1", salespersonNameAr: "أحمد", currency: "CHF", fxRate: "60.00", lines: [line({ taxRatePercent: 14 })], amountPaid: Money.fromMajor("3000") })] },
    );
    if (!outcome.ok) throw new Error("report failed");
    const row = outcome.rows.find((r) => r.salespersonId === "sp-1");
    expect(row?.total).toBe(6840);
    expect(row?.outstanding).toBe(3840);
  });
});
