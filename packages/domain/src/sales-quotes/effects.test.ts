import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { describeQuoteEffects } from "./effects.js";
import { computeQuoteTotals } from "./totals.js";
import type { SalesQuote, SalesQuoteLine } from "./sales-quote.js";

function line(overrides: Partial<SalesQuoteLine> & { lineId: string; itemId: string }): SalesQuoteLine {
  return {
    itemNameAr: overrides.itemId,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("0"),
    discountPercent: 0,
    taxRatePercent: 0,
    ...overrides,
  };
}

function quote(overrides: Partial<SalesQuote> & { lines: SalesQuoteLine[] }): SalesQuote {
  return {
    id: "qt-1",
    docType: "SALES_QUOTE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    expiryDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    customerTaxExempt: false,
    branchId: "BR1",
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    priceListId: null,
    couponCode: null,
    createdAt: "2026-08-22T10:00:00.000Z",
    sentAt: null,
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
    ...overrides,
  };
}

describe("describeQuoteEffects", () => {
  it("blocks a quote with no lines", () => {
    const q = quote({ lines: [] });
    const totals = computeQuoteTotals(q.lines, q.discount, { taxExempt: q.customerTaxExempt });
    const effects = describeQuoteEffects(q, totals);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("العرض لا يحتوي على بنود.");
  });

  it("blocks a quote whose grand total is zero", () => {
    const lines = [line({ lineId: "L1", itemId: "A", unitPrice: Money.zero() })];
    const q = quote({ lines });
    const totals = computeQuoteTotals(lines, q.discount, { taxExempt: q.customerTaxExempt });
    const effects = describeQuoteEffects(q, totals);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("إجمالي العرض يجب أن يكون أكبر من صفر.");
  });

  it("is not blocked for a quote with a positive total, and states the quoted value and customer", () => {
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100") })];
    const q = quote({ lines, customerNameAr: "شركة النور" });
    const totals = computeQuoteTotals(lines, q.discount, { taxExempt: q.customerTaxExempt });
    const effects = describeQuoteEffects(q, totals);

    expect(effects.blocked).toBe(false);
    const balance = effects.effects.find((e) => e.kind === "balance");
    expect(balance?.description).toBe(`القيمة المعروضة على العميل: ${totals.grandTotal.toString()}`);
    expect(balance?.detail).toBe("شركة النور");
  });

  it("states plainly that a quote moves no stock and changes no balance", () => {
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];
    const q = quote({ lines });
    const totals = computeQuoteTotals(lines, q.discount, { taxExempt: q.customerTaxExempt });
    const info = describeQuoteEffects(q, totals).effects.find((e) => e.kind === "info");
    expect(info?.description).toBe(
      "لا يوجد تأثير على المخزون أو رصيد العميل — العرض لا يغير أي رصيد حتى يتم تحويله لفاتورة",
    );
  });
});
