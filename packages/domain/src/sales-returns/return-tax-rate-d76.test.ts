/**
 * D76 — a confirmed RETURN used to aggregate every line tax into ONE untagged
 * journal line, so the per-line taxRatePercent D28 added to invoices did not
 * extend to returns and the VAT return (إقرار القيمة المضافة) could not split a
 * mixed-rate return by rate.
 *
 * These tests now assert the guarantee: one TAGGED tax line per rate, and a
 * base line tagged with the same rate beside it, on both the sales and the
 * purchase side.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createSalesReturnDocumentType, type SalesReturnLine } from "./sales-return-document.js";
import { createPurchaseReturnDocumentType, type PurchaseReturnLine } from "../purchase-returns/purchase-return-document.js";
import type { FrameworkDocument } from "../documents/document.js";

const SALES_ACCOUNTS = {
  accountsReceivableId: "1105",
  salesReturnsAccountId: "4100",
  outputTaxPayableAccountId: "2201",
  inventoryAccountId: "1200",
  cogsAccountId: "5000",
};

const PURCHASE_ACCOUNTS = {
  accountsPayableId: "2105",
  inputTaxPayableId: "1250",
  inventoryAccountId: "1200",
  priceVarianceAccountId: "5900",
};

function salesDoc(lines: readonly SalesReturnLine[]): FrameworkDocument<SalesReturnLine> {
  return {
    id: "SR-MIXED",
    docType: "SALES_RETURN",
    docNo: "SRT-000009",
    date: "2026-08-21",
    memo: "",
    status: "confirmed",
    lines,
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

function purchaseDoc(lines: readonly PurchaseReturnLine[]): FrameworkDocument<PurchaseReturnLine> {
  return { ...salesDoc([]), docType: "PURCHASE_RETURN", id: "PR-MIXED", docNo: "PRT-000009", lines } as unknown as FrameworkDocument<PurchaseReturnLine>;
}

function salesLine(overrides: Partial<SalesReturnLine>): SalesReturnLine {
  return {
    itemId: "ITEM-A",
    warehouseId: "WH1",
    customerId: "CUST-1",
    sourceInvoiceId: "INV-1",
    sourceInvoiceNumber: "INV-000014",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("100"),
    qty: Qty.fromMajor("1"),
    unitPrice: Money.zero(),
    unitCost: Money.zero(),
    taxAmount: Money.zero(),
    ...overrides,
  };
}

describe("GUARANTEE (D76): a mixed-rate sales return posts one TAGGED VAT line per rate", () => {
  /**
   * Two lines off the SAME invoice at two different rates:
   *   A: 2 x 100.00 standard-rated at 14% -> 28.00 tax
   *   B: 4 x 50.00 reduced-rated at 5%   -> 10.00 tax
   * The books should be able to say 28.00 came back at 14% and 10.00 at 5%.
   */
  const lines = [
    salesLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100"), unitCost: Money.fromMajor("60"), taxAmount: Money.fromMajor("28"), taxRatePercent: 14 }),
    salesLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitPrice: Money.fromMajor("50"), unitCost: Money.fromMajor("30"), taxAmount: Money.fromMajor("10"), taxRatePercent: 5 }),
  ];

  it("splits the 38.00 into a 28.00 line tagged 14% and a 10.00 line tagged 5%", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const taxLines = posting!.lines.filter((l) => l.accountId === SALES_ACCOUNTS.outputTaxPayableAccountId);

    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((l) => [l.taxRatePercent, l.debit.toString()])).toEqual([
      [14, "28.000000"],
      [5, "10.000000"],
    ]);
    // The whole VAT still comes back off the payable — the split must not
    // change the amount, only carry the dimension.
    expect(Money.sum(taxLines.map((l) => l.debit)).toString()).toBe("38.000000");
  });

  it("tags the returns-revenue side with the same rates, so the base a rate applied to is recoverable", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const revenueLines = posting!.lines.filter((l) => l.accountId === SALES_ACCOUNTS.salesReturnsAccountId);

    expect(revenueLines.map((l) => [l.taxRatePercent, l.debit.toString()])).toEqual([
      [14, "200.000000"],
      [5, "200.000000"],
    ]);
    // 28/200 = 14% and 10/200 = 5% — both rates the source invoice charged.
    // Dividing the aggregate 38 by the aggregate 400 gave 9.5%, a rate that
    // appears on no line of any invoice.
    expect(Money.sum(revenueLines.map((l) => l.debit)).toString()).toBe("400.000000");
  });

  it("still posts a balanced entry — the split must not move a single unit of value", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const debit = Money.sum(posting!.lines.map((l) => l.debit));
    const credit = Money.sum(posting!.lines.map((l) => l.credit));
    expect(debit.toString()).toBe("678.000000");
    expect(credit.toString()).toBe("678.000000");
  });

  it("a return line with no rate on it collapses into ONE untagged line, exactly as before", () => {
    // The negative control. Returns built before the dimension existed, and
    // callers that do not supply a rate, must keep posting the entry they
    // always posted — one line, no rate — not a line tagged 0%.
    const untagged = [
      salesLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100"), unitCost: Money.fromMajor("60"), taxAmount: Money.fromMajor("28") }),
      salesLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitPrice: Money.fromMajor("50"), unitCost: Money.fromMajor("30"), taxAmount: Money.fromMajor("10") }),
    ];
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(untagged), undefined);
    const taxLines = posting!.lines.filter((l) => l.accountId === SALES_ACCOUNTS.outputTaxPayableAccountId);

    expect(taxLines).toHaveLength(1);
    expect(taxLines[0]!.debit.toString()).toBe("38.000000");
    expect(taxLines[0]!.taxRatePercent ?? null).toBeNull();
  });

  it("the return LINE now carries the rate, so the document can be re-posted from itself", () => {
    expect(lines[0]!.taxRatePercent).toBe(14);
    expect(lines[0]!.taxAmount.toString()).toBe("28.000000");
  });
});

describe("GUARANTEE (D76): the purchase-return twin splits by rate too", () => {
  function purchaseLine(overrides: Partial<PurchaseReturnLine>): PurchaseReturnLine {
    return {
      itemId: "ITEM-A",
      warehouseId: "WH1",
      supplierId: "SUP-1",
      sourceInvoiceId: "PI-1",
      sourceInvoiceNumber: "PI-000003",
      reason: "DEFECTIVE",
      availableQty: Qty.fromMajor("100"),
      qty: Qty.fromMajor("1"),
      unitCost: Money.zero(),
      taxAmount: Money.zero(),
      ...overrides,
    };
  }

  const mixed = () =>
    purchaseDoc([
      purchaseLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("100"), taxAmount: Money.fromMajor("28"), taxRatePercent: 14 }),
      purchaseLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50"), taxAmount: Money.fromMajor("10"), taxRatePercent: 5 }),
    ]);

  it("splits the 38.00 input-tax credit into a 14% and a 5% line", () => {
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(mixed(), undefined);
    const taxLines = posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inputTaxPayableId);

    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((l) => [l.taxRatePercent, l.credit.toString()])).toEqual([
      [14, "28.000000"],
      [5, "10.000000"],
    ]);
  });

  it("tags the inventory credit by rate, so the input base per rate is recoverable", () => {
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(mixed(), undefined);
    const inventoryLines = posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inventoryAccountId);

    expect(inventoryLines.map((l) => [l.taxRatePercent, l.credit.toString()])).toEqual([
      [14, "200.000000"],
      [5, "200.000000"],
    ]);
  });

  it("splits the price variance by rate too, so base per rate still equals the supplier credit per rate", () => {
    // The goods left stock carrying 380.00 while the supplier credits 400.00,
    // so 20.00 lands in the variance account. Both the inventory relief and
    // the variance carry the rate, so 190 + 10 = 200 of base sits under 14%
    // and the same under 5% — which is what the supplier actually credited.
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(mixed(), {
      valueMoved: Money.fromMajor("-380"),
    } as never);
    const byAccountAndRate = posting!.lines.map((l) => [l.accountId, l.taxRatePercent ?? null, l.debit.toString(), l.credit.toString()]);

    expect(byAccountAndRate).toEqual([
      ["2105", null, "438.000000", "0.000000"],
      ["1250", 14, "0.000000", "28.000000"],
      ["1250", 5, "0.000000", "10.000000"],
      ["1200", 14, "0.000000", "190.000000"],
      ["1200", 5, "0.000000", "190.000000"],
      ["5900", 14, "0.000000", "10.000000"],
      ["5900", 5, "0.000000", "10.000000"],
    ]);
    expect(Money.sum(posting!.lines.map((l) => l.debit)).toString()).toBe("438.000000");
    expect(Money.sum(posting!.lines.map((l) => l.credit)).toString()).toBe("438.000000");
  });

  it("an untagged purchase return still posts one inventory line and one tax line", () => {
    const doc = purchaseDoc([
      purchaseLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("100"), taxAmount: Money.fromMajor("28") }),
      purchaseLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50"), taxAmount: Money.fromMajor("10") }),
    ]);
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(doc, undefined);

    expect(posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inputTaxPayableId)).toHaveLength(1);
    expect(posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inventoryAccountId)).toHaveLength(1);
  });
});
