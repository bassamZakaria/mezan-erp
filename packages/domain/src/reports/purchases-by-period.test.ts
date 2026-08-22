import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createPurchasesByPeriodReport } from "./purchases-by-period.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    itemId: "item-1",
    description: null,
    kind: "inventory",
    qty: Qty.fromMajor("1"),
    unitCost: Money.fromMajor("100.00"),
    taxRatePercent: 0,
    ...overrides,
  };
}

function pinvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pinv-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-10",
    dueDate: "2026-09-10",
    supplierInvoiceNumber: null,
    branchId: "br-1",
    warehouseId: "wh-1",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [pline()],
    status: "confirmed",
    createdBy: "system",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("createPurchasesByPeriodReport", () => {
  it("aggregates confirmed invoices by day (subtotal/tax/net)", () => {
    const definition = createPurchasesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      {
        invoices: [
          pinvoice({ id: "p1", lines: [pline({ taxRatePercent: 14, qty: Qty.fromMajor("2") })] }),
          pinvoice({ id: "p2", lines: [pline({ qty: Qty.fromMajor("1") })] }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.count).toBe(2);
    expect(outcome.rows[0]?.gross).toBe(300);
    expect(outcome.rows[0]?.tax).toBe(28);
    expect(outcome.rows[0]?.net).toBe(328);
  });

  it("ignores draft and cancelled purchase invoices", () => {
    const definition = createPurchasesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      { invoices: [pinvoice({ status: "draft" }), pinvoice({ id: "p2", status: "cancelled" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("includes freight/expense lines in the gross total", () => {
    const definition = createPurchasesByPeriodReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31", groupBy: "day" },
      { invoices: [pinvoice({ lines: [pline({ qty: Qty.fromMajor("1") }), pline({ kind: "expense", itemId: null, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00") })] })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.gross).toBe(120);
  });
});
