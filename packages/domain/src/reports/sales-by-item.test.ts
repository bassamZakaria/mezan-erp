import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createSalesByItemReport } from "./sales-by-item.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "l1",
    itemId: "item-1",
    itemNameAr: "صنف أ",
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100.00"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    costCenterId: null,
    unitCost: null,
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000001",
    status: "confirmed",
    date: "2026-08-10",
    dueDate: "2026-08-20",
    customerId: "cust-1",
    customerNameAr: "عميل",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "br-1",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120",
    taxAccountId: "2200",
    lines: [line()],
    amountPaid: Money.zero(),
    createdAt: "2026-08-10T00:00:00.000Z",
    confirmedAt: "2026-08-10T00:00:00.000Z",
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

describe("createSalesByItemReport", () => {
  it("aggregates qty and revenue per item, with correct contribution percentages", () => {
    const definition = createSalesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [
          invoice({
            id: "i1",
            lines: [line({ itemId: "item-a", itemNameAr: "صنف أ", qty: Qty.fromMajor("3"), unitPrice: Money.fromMajor("100.00") })],
          }),
          invoice({
            id: "i2",
            lines: [line({ itemId: "item-b", itemNameAr: "صنف ب", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100.00") })],
          }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(2);
    const a = outcome.rows.find((r) => r.itemId === "item-a")!;
    const b = outcome.rows.find((r) => r.itemId === "item-b")!;
    expect(a.qty).toBe(3);
    expect(a.revenue).toBe(300);
    expect(b.revenue).toBe(100);
    expect(a.contributionPercent).toBe(75);
    expect(b.contributionPercent).toBe(25);
  });

  it("sums multiple lines for the same item across different invoices", () => {
    const definition = createSalesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [
          invoice({ id: "i1", lines: [line({ itemId: "item-a", qty: Qty.fromMajor("2") })] }),
          invoice({ id: "i2", lines: [line({ itemId: "item-a", qty: Qty.fromMajor("5") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.qty).toBe(7);
  });

  it("excludes cancelled/reversed invoices from the aggregate", () => {
    const definition = createSalesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      { invoices: [invoice({ id: "i1", status: "reversed" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("applies line-level discount before computing revenue", () => {
    const definition = createSalesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      { invoices: [invoice({ lines: [line({ qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100.00"), discountPercent: 10 })] })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.revenue).toBe(90);
  });
});
