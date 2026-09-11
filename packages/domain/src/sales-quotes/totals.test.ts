import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { computeQuoteTotals } from "./totals.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import type { SalesQuoteLine, SalesQuoteDiscount } from "./sales-quote.js";
import type { SalesInvoiceLine, SalesInvoiceDiscount } from "../sales-invoices/sales-invoice.js";

function quoteLine(overrides: Partial<SalesQuoteLine> = {}): SalesQuoteLine {
  return {
    lineId: "L1",
    itemId: "I1",
    itemNameAr: "صنف",
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100"),
    discountPercent: 0,
    taxRatePercent: 14,
    ...overrides,
  };
}

const NO_DISCOUNT: SalesQuoteDiscount = { type: "percent", percent: 0 };

describe("computeQuoteTotals — arithmetic", () => {
  it("extends qty × unitPrice and computes tax on the taxable base", () => {
    const totals = computeQuoteTotals([quoteLine({ qty: Qty.fromMajor("3"), unitPrice: Money.fromMajor("25") })], NO_DISCOUNT);
    expect(totals.grossTotal.toString()).toBe("75.000000");
    expect(totals.taxTotal.toString()).toBe("10.500000"); // 14% of 75
    expect(totals.grandTotal.toString()).toBe("85.500000");
  });

  it("spreads a quote-level percent discount across lines by largest remainder", () => {
    const lines = [
      quoteLine({ lineId: "L1", unitPrice: Money.fromMajor("300"), taxRatePercent: 0 }),
      quoteLine({ lineId: "L2", unitPrice: Money.fromMajor("700"), taxRatePercent: 0 }),
    ];
    const totals = computeQuoteTotals(lines, { type: "percent", percent: 5 });
    expect(totals.invoiceDiscountTotal.toString()).toBe("50.000000");
    expect(totals.lines[0]?.invoiceDiscount.toString()).toBe("15.000000");
    expect(totals.lines[1]?.invoiceDiscount.toString()).toBe("35.000000");
  });

  it("forces zero tax for a tax-exempt customer", () => {
    const totals = computeQuoteTotals([quoteLine({ taxRatePercent: 14 })], NO_DISCOUNT, { taxExempt: true });
    expect(totals.taxTotal.toString()).toBe("0.000000");
  });

  it("is all-zero for a quote with no lines", () => {
    const totals = computeQuoteTotals([], NO_DISCOUNT);
    expect(totals.grandTotal.toString()).toBe("0.000000");
  });
});

describe("computeQuoteTotals — parity with computeInvoiceTotals", () => {
  it("produces byte-identical totals to the invoice module for an equivalent line set (docs contract: must never drift)", () => {
    const qLines: SalesQuoteLine[] = [
      quoteLine({ lineId: "L1", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("133.335"), discountPercent: 12.5, taxRatePercent: 14 }),
      quoteLine({ lineId: "L2", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("999.99"), discountPercent: 0, taxRatePercent: 0 }),
    ];
    const iLines: SalesInvoiceLine[] = qLines.map((l) => ({
      ...l,
      isStock: true,
      unitCode: "",
      unitFactor: 1,
      baseQty: l.qty,
      discountType: "percent" as const,
      discountAmount: Money.zero(),
      revenueAccountId: "4000",
      cogsAccountId: null,
      inventoryAccountId: null,
      costCenterId: null,
      unitCost: null,
    }));
    const qDiscount: SalesQuoteDiscount = { type: "amount", amount: Money.fromMajor("17.77") };
    const iDiscount: SalesInvoiceDiscount = qDiscount;

    const qTotals = computeQuoteTotals(qLines, qDiscount);
    const iTotals = computeInvoiceTotals(iLines, iDiscount);

    expect(qTotals.grandTotal.toString()).toBe(iTotals.grandTotal.toString());
    expect(qTotals.taxTotal.toString()).toBe(iTotals.taxTotal.toString());
    expect(qTotals.invoiceDiscountTotal.toString()).toBe(iTotals.invoiceDiscountTotal.toString());
    qTotals.lines.forEach((l, i) => {
      expect(l.total.toString()).toBe(iTotals.lines[i]?.total.toString());
    });
  });
});
