import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createPurchasesBySupplierReport } from "./purchases-by-supplier.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { itemId: "item-1", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100.00"), taxRatePercent: 0, ...overrides };
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

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup-1",
    code: "S001",
    nameAr: "مورد أ",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: Money.zero(),
    branchId: null,
    active: true,
    addressCity: null,
    addressDistrict: null,
    addressStreet: null,
    bankAccount: null,
    ...overrides,
  };
}

describe("createPurchasesBySupplierReport", () => {
  it("aggregates total per supplier and treats the full total as outstanding (no payment tracking)", () => {
    const definition = createPurchasesBySupplierReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [pinvoice({ id: "p1", supplierId: "sup-1", lines: [pline({ qty: Qty.fromMajor("3") })] })],
        suppliers: [supplier()],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.supplierNameAr).toBe("مورد أ");
    expect(outcome.rows[0]?.total).toBe(300);
    expect(outcome.rows[0]?.outstanding).toBe(300);
  });

  it("computes contribution % across two suppliers and sorts by total descending", () => {
    const definition = createPurchasesBySupplierReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [
          pinvoice({ id: "p1", supplierId: "sup-1", lines: [pline({ qty: Qty.fromMajor("3") })] }),
          pinvoice({ id: "p2", supplierId: "sup-2", lines: [pline({ qty: Qty.fromMajor("1") })] }),
        ],
        suppliers: [supplier({ id: "sup-1", nameAr: "مورد أ" }), supplier({ id: "sup-2", code: "S002", nameAr: "مورد ب" })],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.supplierId)).toEqual(["sup-1", "sup-2"]);
    expect(outcome.rows[0]?.contributionPercent).toBe(75);
  });

  it("excludes draft purchase invoices", () => {
    const definition = createPurchasesBySupplierReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      { invoices: [pinvoice({ status: "draft" })], suppliers: [supplier()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });
});
