import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInventorySlowMovingReport } from "./inventory-slow-moving.js";
import type { Item } from "../items/item.js";
import type { WacSnapshot } from "../inventory/ports.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function item(overrides: Partial<Item> = {}): Item {
  return { id: "item-a", code: "SKU-A", nameAr: "صنف أ", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brand: null, costingMethod: "WAC", salePrice: null, costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active", ...overrides } as Item;
}
function snapshot(overrides: Partial<WacSnapshot> = {}): WacSnapshot {
  return { itemId: "item-a", warehouseId: "wh-1", onHand: Qty.fromMajor("10"), totalValue: Money.fromMajor("1000.00"), averageCost: Money.fromMajor("100.00"), ...overrides };
}
function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return { lineId: "l1", itemId: "item-a", itemNameAr: "صنف أ", isStock: true, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("10.00"), discountPercent: 0, taxRatePercent: 0, revenueAccountId: "4100", cogsAccountId: null, inventoryAccountId: null, costCenterId: null, unitCost: null, unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(), ...overrides, baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1") };
}
function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1", docType: "SALES_INVOICE", docNo: "INV-1", status: "confirmed", date: "2026-05-01", dueDate: "2026-05-10", customerId: "c1", customerNameAr: "عميل",
    customerTaxExempt: false, taxInclusive: false, warehouseId: "wh-1", branchId: "br-1", salespersonId: null, salespersonNameAr: null, couponCode: null, appliedPromotion: null, currency: "EGP", notes: null, internalNotes: null, discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120", taxAccountId: "2200", lines: [line()], amountPaid: Money.zero(), createdAt: "2026-05-01T00:00:00.000Z", confirmedAt: "2026-05-01T00:00:00.000Z",
    journalEntryId: null, workflowRequestId: null, reversesInvoiceId: null, reversedByInvoiceId: null, ...overrides,
  };
}

const baseParams = { severity: "" as const, search: "", daysSinceLastSale: 90, warehouseId: "" };

describe("createInventorySlowMovingReport", () => {
  it("marks an item with no sales history ever as critical with a null last-sale date", () => {
    const definition = createInventorySlowMovingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items: [item()], snapshots: [snapshot()], invoices: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.lastSaleDate).toBeNull();
    expect(outcome.rows[0]?.severityLabel).toBe("حرج");
  });

  it("computes days-since-last-sale from the most recent confirmed invoice", () => {
    // 2026-05-01 -> 2026-08-22 = 113 days
    const definition = createInventorySlowMovingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items: [item()], snapshots: [snapshot()], invoices: [invoice()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.daysSinceLastSale).toBe(113);
    expect(outcome.rows[0]?.severityLabel).toBe("خفيف"); // 113 < 180 -> light
  });

  it("excludes an item sold within the days-since-last-sale threshold", () => {
    const definition = createInventorySlowMovingReport("2026-08-22");
    const outcome = runReport(definition, baseParams, { items: [item()], snapshots: [snapshot()], invoices: [invoice({ date: "2026-08-20" })] }); // 2 days ago
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("uses the LATEST of multiple sales, not the first", () => {
    const definition = createInventorySlowMovingReport("2026-08-22");
    const outcome = runReport(
      definition,
      { ...baseParams, daysSinceLastSale: 0 },
      { items: [item()], snapshots: [snapshot()], invoices: [invoice({ id: "old", date: "2026-01-01" }), invoice({ id: "recent", date: "2026-08-01" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.lastSaleDate).toBe("2026-08-01");
  });

  it("filters by severity param — a medium-severity item is excluded when only 'critical' is requested", () => {
    const definition = createInventorySlowMovingReport("2026-08-22");
    // last sale 2026-02-01 -> 202 days ago (medium: 180 <= days < 365)
    const outcome = runReport(
      definition,
      { ...baseParams, severity: "critical", daysSinceLastSale: 0 },
      { items: [item()], snapshots: [snapshot()], invoices: [invoice({ date: "2026-02-01" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });
});
