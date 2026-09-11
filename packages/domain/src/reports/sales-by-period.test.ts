import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createSalesByPeriodReport } from "./sales-by-period.js";
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
    customerNameAr: "عميل",
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

describe("createSalesByPeriodReport", () => {
  it("buckets by day and sums gross/tax/net across invoices on the same date", () => {
    const definition = createSalesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      {
        invoices: [
          invoice({ id: "i1", date: "2026-08-10", lines: [line({ qty: Qty.fromMajor("2"), taxRatePercent: 14 })] }),
          invoice({ id: "i2", date: "2026-08-10", lines: [line({ qty: Qty.fromMajor("1") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    const row = outcome.rows[0]!;
    expect(row.count).toBe(2);
    expect(row.gross).toBe(300);
    expect(row.tax).toBe(28); // 14% of 200
    expect(row.net).toBe(328);
    expect(outcome.grandTotals.net).toBe(328);
  });

  it("buckets by month when groupBy=month", () => {
    const definition = createSalesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-09-30", groupBy: "month" },
      { invoices: [invoice({ id: "i1", date: "2026-08-05" }), invoice({ id: "i2", date: "2026-09-15" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.bucket).sort()).toEqual(["2026-08", "2026-09"]);
  });

  it("excludes draft and cancelled invoices", () => {
    const definition = createSalesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      {
        invoices: [
          invoice({ id: "draft", status: "draft" }),
          invoice({ id: "cancelled", status: "cancelled" }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes invoices outside the date range", () => {
    const definition = createSalesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      { invoices: [invoice({ id: "outside", date: "2026-09-01" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("rejects malformed date params", () => {
    const definition = createSalesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "not-a-date", dateTo: "2026-08-31", groupBy: "day" }, { invoices: [] });
    expect(outcome.ok).toBe(false);
  });
});
