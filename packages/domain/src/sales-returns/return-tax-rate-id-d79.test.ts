import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { FrameworkDocument } from "../documents/document.js";
import { buildSalesReturnLinesFromInvoice } from "./from-invoice.js";
import { createSalesReturnDocumentType, type SalesReturnLine } from "./sales-return-document.js";
import type { SourceSalesInvoice } from "./ports.js";
import { buildPurchaseReturnLinesFromInvoice } from "../purchase-returns/from-invoice.js";
import { createPurchaseReturnDocumentType, type PurchaseReturnLine } from "../purchase-returns/purchase-return-document.js";
import type { SourcePurchaseInvoice } from "../purchase-returns/ports.js";

/**
 * D79 on the return side. A return is the mirror of the invoice line it
 * reverses, so it carries that line's tax rate id: an exempt line that comes
 * back is still exempt, never the 0% rate that happened to be defined first.
 */

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

function documentOf<L>(docType: string, lines: readonly L[]): FrameworkDocument<L> {
  return {
    id: "RET-1",
    docType,
    docNo: "RET-000001",
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
  } as FrameworkDocument<L>;
}

const salesInvoice: SourceSalesInvoice = {
  id: "INV1",
  number: "INV-000014",
  customerId: "CUST1",
  warehouseId: "WH1",
  date: "2026-08-20",
  status: "confirmed",
  lines: [
    { itemId: "EXEMPT-ITEM", itemName: "معفى", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("20"), unitCost: Money.zero(), taxAmount: Money.zero(), taxRatePercent: 0, taxRateId: "VAT-EXEMPT" },
    { itemId: "EXPORT-ITEM", itemName: "تصدير", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("30"), unitCost: Money.zero(), taxAmount: Money.zero(), taxRatePercent: 0, taxRateId: "VAT-EXPORT" },
    { itemId: "LEGACY-ITEM", itemName: "قديم", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("40"), unitCost: Money.zero(), taxAmount: Money.zero(), taxRatePercent: 0 },
  ],
};

describe("a sales return inherits the tax rate id of the invoice line it reverses (D79)", () => {
  const lines: SalesReturnLine[] = buildSalesReturnLinesFromInvoice(salesInvoice, "WH1", "DEFECTIVE", [
    { itemId: "EXEMPT-ITEM", qty: Qty.fromMajor("1") },
    { itemId: "EXPORT-ITEM", qty: Qty.fromMajor("2") },
    { itemId: "LEGACY-ITEM", qty: Qty.fromMajor("3") },
  ]);

  it("copies each invoice line's rate id onto its return line, and leaves a legacy line without one", () => {
    expect(lines.map((l) => [l.itemId, l.taxRateId])).toEqual([
      ["EXEMPT-ITEM", "VAT-EXEMPT"],
      ["EXPORT-ITEM", "VAT-EXPORT"],
      ["LEGACY-ITEM", null],
    ]);
  });

  it("posts one returns-revenue debit per stored rate, so the three 0% bases never blend", () => {
    const posting = createSalesReturnDocumentType(SALES_ACCOUNTS).buildGlPosting!(documentOf("SALES_RETURN", lines), undefined);
    const revenue = posting!.lines.filter((l) => l.accountId === SALES_ACCOUNTS.salesReturnsAccountId);
    expect(revenue.map((l) => [l.taxRateId ?? null, l.taxRatePercent, l.debit.toString()])).toEqual([
      ["VAT-EXEMPT", 0, "20.000000"],
      ["VAT-EXPORT", 0, "60.000000"],
      [null, 0, "120.000000"],
    ]);
    const debit = Money.sum(posting!.lines.map((l) => l.debit));
    const credit = Money.sum(posting!.lines.map((l) => l.credit));
    expect(debit.equals(credit)).toBe(true);
  });
});

const purchaseInvoice: SourcePurchaseInvoice = {
  id: "PI1",
  number: "PI-000003",
  supplierId: "SUP1",
  warehouseId: "WH1",
  date: "2026-08-20",
  status: "confirmed",
  lines: [
    { itemId: "TAXED", itemName: "خاضع", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("100"), taxAmount: Money.fromMajor("140"), taxRatePercent: 14, taxRateId: "VAT14" },
    { itemId: "LEGACY", itemName: "قديم", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("50"), taxAmount: Money.fromMajor("70"), taxRatePercent: 14 },
  ],
};

describe("a purchase return inherits the tax rate id of the invoice line it reverses (D79)", () => {
  const lines: PurchaseReturnLine[] = buildPurchaseReturnLinesFromInvoice(purchaseInvoice, "WH1", "DEFECTIVE", [
    { itemId: "TAXED", qty: Qty.fromMajor("1") },
    { itemId: "LEGACY", qty: Qty.fromMajor("1") },
  ]);

  it("copies the rate id, and leaves a legacy line without one", () => {
    expect(lines.map((l) => [l.itemId, l.taxRateId])).toEqual([
      ["TAXED", "VAT14"],
      ["LEGACY", null],
    ]);
  });

  it("tags the input-VAT credit and the inventory relief with the stored rate, apart from the legacy line of the same percent", () => {
    const posting = createPurchaseReturnDocumentType(PURCHASE_ACCOUNTS).buildGlPosting!(documentOf("PURCHASE_RETURN", lines), undefined);
    const vat = posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inputTaxPayableId);
    expect(vat.map((l) => [l.taxRateId ?? null, l.taxRatePercent, l.credit.toString()])).toEqual([
      ["VAT14", 14, "14.000000"],
      [null, 14, "7.000000"],
    ]);
    const inventory = posting!.lines.filter((l) => l.accountId === PURCHASE_ACCOUNTS.inventoryAccountId);
    expect(inventory.map((l) => [l.taxRateId ?? null, l.credit.toString()])).toEqual([
      ["VAT14", "100.000000"],
      [null, "50.000000"],
    ]);
    const debit = Money.sum(posting!.lines.map((l) => l.debit));
    const credit = Money.sum(posting!.lines.map((l) => l.credit));
    expect(debit.equals(credit)).toBe(true);
  });
});
