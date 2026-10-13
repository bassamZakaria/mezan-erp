import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { computeInvoiceTotals } from "./totals.js";
import type { SalesInvoiceLine, SalesInvoiceDiscount } from "./sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "L1",
    itemId: "I1",
    itemNameAr: "صنف",
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100"),
    discountPercent: 0,
    taxRatePercent: 14,
    revenueAccountId: "4000",
    cogsAccountId: "5000",
    inventoryAccountId: "1200",
    taxRateId: null,
    costCenterId: null,
    unitCost: null,
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

const NO_DISCOUNT: SalesInvoiceDiscount = { type: "percent", percent: 0 };

describe("computeInvoiceTotals — single line, no discounts", () => {
  it("extends qty × unitPrice and computes tax on the full taxable base", () => {
    const totals = computeInvoiceTotals([line({ qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50") })], NO_DISCOUNT);
    expect(totals.grossTotal.toString()).toBe("100.000000");
    expect(totals.subtotal.toString()).toBe("100.000000");
    expect(totals.taxableTotal.toString()).toBe("100.000000");
    expect(totals.taxTotal.toString()).toBe("14.000000"); // 14% of 100
    expect(totals.grandTotal.toString()).toBe("114.000000");
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]?.total.toString()).toBe("114.000000");
  });
});

describe("computeInvoiceTotals — line-level discount", () => {
  it("subtracts the line discount before computing tax", () => {
    const totals = computeInvoiceTotals(
      [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200"), discountPercent: 10, taxRatePercent: 14 })],
      NO_DISCOUNT,
    );
    // gross 200, discount 20 → taxable 180, tax 25.2
    expect(totals.lines[0]?.gross.toString()).toBe("200.000000");
    expect(totals.lines[0]?.lineDiscount.toString()).toBe("20.000000");
    expect(totals.lines[0]?.taxableBase.toString()).toBe("180.000000");
    expect(totals.lines[0]?.tax.toString()).toBe("25.200000");
    expect(totals.grandTotal.toString()).toBe("205.200000");
  });
});

describe("computeInvoiceTotals — invoice-level percent discount spread across lines", () => {
  it("allocates the invoice discount proportionally to line net weight and reconciles exactly", () => {
    const lines = [
      line({ lineId: "L1", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
      line({ lineId: "L2", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200"), taxRatePercent: 0 }),
    ];
    const discount: SalesInvoiceDiscount = { type: "percent", percent: 10 };
    const totals = computeInvoiceTotals(lines, discount);
    // subtotal 300, invoice discount 10% = 30, split by weight 100:200 → 10 / 20
    expect(totals.subtotal.toString()).toBe("300.000000");
    expect(totals.invoiceDiscountTotal.toString()).toBe("30.000000");
    expect(totals.lines[0]?.invoiceDiscount.toString()).toBe("10.000000");
    expect(totals.lines[1]?.invoiceDiscount.toString()).toBe("20.000000");
    // the parts reconcile exactly to the invoice discount total (largest remainder)
    const sumAllocated = totals.lines.reduce((acc, l) => acc.add(l.invoiceDiscount), Money.zero());
    expect(sumAllocated.toString()).toBe(totals.invoiceDiscountTotal.toString());
    expect(totals.taxableTotal.toString()).toBe("270.000000");
    expect(totals.grandTotal.toString()).toBe("270.000000");
  });

  it("distributes an odd invoice discount by largest-remainder so three lines reconcile to the cent", () => {
    const lines = [
      line({ lineId: "L1", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
      line({ lineId: "L2", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
      line({ lineId: "L3", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
    ];
    // invoice discount of exactly 10.00 split evenly three ways -> 3.33 + 3.33 + 3.34
    const discount: SalesInvoiceDiscount = { type: "amount", amount: Money.fromMajor("10") };
    const totals = computeInvoiceTotals(lines, discount);
    const amounts = totals.lines.map((l) => l.invoiceDiscount.toString());
    expect(amounts.sort()).toEqual(["3.330000", "3.330000", "3.340000"]);
    const sumAllocated = totals.lines.reduce((acc, l) => acc.add(l.invoiceDiscount), Money.zero());
    expect(sumAllocated.toString()).toBe("10.000000");
  });

  it("caps an amount-type invoice discount at the subtotal", () => {
    const totals = computeInvoiceTotals(
      [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("50"), taxRatePercent: 0 })],
      { type: "amount", amount: Money.fromMajor("999") },
    );
    expect(totals.invoiceDiscountTotal.toString()).toBe("50.000000");
    expect(totals.taxableTotal.toString()).toBe("0.000000");
    expect(totals.grandTotal.toString()).toBe("0.000000");
  });
});

describe("computeInvoiceTotals — tax exemption", () => {
  it("forces every line's tax to zero when the customer is tax-exempt, regardless of the line's own rate", () => {
    const totals = computeInvoiceTotals(
      [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })],
      NO_DISCOUNT,
      { taxExempt: true },
    );
    expect(totals.taxTotal.toString()).toBe("0.000000");
    expect(totals.grandTotal.toString()).toBe(totals.taxableTotal.toString());
  });
});

describe("computeInvoiceTotals — empty invoice", () => {
  it("is all-zero for an invoice with no lines", () => {
    const totals = computeInvoiceTotals([], NO_DISCOUNT);
    expect(totals.lines).toHaveLength(0);
    expect(totals.grandTotal.toString()).toBe("0.000000");
    expect(totals.invoiceDiscountTotal.toString()).toBe("0.000000");
  });
});
