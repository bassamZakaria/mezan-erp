import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createAgingSuppliersReport } from "./aging-suppliers.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { itemId: "item-1", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("300.00"), taxRatePercent: 0, ...overrides };
}
function pinvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pinv-1", number: "PI-1", supplierId: "sup-1", date: "2026-06-01", dueDate: "2026-06-15", supplierInvoiceNumber: null, branchId: "br-1",
    warehouseId: "wh-1", currency: "EGP", notes: null, receiptId: null, lines: [pline()], status: "confirmed", createdBy: "system", createdAt: "2026-06-01T00:00:00.000Z", ...overrides,
  };
}
function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return { id: "sup-1", code: "S001", nameAr: "مورد أ", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: Money.zero(), branchId: null, active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null, ...overrides };
}

describe("createAgingSuppliersReport", () => {
  it("treats the full invoice total as outstanding (no payment tracking)", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [pinvoice()], suppliers: [supplier()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.current).toBe(300);
    expect(outcome.rows[0]?.total).toBe(300);
  });

  it("falls back to the invoice date when dueDate is null", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" }, // 2026-06-01 -> 2026-08-22 = 82 days
      { invoices: [pinvoice({ dueDate: null })], suppliers: [supplier()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.d61to90).toBe(300);
  });

  it("excludes draft purchase invoices", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [pinvoice({ status: "draft" })], suppliers: [supplier()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("resolves the supplier's Arabic name from ctx.suppliers", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [pinvoice()], suppliers: [supplier({ nameAr: "مورد النيل" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.supplierNameAr).toBe("مورد النيل");
  });
});

describe("createAgingSuppliersReport — the tie to the AP control account (D112)", () => {
  const definition = createAgingSuppliersReport("2026-08-22");
  const twoInvoices = [
    pinvoice({ id: "pinv-1", supplierId: "sup-1", lines: [pline({ unitCost: Money.fromMajor("1250.50") })] }),
    pinvoice({ id: "pinv-2", supplierId: "sup-2", lines: [pline({ unitCost: Money.fromMajor("3400.00") })] }),
  ];
  const suppliers = [supplier(), supplier({ id: "sup-2", code: "S002", nameAr: "مورد ب" })];

  it("ties when the ladder and the control account hold the same NON-ZERO balance", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, suppliers, payablesControlBalance: () => 4650.5 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.reportTotal).toBe(4650.5);
    expect(outcome.reconciliation?.referenceTotal).toBe(4650.5);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("flags the difference when a payment reached the GL and not the allocation sub-ledger", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, suppliers, payablesControlBalance: () => 4000 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.diff).toBe(650.5);
    expect(outcome.reconciliation?.withinTolerance).toBe(false);
  });
});
