/**
 * taxInclusive pricing (settings §"الضريبة" -> طريقة احتساب الضريبة = شاملة).
 *
 * The whole point is that the customer pays EXACTLY the number on the shelf
 * label: the tax is EXTRACTED from the gross (amount x rate / (100 + rate)),
 * never added on top. Swapping the extraction for the ordinary percentage
 * still leaves the grand total looking right, so only the exact net and tax
 * strings catch it.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { computeInvoiceTotals, salesInvoiceTotals } from "./totals.js";
import { buildSalesInvoiceGlPosting } from "./gl.js";
import type { SalesInvoice, SalesInvoiceLine } from "./sales-invoice.js";

function line(lineId: string, qty: string, unitPrice: string, taxRatePercent = 14): SalesInvoiceLine {
  return {
    lineId,
    itemId: lineId,
    itemNameAr: lineId,
    isStock: false,
    qty: Qty.fromMajor(qty),
    unitCode: "",
    unitFactor: 1,
    baseQty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor(unitPrice),
    discountType: "percent",
    discountPercent: 0,
    discountAmount: Money.zero(),
    taxRatePercent,
    revenueAccountId: "4000",
    cogsAccountId: null,
    inventoryAccountId: null,
    costCenterId: null,
    unitCost: null,
  };
}

const NO_DISCOUNT = { type: "amount" as const, amount: Money.zero() };

describe("taxInclusive: the tax comes OUT of the gross, not ON TOP of it", () => {
  it("splits a quoted 1,000.00 at 14% into 877.19 net + 122.81 tax, still totalling 1,000.00", () => {
    const totals = computeInvoiceTotals([line("L1", "1", "1000.00")], NO_DISCOUNT, { taxInclusive: true });

    expect(totals.taxInclusive).toBe(true);
    expect(totals.grossTotal.toString()).toBe("1000.000000");
    expect(totals.taxableTotal.toString()).toBe("877.190000");
    expect(totals.taxTotal.toString()).toBe("122.810000");
    expect(totals.grandTotal.toString()).toBe("1000.000000");
  });

  it("net + tax equals the gross to the last micro-unit", () => {
    const totals = computeInvoiceTotals([line("L1", "1", "1000.00")], NO_DISCOUNT, { taxInclusive: true });
    expect(totals.taxableTotal.add(totals.taxTotal).toString()).toBe(totals.grossTotal.toString());
    expect(totals.taxableTotal.add(totals.taxTotal).scaled).toBe(totals.grandTotal.scaled);
  });

  it("differs from the exclusive treatment of the SAME quoted price by the whole tax", () => {
    const exclusive = computeInvoiceTotals([line("L1", "1", "1000.00")], NO_DISCOUNT, { taxInclusive: false });
    expect(exclusive.taxableTotal.toString()).toBe("1000.000000");
    expect(exclusive.taxTotal.toString()).toBe("140.000000");
    expect(exclusive.grandTotal.toString()).toBe("1140.000000");
  });

  it("extracts nothing from a zero-rated line, and everything stays gross", () => {
    const totals = computeInvoiceTotals([line("L1", "1", "1000.00", 0)], NO_DISCOUNT, { taxInclusive: true });
    expect(totals.taxTotal.toString()).toBe("0.000000");
    expect(totals.taxableTotal.toString()).toBe("1000.000000");
    expect(totals.grandTotal.toString()).toBe("1000.000000");
  });

  it("forces the tax to zero for an exempt customer without inflating the total back to gross+tax", () => {
    const totals = computeInvoiceTotals([line("L1", "1", "1000.00")], NO_DISCOUNT, { taxInclusive: true, taxExempt: true });
    expect(totals.taxTotal.toString()).toBe("0.000000");
    expect(totals.grandTotal.toString()).toBe("1000.000000");
  });
});

describe("taxInclusive across several lines — the parts must still reconcile to the document", () => {
  /**
   * Three lines quoted 33.33 / 33.33 / 33.34 = 100.00 on the shelf. VAT is a
   * PER-LINE figure, so the document tax is the sum of three rounded line
   * taxes, and the grand total still has to be the 100.00 the customer was
   * quoted.
   */
  const lines = [line("L1", "1", "33.33"), line("L2", "1", "33.33"), line("L3", "1", "33.34")];

  it("sums the per-line taxes exactly into the document tax", () => {
    const totals = computeInvoiceTotals(lines, NO_DISCOUNT, { taxInclusive: true });
    expect(totals.lines.map((l) => l.tax.toString())).toEqual(["4.090000", "4.090000", "4.090000"]);
    expect(totals.taxTotal.toString()).toBe("12.270000");
    expect(Money.sum(totals.lines.map((l) => l.tax)).scaled).toBe(totals.taxTotal.scaled);
  });

  it("keeps the grand total at the quoted 100.00 even though the per-line split rounds", () => {
    const totals = computeInvoiceTotals(lines, NO_DISCOUNT, { taxInclusive: true });
    expect(totals.lines.map((l) => l.taxableBase.toString())).toEqual(["29.240000", "29.240000", "29.250000"]);
    expect(totals.taxableTotal.toString()).toBe("87.730000");
    expect(totals.grandTotal.toString()).toBe("100.000000");
    expect(totals.grossTotal.toString()).toBe("100.000000");
  });

  it("still totals the quoted price once a header discount has been split by largest remainder", () => {
    const discounted = computeInvoiceTotals(
      [line("L1", "1", "100.00"), line("L2", "1", "100.00"), line("L3", "1", "100.00")],
      { type: "amount", amount: Money.fromMajor("10.00") },
      { taxInclusive: true },
    );
    expect(discounted.lines.map((l) => l.invoiceDiscount.toString())).toEqual(["3.340000", "3.330000", "3.330000"]);
    expect(Money.sum(discounted.lines.map((l) => l.invoiceDiscount)).toString()).toBe("10.000000");
    expect(discounted.lines.map((l) => l.tax.toString())).toEqual(["11.870000", "11.870000", "11.870000"]);
    expect(discounted.taxTotal.toString()).toBe("35.610000");
    expect(discounted.taxableTotal.toString()).toBe("254.390000");
    expect(discounted.grandTotal.toString()).toBe("290.000000");
  });
});

describe("taxInclusive in the GL — the customer is debited the price on the label", () => {
  function invoice(lines: readonly SalesInvoiceLine[]): SalesInvoice {
    return {
      id: "INV-INC",
      docType: "SALES_INVOICE",
      docNo: "INV-000021",
      status: "confirmed",
      date: "2026-08-20",
      dueDate: "2026-09-20",
      customerId: "CUST1",
      customerNameAr: "عميل",
      customerTaxExempt: false,
      taxInclusive: true,
      warehouseId: "WH1",
      branchId: "BR1",
      salespersonId: null,
      salespersonNameAr: null,
      couponCode: null,
      appliedPromotion: null,
      currency: "EGP",
      notes: null,
      internalNotes: null,
      discount: { type: "percent", percent: 0 },
      arAccountId: "1105",
      taxAccountId: "2201",
      lines,
      amountPaid: Money.zero(),
      createdAt: "2026-08-20T00:00:00.000Z",
      confirmedAt: "2026-08-20T00:00:00.000Z",
      journalEntryId: null,
      workflowRequestId: null,
      reversesInvoiceId: null,
      reversedByInvoiceId: null,
    };
  }

  it("debits AR 1,000.00 and credits revenue 877.19 + VAT 122.81, tagged with the rate charged", () => {
    const inv = invoice([line("L1", "1", "1000.00")]);
    const posting = buildSalesInvoiceGlPosting(inv, salesInvoiceTotals(inv), []);

    const ar = posting.lines.find((l) => l.accountId === "1105");
    const revenue = posting.lines.find((l) => l.accountId === "4000");
    const vat = posting.lines.find((l) => l.accountId === "2201");

    expect(ar!.debit.toString()).toBe("1000.000000");
    expect(revenue!.credit.toString()).toBe("877.190000");
    expect(vat!.credit.toString()).toBe("122.810000");
    expect(vat!.taxRatePercent).toBe(14);
    expect(Money.sum(posting.lines.map((l) => l.debit)).toString()).toBe(
      Money.sum(posting.lines.map((l) => l.credit)).toString(),
    );
  });

  it("splits a mixed-rate inclusive invoice into one VAT line per rate, each still extracted from its own gross", () => {
    const inv = invoice([line("L1", "1", "1000.00", 14), line("L2", "1", "1000.00", 5)]);
    const posting = buildSalesInvoiceGlPosting(inv, salesInvoiceTotals(inv), []);
    const vatLines = posting.lines.filter((l) => l.accountId === "2201");

    expect(vatLines.map((l) => [l.taxRatePercent, l.credit.toString()])).toEqual([
      [14, "122.810000"],
      [5, "47.620000"],
    ]);
    expect(posting.lines.find((l) => l.accountId === "1105")!.debit.toString()).toBe("2000.000000");
  });
});
