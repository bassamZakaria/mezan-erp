// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ItemDTO, TaxRateDTO } from "@mezan/contracts";
import type { SalesQuoteRecord } from "../../data/hooks";
import { blankLine, daysExpired, isExpired, previewTotals, toDomainDiscount, toDomainLines } from "./quote-model";

function quote(overrides: Partial<SalesQuoteRecord> = {}): SalesQuoteRecord {
  return {
    id: "q-1",
    docType: "SALES_QUOTE",
    docNo: "SQ-000001",
    status: "sent",
    date: "2026-08-01",
    expiryDate: "2026-08-15",
    customerId: "cust-1",
    customerNameAr: "عميل تجريبي",
    branchId: "MAIN",
    currency: "EGP",
    customerTaxExempt: false,
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    priceListId: null,
    couponCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    sentAt: "2026-08-01T00:00:00.000Z",
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
    lines: [],
    totals: { grossTotal: "0", lineDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "0", taxableTotal: "0", taxTotal: "0", grandTotal: "0" },
    ...overrides,
  };
}

describe("isExpired", () => {
  it("is true only for sent/accepted quotes past their expiry date", () => {
    expect(isExpired(quote({ status: "sent", expiryDate: "2026-08-01" }), "2026-08-02")).toBe(true);
    expect(isExpired(quote({ status: "accepted", expiryDate: "2026-08-01" }), "2026-08-02")).toBe(true);
  });

  it("is false for draft/rejected/converted/cancelled quotes regardless of date", () => {
    for (const status of ["draft", "rejected", "converted", "cancelled"] as const) {
      expect(isExpired(quote({ status, expiryDate: "2026-08-01" }), "2026-08-02")).toBe(false);
    }
  });

  it("is not expired on the boundary — expiryDate === asOf", () => {
    expect(isExpired(quote({ status: "sent", expiryDate: "2026-08-01" }), "2026-08-01")).toBe(false);
  });
});

describe("daysExpired", () => {
  it("counts the days past the expiry date", () => {
    expect(daysExpired(quote({ expiryDate: "2026-08-01" }), "2026-08-06")).toBe(5);
  });

  it("never returns a negative number, even before expiry", () => {
    expect(daysExpired(quote({ expiryDate: "2026-08-10" }), "2026-08-06")).toBe(0);
  });
});

const items: ItemDTO[] = [
  {
    id: "item-1", code: "ITM-1", nameAr: "صنف واحد", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC",
    salePrice: "50.000000", costPrice: "30.000000", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false,
    reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const taxRate = (id: string, rate: number, etaSubType: TaxRateDTO["etaSubType"]): TaxRateDTO => ({
  id, code: id, name: id, rate, calculationType: "exclusive", isDefault: false,
  outputTaxAccountId: null, inputTaxAccountId: null, etaSubType, status: "active",
});
const taxRates: TaxRateDTO[] = [taxRate("VAT14", 14, "auto"), taxRate("EXEMPT", 0, "V003"), taxRate("EXPORT", 0, "V001")];

describe("toDomainLines", () => {
  it("drops a line whose itemId does not match any known item", () => {
    const lines = toDomainLines([{ key: "l1", itemId: "missing-item", qty: 1, unitPrice: null, discountPercent: 0, taxRateId: "", expanded: false }], items, taxRates);
    expect(lines).toHaveLength(0);
  });

  it("falls back to the item's own sale price and tax percent when the line picks no rate, and names none", () => {
    const [line] = toDomainLines([{ key: "l1", itemId: "item-1", qty: 2, unitPrice: null, discountPercent: 5, taxRateId: "", expanded: false }], items, taxRates);
    expect(line!.unitPrice.toString()).toBe("50.000000");
    expect(line!.taxRatePercent).toBe(14);
    expect(line!.taxRateId).toBeNull();
    expect(line!.qty.toString()).toBe("2.000000");
    expect(line!.discountPercent).toBe(5);
  });

  it("keeps an explicit unit price, and prices the line at the PICKED rate's percent rather than the item's", () => {
    const [line] = toDomainLines([{ key: "l1", itemId: "item-1", qty: 1, unitPrice: 75, discountPercent: 0, taxRateId: "EXEMPT", expanded: false }], items, taxRates);
    expect(line!.unitPrice.toString()).toBe("75.000000");
    expect(line!.taxRatePercent).toBe(0);
    expect(line!.taxRateId).toBe("EXEMPT");
  });
});

describe("toDomainDiscount", () => {
  it("builds a percent discount, defaulting a falsy value to 0", () => {
    expect(toDomainDiscount("percent", 10)).toEqual({ type: "percent", percent: 10 });
    expect(toDomainDiscount("percent", 0)).toEqual({ type: "percent", percent: 0 });
    expect(toDomainDiscount("percent", NaN)).toEqual({ type: "percent", percent: 0 });
  });

  it("builds an amount discount as a real Money value, defaulting a falsy value to 0", () => {
    const discount = toDomainDiscount("amount", 25);
    expect(discount.type).toBe("amount");
    expect(discount.type === "amount" && discount.amount.toString()).toBe("25.000000");
    const zero = toDomainDiscount("amount", 0);
    expect(zero.type === "amount" && zero.amount.toString()).toBe("0.000000");
  });
});

describe("blankLine", () => {
  it("returns a fresh, unique key every call, with the expected defaults", () => {
    const a = blankLine();
    const b = blankLine();
    expect(a.key).not.toBe(b.key);
    expect(a.expanded).toBe(false);
    expect(a.unitPrice).toBeNull();
    expect(a.discountPercent).toBe(0);
    expect(a.qty).toBe(1);
  });
});

describe("previewTotals", () => {
  it("delegates to the real computeQuoteTotals engine — a percent discount actually reduces the grand total", () => {
    const domainLines = toDomainLines(
      [{ key: "l1", itemId: "item-1", qty: 2, unitPrice: 100, discountPercent: 0, taxRateId: "EXPORT", expanded: false }],
      items,
      taxRates,
    );
    const noDiscount = previewTotals(domainLines, { type: "percent", percent: 0 }, false);
    const withDiscount = previewTotals(domainLines, { type: "percent", percent: 10 }, false);
    expect(noDiscount.grandTotal.toString()).toBe("200.000000");
    expect(Number(withDiscount.grandTotal.toString())).toBeLessThan(Number(noDiscount.grandTotal.toString()));
    expect(withDiscount.grandTotal.toString()).toBe("180.000000");
  });
});
