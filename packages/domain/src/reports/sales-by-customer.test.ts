import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createSalesByCustomerReport } from "./sales-by-customer.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "l1",
    itemId: "item-1",
    itemNameAr: "صنف",
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
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
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
    customerNameAr: "عميل أ",
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

describe("createSalesByCustomerReport", () => {
  it("aggregates total and outstanding per customer (tax-inclusive)", () => {
    const definition = createSalesByCustomerReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({
            id: "i1",
            customerId: "c1",
            customerNameAr: "عميل أ",
            lines: [line({ taxRatePercent: 14 })],
            amountPaid: Money.fromMajor("50.00"),
          }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.total).toBe(114);
    expect(outcome.rows[0]?.outstanding).toBe(64);
    expect(outcome.rows[0]?.contributionPercent).toBe(100);
  });

  it("excludes tax when taxMode=exc", () => {
    const definition = createSalesByCustomerReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "exc" },
      { invoices: [invoice({ lines: [line({ taxRatePercent: 14 })] })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.total).toBe(100);
  });

  it("splits contribution % correctly across two customers", () => {
    const definition = createSalesByCustomerReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      {
        invoices: [
          invoice({ id: "i1", customerId: "c1", customerNameAr: "عميل أ", lines: [line({ qty: Qty.fromMajor("3") })] }),
          invoice({ id: "i2", customerId: "c2", customerNameAr: "عميل ب", lines: [line({ qty: Qty.fromMajor("1") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const a = outcome.rows.find((r) => r.customerId === "c1")!;
    const b = outcome.rows.find((r) => r.customerId === "c2")!;
    expect(a.contributionPercent).toBe(75);
    expect(b.contributionPercent).toBe(25);
  });

  it("never reports negative outstanding for an overpaid invoice", () => {
    const definition = createSalesByCustomerReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", taxMode: "inc" },
      { invoices: [invoice({ amountPaid: Money.fromMajor("500.00") })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.outstanding).toBe(0);
  });
});
