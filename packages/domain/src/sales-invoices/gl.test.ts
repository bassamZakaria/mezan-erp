import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { computeInvoiceTotals } from "./totals.js";
import { buildSalesInvoiceGlPosting, type SalesInvoiceCogsLine } from "./gl.js";
import type { SalesInvoice, SalesInvoiceLine } from "./sales-invoice.js";

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
    costCenterId: null,
    unitCost: null,
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "INV1",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-08-20",
    dueDate: "2026-09-20",
    customerId: "CUST1",
    customerNameAr: "عميل تجريبي",
    customerTaxExempt: false,
    taxInclusive: false,
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
    arAccountId: "1100",
    taxAccountId: "2300",
    lines: [line()],
    amountPaid: Money.zero(),
    createdAt: "2026-08-20T00:00:00.000Z",
    confirmedAt: "2026-08-20T00:00:00.000Z",
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

function sumDebits(lines: readonly { debit: Money }[]): Money {
  return Money.sum(lines.map((l) => l.debit));
}
function sumCredits(lines: readonly { credit: Money }[]): Money {
  return Money.sum(lines.map((l) => l.credit));
}

describe("buildSalesInvoiceGlPosting — balance invariant", () => {
  it("debits AR for the grand total and balances against revenue + tax + COGS/inventory", () => {
    const inv = invoice({ lines: [line({ qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50"), taxRatePercent: 14 })] });
    const totals = computeInvoiceTotals(inv.lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const cogsLines: SalesInvoiceCogsLine[] = [{ cogsAccountId: "5000", inventoryAccountId: "1200", cost: Money.fromMajor("60") }];
    const posting = buildSalesInvoiceGlPosting(inv, totals, cogsLines);

    const debitTotal = sumDebits(posting.lines);
    const creditTotal = sumCredits(posting.lines);
    expect(debitTotal.toString()).toBe(creditTotal.toString());

    const ar = posting.lines.find((l) => l.accountId === "1100");
    expect(ar?.debit.toString()).toBe(totals.grandTotal.toString());

    const revenue = posting.lines.find((l) => l.accountId === "4000");
    expect(revenue?.credit.toString()).toBe(totals.taxableTotal.toString());

    const tax = posting.lines.find((l) => l.accountId === "2300");
    expect(tax?.credit.toString()).toBe(totals.taxTotal.toString());

    const cogs = posting.lines.find((l) => l.accountId === "5000" && l.debit.scaled !== 0n);
    expect(cogs?.debit.toString()).toBe("60.000000");
    const inventory = posting.lines.find((l) => l.accountId === "1200" && l.credit.scaled !== 0n);
    expect(inventory?.credit.toString()).toBe("60.000000");
  });

  it("omits the tax line entirely when the invoice is tax-exempt (zero-amount lines are never posted)", () => {
    const inv = invoice({ customerTaxExempt: true, lines: [line({ taxRatePercent: 14 })] });
    const totals = computeInvoiceTotals(inv.lines, inv.discount, { taxExempt: true });
    const posting = buildSalesInvoiceGlPosting(inv, totals, []);
    expect(posting.lines.some((l) => l.accountId === "2300")).toBe(false);
    expect(sumDebits(posting.lines).toString()).toBe(sumCredits(posting.lines).toString());
  });

  it("consolidates multiple stock lines that share the same COGS/inventory account into one GL line each", () => {
    const inv = invoice({
      lines: [
        line({ lineId: "L1", itemId: "I1" }),
        line({ lineId: "L2", itemId: "I2" }),
      ],
    });
    const totals = computeInvoiceTotals(inv.lines, inv.discount);
    const cogsLines: SalesInvoiceCogsLine[] = [
      { cogsAccountId: "5000", inventoryAccountId: "1200", cost: Money.fromMajor("30") },
      { cogsAccountId: "5000", inventoryAccountId: "1200", cost: Money.fromMajor("45") },
    ];
    const posting = buildSalesInvoiceGlPosting(inv, totals, cogsLines);
    const cogsPostings = posting.lines.filter((l) => l.accountId === "5000" && l.debit.scaled !== 0n);
    expect(cogsPostings).toHaveLength(1);
    expect(cogsPostings[0]?.debit.toString()).toBe("75.000000");
  });

  it("splits revenue across accounts when lines post to different revenue accounts", () => {
    const inv = invoice({
      lines: [
        line({ lineId: "L1", revenueAccountId: "4000", taxRatePercent: 0 }),
        line({ lineId: "L2", revenueAccountId: "4100", taxRatePercent: 0 }),
      ],
    });
    const totals = computeInvoiceTotals(inv.lines, inv.discount);
    const posting = buildSalesInvoiceGlPosting(inv, totals, []);
    const rev4000 = posting.lines.find((l) => l.accountId === "4000");
    const rev4100 = posting.lines.find((l) => l.accountId === "4100");
    expect(rev4000?.credit.toString()).toBe("100.000000");
    expect(rev4100?.credit.toString()).toBe("100.000000");
  });
});

describe("buildSalesInvoiceGlPosting — the cost-centre dimension (D97)", () => {
  function post(lines: SalesInvoiceLine[], cogs: SalesInvoiceCogsLine[] = []) {
    const inv = invoice({ lines });
    const totals = computeInvoiceTotals(inv.lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    return buildSalesInvoiceGlPosting(inv, totals, cogs);
  }

  it("carries a line's cost centre onto the revenue credit it produces", () => {
    const posting = post([line({ lineId: "L1", costCenterId: "CC-SHOWROOM" })]);
    const revenue = posting.lines.filter((l) => l.accountId === "4000" && l.credit.scaled > 0n);
    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.costCenterId).toBe("CC-SHOWROOM");
  });

  it("splits the revenue credit per cost centre, so two centres on one invoice stay apart", () => {
    const posting = post([
      line({ lineId: "L1", costCenterId: "CC-A", unitPrice: Money.fromMajor("100") }),
      line({ lineId: "L2", costCenterId: "CC-B", unitPrice: Money.fromMajor("250") }),
    ]);
    const revenue = posting.lines.filter((l) => l.accountId === "4000" && l.credit.scaled > 0n);
    expect(revenue).toHaveLength(2);
    const byCentre = Object.fromEntries(revenue.map((l) => [l.costCenterId, l.credit.toString()]));
    expect(byCentre["CC-A"]).toBe(Money.fromMajor("100").toString());
    expect(byCentre["CC-B"]).toBe(Money.fromMajor("250").toString());
  });

  it("still groups two lines that share a centre AND a rate into one credit", () => {
    const posting = post([
      line({ lineId: "L1", costCenterId: "CC-A", unitPrice: Money.fromMajor("100") }),
      line({ lineId: "L2", costCenterId: "CC-A", unitPrice: Money.fromMajor("150") }),
    ]);
    const revenue = posting.lines.filter((l) => l.accountId === "4000" && l.credit.scaled > 0n);
    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.credit.toString()).toBe(Money.fromMajor("250").toString());
  });

  it("leaves the credit unattributed when no centre is named, rather than inventing one", () => {
    const posting = post([line({ lineId: "L1", costCenterId: null })]);
    const revenue = posting.lines.filter((l) => l.accountId === "4000" && l.credit.scaled > 0n);
    expect(revenue[0]?.costCenterId ?? null).toBeNull();
  });

  it("still balances when the centres differ — the dimension must not move a piastre", () => {
    const posting = post([
      line({ lineId: "L1", costCenterId: "CC-A", unitPrice: Money.fromMajor("33.33") }),
      line({ lineId: "L2", costCenterId: "CC-B", unitPrice: Money.fromMajor("66.67") }),
    ]);
    const debit = posting.lines.reduce((sum, l) => sum.add(l.debit), Money.zero());
    const credit = posting.lines.reduce((sum, l) => sum.add(l.credit), Money.zero());
    expect(debit.toString()).toBe(credit.toString());
  });
});
