import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createTopProductsReport } from "./sales-top-products.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "l1",
    itemId: "item-1",
    itemNameAr: "صنف",
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("100.00"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4100",
    cogsAccountId: null,
    inventoryAccountId: null,
    unitCost: null,
    ...overrides,
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

const invoices = [
  invoice({ id: "i1", lines: [line({ itemId: "a", itemNameAr: "أ", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("300.00") })] }),
  invoice({ id: "i2", lines: [line({ itemId: "b", itemNameAr: "ب", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("10.00") })] }),
  invoice({ id: "i3", lines: [line({ itemId: "c", itemNameAr: "ج", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("50.00") })] }),
];

describe("createTopProductsReport", () => {
  it("ranks by revenue descending and assigns 1-based ranks", () => {
    const definition = createTopProductsReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "2026-08-01", dateTo: "2026-08-31", limit: "10", rankBy: "revenue" }, { invoices });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // revenue: a=300 (1×300), b=100 (10×10), c=50 (1×50)
    expect(outcome.rows.map((r) => r.itemId)).toEqual(["a", "b", "c"]);
    expect(outcome.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("ranks by quantity when rankBy=qty", () => {
    const definition = createTopProductsReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "2026-08-01", dateTo: "2026-08-31", limit: "10", rankBy: "qty" }, { invoices });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemId).toBe("b");
    expect(outcome.rows[0]?.qty).toBe(10);
  });

  it("caps the result at `limit` rows", () => {
    const definition = createTopProductsReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "2026-08-01", dateTo: "2026-08-31", limit: "2", rankBy: "revenue" }, { invoices });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(2);
  });

  it("rejects a non-positive limit", () => {
    const definition = createTopProductsReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { dateFrom: "2026-08-01", dateTo: "2026-08-31", limit: "0", rankBy: "revenue" }, { invoices });
    expect(outcome.ok).toBe(false);
  });
});
