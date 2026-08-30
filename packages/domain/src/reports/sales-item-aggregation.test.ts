import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { aggregateItemSales } from "./sales-item-aggregation.js";
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
    taxRatePercent: 14,
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

describe("aggregateItemSales", () => {
  it("aggregates qty and taxable-base revenue per item across invoices", () => {
    const invoices = [
      invoice({ id: "i1", lines: [line({ itemId: "item-a", itemNameAr: "صنف أ", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50.00") })] }),
      invoice({ id: "i2", lines: [line({ itemId: "item-a", itemNameAr: "صنف أ", qty: Qty.fromMajor("3"), unitPrice: Money.fromMajor("50.00") })] }),
    ];
    const result = aggregateItemSales(invoices, undefined, undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ itemId: "item-a", qty: 5, revenue: 250 });
  });

  it("excludes non-active-status invoices (draft, cancelled, reversed)", () => {
    const invoices = [
      invoice({ id: "i1", status: "draft" }),
      invoice({ id: "i2", status: "cancelled" }),
      invoice({ id: "i3", status: "reversed" }),
    ];
    expect(aggregateItemSales(invoices, undefined, undefined)).toHaveLength(0);
  });

  it("restricts to the given date range, inclusive at both ends", () => {
    const invoices = [
      invoice({ id: "before", date: "2026-07-31" }),
      invoice({ id: "on-from", date: "2026-08-01" }),
      invoice({ id: "on-to", date: "2026-08-31" }),
      invoice({ id: "after", date: "2026-09-01" }),
    ];
    const result = aggregateItemSales(invoices, "2026-08-01", "2026-08-31");
    // Each in-range invoice contributes its one line's qty (1); two invoices in range.
    expect(result[0]?.qty).toBe(2);
  });

  it("returns [] for a range that matches no invoice at all", () => {
    const invoices = [invoice({ date: "2026-08-10" })];
    expect(aggregateItemSales(invoices, "2099-01-01", "2099-01-31")).toEqual([]);
  });

  it("taxMode 'exc' uses the pre-tax taxable base; 'inc' uses the tax-inclusive line total", () => {
    const invoices = [
      invoice({ lines: [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100.00"), taxRatePercent: 14 })] }),
    ];
    const exc = aggregateItemSales(invoices, undefined, undefined, "exc");
    const inc = aggregateItemSales(invoices, undefined, undefined, "inc");
    expect(exc[0]?.revenue).toBe(100);
    expect(inc[0]?.revenue).toBe(114);
  });

  it("always returns a null English name — the report layer fills it from the item catalogue", () => {
    const invoices = [invoice()];
    expect(aggregateItemSales(invoices, undefined, undefined)[0]?.itemNameEn).toBeNull();
  });
});
