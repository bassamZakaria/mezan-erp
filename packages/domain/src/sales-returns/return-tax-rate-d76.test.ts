/**
 * D76 — a confirmed RETURN aggregates every line tax into ONE untagged journal
 * line, so the per-line taxRatePercent D28 added to invoices does not extend to
 * returns and the VAT return (إقرار القيمة المضافة) cannot split a mixed-rate
 * return by rate.
 *
 * These tests PIN the broken behaviour. When D76 is closed they must be
 * rewritten to assert one tagged tax line per rate.
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

describe("LIMITATION (D76): a mixed-rate sales return posts one untagged VAT line", () => {
  /**
   * Two lines off the SAME invoice at two different rates:
   *   A: 2 x 100.00 standard-rated at 14% -> 28.00 tax
   *   B: 4 x 50.00 reduced-rated at 5%   -> 10.00 tax
   * The books should be able to say 28.00 came back at 14% and 10.00 at 5%.
   */
  const lines = [
    salesLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100"), unitCost: Money.fromMajor("60"), taxAmount: Money.fromMajor("28") }),
    salesLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitPrice: Money.fromMajor("50"), unitCost: Money.fromMajor("30"), taxAmount: Money.fromMajor("10") }),
  ];

  it("collapses both rates into a single 38.00 output-tax line with no rate on it", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const taxLines = posting!.lines.filter((l) => l.accountId === SALES_ACCOUNTS.outputTaxPayableAccountId);

    expect(taxLines).toHaveLength(1);
    expect(taxLines[0]!.debit.toString()).toBe("38.000000");
    // The dimension the VAT return needs. Null today: nothing on the posting
    // says which slice of the 38.00 was 14% and which was 5%.
    expect(taxLines[0]!.taxRatePercent ?? null).toBeNull();
  });

  it("leaves the revenue side untagged too, so dividing tax by base invents a rate nobody charged", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const revenueLine = posting!.lines.find((l) => l.accountId === SALES_ACCOUNTS.salesReturnsAccountId);

    expect(revenueLine!.debit.toString()).toBe("400.000000");
    expect(revenueLine!.taxRatePercent ?? null).toBeNull();

    // 38 / 400 = 9.5% — a rate that appears on no line of the source invoice.
    const derived = (38 / 400) * 100;
    expect(derived).toBe(9.5);
  });

  it("cannot be recovered from the document either: a return LINE carries an amount, never a rate", () => {
    const line = lines[0]!;
    expect(Object.keys(line)).not.toContain("taxRatePercent");
    expect(line.taxAmount.toString()).toBe("28.000000");
  });

  it("still posts a balanced entry — D76 is a lost dimension, not a broken entry", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(salesDoc(lines), undefined);
    const debit = Money.sum(posting!.lines.map((l) => l.debit));
    const credit = Money.sum(posting!.lines.map((l) => l.credit));
    expect(debit.toString()).toBe("678.000000");
    expect(credit.toString()).toBe("678.000000");
  });
});

describe("LIMITATION (D76): the purchase-return twin has the same hole", () => {
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

  it("collapses a 14% line and a 5% line into one untagged input-tax credit", () => {
    const doc = purchaseDoc([
      purchaseLine({ itemId: "ITEM-A", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("100"), taxAmount: Money.fromMajor("28") }),
      purchaseLine({ itemId: "ITEM-B", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50"), taxAmount: Money.fromMajor("10") }),
    ]);
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(doc, undefined);
    const taxLines = posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inputTaxPayableId);

    expect(taxLines).toHaveLength(1);
    expect(taxLines[0]!.credit.toString()).toBe("38.000000");
    expect(taxLines[0]!.taxRatePercent ?? null).toBeNull();
  });
});
