import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createAgingCustomersReport } from "./aging-customers.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return { lineId: "l1", itemId: "item-1", itemNameAr: "صنف", isStock: true, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200.00"), discountPercent: 0, taxRatePercent: 0, revenueAccountId: "4100", cogsAccountId: null, inventoryAccountId: null, unitCost: null, ...overrides };
}
function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1", docType: "SALES_INVOICE", docNo: "INV-1", status: "confirmed", date: "2026-06-01", dueDate: "2026-06-15", customerId: "c1", customerNameAr: "عميل أ",
    customerTaxExempt: false, taxInclusive: false, warehouseId: "wh-1", branchId: "br-1", salespersonId: null, salespersonNameAr: null, couponCode: null, appliedPromotion: null, currency: "EGP", notes: null, internalNotes: null, discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120", taxAccountId: "2200", lines: [line()], amountPaid: Money.zero(), createdAt: "2026-06-01T00:00:00.000Z", confirmedAt: "2026-06-01T00:00:00.000Z",
    journalEntryId: null, workflowRequestId: null, reversesInvoiceId: null, reversedByInvoiceId: null, ...overrides,
  };
}

describe("createAgingCustomersReport", () => {
  it("buckets an invoice not yet due as 'current'", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [invoice()] }); // asOf before dueDate
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.current).toBe(200);
  });

  it("buckets 68 days past due into 61-90", () => {
    // dueDate 2026-06-15 -> asOfDate 2026-08-22 = 68 days
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [invoice()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.d61to90).toBe(200);
    expect(outcome.rows[0]?.current).toBe(0);
    expect(outcome.rows[0]?.total).toBe(200);
  });

  it("buckets 130 days past due as over120", () => {
    const definition = createAgingCustomersReport("2026-10-23");
    const outcome = runReport(definition, { asOfDate: "2026-10-23" }, { invoices: [invoice()] }); // 2026-06-15 -> 2026-10-23 = 130 days
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.over120).toBe(200);
  });

  it("subtracts amountPaid from the outstanding balance", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [invoice({ amountPaid: Money.fromMajor("200.00") })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0); // fully paid, no outstanding row
  });

  it("excludes draft and cancelled invoices, and invoices dated after asOfDate", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: [invoice({ id: "draft", status: "draft" }), invoice({ id: "future", date: "2026-09-01" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("sums multiple invoices for the same customer into one row", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: [invoice({ id: "i1" }), invoice({ id: "i2", dueDate: "2026-06-20" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.total).toBe(400);
  });
});
