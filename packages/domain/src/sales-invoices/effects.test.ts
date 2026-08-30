import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { describeSalesInvoiceEffects } from "./effects.js";
import { computeInvoiceTotals } from "./totals.js";
import type { SalesInvoice, SalesInvoiceLine } from "./sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> & { lineId: string; itemId: string }): SalesInvoiceLine {
  return {
    itemNameAr: overrides.itemId,
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("0"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4000",
    cogsAccountId: "5000",
    inventoryAccountId: "1200",
    unitCost: null,
    unitCode: "",
    unitFactor: 1,
    discountType: "percent" as const,
    discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function invoice(overrides: Partial<SalesInvoice> & { lines: SalesInvoiceLine[] }): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "WH1",
    branchId: "BR1",
    salespersonId: null,
    salespersonNameAr: null,
    currency: "EGP",
    couponCode: null,
    appliedPromotion: null,
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1300",
    taxAccountId: "2200",
    amountPaid: Money.zero(),
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

describe("describeSalesInvoiceEffects", () => {
  it("blocks an invoice with no lines", () => {
    const inv = invoice({ lines: [] });
    const totals = computeInvoiceTotals(inv.lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const effects = describeSalesInvoiceEffects(inv, totals);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("الفاتورة لا تحتوي على بنود.");
  });

  it("blocks an invoice whose grand total is zero", () => {
    const lines = [line({ lineId: "L1", itemId: "A", unitPrice: Money.zero() })];
    const inv = invoice({ lines });
    const totals = computeInvoiceTotals(lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const effects = describeSalesInvoiceEffects(inv, totals);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("إجمالي الفاتورة يجب أن يكون أكبر من صفر.");
  });

  it("describes stock movement in base units for a mixed stock/service invoice", () => {
    const lines = [
      line({ lineId: "L1", itemId: "A", isStock: true, qty: Qty.fromMajor("5"), baseQty: Qty.fromMajor("60"), unitPrice: Money.fromMajor("10") }),
      line({ lineId: "L2", itemId: "S1", isStock: false, unitPrice: Money.fromMajor("50"), revenueAccountId: "4000" }),
    ];
    const inv = invoice({ lines });
    const totals = computeInvoiceTotals(lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const effects = describeSalesInvoiceEffects(inv, totals);

    expect(effects.blocked).toBe(false);
    const stockEffect = effects.effects.find((e) => e.kind === "stock");
    expect(stockEffect?.description).toBe("خصم المخزون وتسجيل تكلفة البضاعة المباعة لعدد 1 صنف");
    expect(stockEffect?.detail).toContain("60.000000");
  });

  it("states no stock moves when every line is a service", () => {
    const lines = [line({ lineId: "L1", itemId: "S1", isStock: false, unitPrice: Money.fromMajor("100") })];
    const inv = invoice({ lines });
    const totals = computeInvoiceTotals(lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const effects = describeSalesInvoiceEffects(inv, totals);
    const stockEffect = effects.effects.find((e) => e.kind === "stock");
    expect(stockEffect?.description).toBe("لا يتحرك المخزون — كل البنود خدمية");
    expect(stockEffect?.detail).toBeUndefined();
  });

  it("mentions VAT in the GL effect only when tax is non-zero", () => {
    const withTax = [line({ lineId: "L1", itemId: "A", isStock: false, unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })];
    const invWithTax = invoice({ lines: withTax });
    const totalsWithTax = computeInvoiceTotals(withTax, invWithTax.discount, { taxExempt: invWithTax.customerTaxExempt });
    const glWithTax = describeSalesInvoiceEffects(invWithTax, totalsWithTax).effects.find((e) => e.kind === "gl");
    expect(glWithTax?.description).toContain("ضريبة القيمة المضافة");
    expect(glWithTax?.detail).toContain("ضريبة");

    const noTax = [line({ lineId: "L1", itemId: "A", isStock: false, unitPrice: Money.fromMajor("100"), taxRatePercent: 0 })];
    const invNoTax = invoice({ lines: noTax });
    const totalsNoTax = computeInvoiceTotals(noTax, invNoTax.discount, { taxExempt: invNoTax.customerTaxExempt });
    const glNoTax = describeSalesInvoiceEffects(invNoTax, totalsNoTax).effects.find((e) => e.kind === "gl");
    expect(glNoTax?.description).not.toContain("ضريبة القيمة المضافة");
    expect(glNoTax?.detail).not.toContain("ضريبة");
  });

  it("states the balance card names the customer and warns collection is not automatic", () => {
    const lines = [line({ lineId: "L1", itemId: "A", isStock: false, unitPrice: Money.fromMajor("100") })];
    const inv = invoice({ lines, customerNameAr: "شركة النور" });
    const totals = computeInvoiceTotals(lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const balance = describeSalesInvoiceEffects(inv, totals).effects.find((e) => e.kind === "balance");
    expect(balance?.description).toBe(`زيادة رصيد العميل (المدينون) بمبلغ ${totals.grandTotal.toString()}`);
    expect(balance?.detail).toBe("شركة النور — لا يتم التحصيل تلقائياً؛ استخدم سند تحصيل لتسجيل دفعة");
  });

  it("reports totalDebit and totalCredit equal to the grand total, balanced", () => {
    const lines = [line({ lineId: "L1", itemId: "A", isStock: false, unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })];
    const inv = invoice({ lines });
    const totals = computeInvoiceTotals(lines, inv.discount, { taxExempt: inv.customerTaxExempt });
    const effects = describeSalesInvoiceEffects(inv, totals);
    expect(effects.totalDebit.toString()).toBe(totals.grandTotal.toString());
    expect(effects.totalCredit.toString()).toBe(totals.grandTotal.toString());
    expect(effects.balanced).toBe(true);
  });
});
