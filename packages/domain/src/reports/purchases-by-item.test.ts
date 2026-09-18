import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createPurchasesByItemReport } from "./purchases-by-item.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";
import type { Item } from "../items/item.js";

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { itemId: "item-a", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100.00"), taxRatePercent: 0, ...overrides };
}

function pinvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pinv-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-10",
    dueDate: null,
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

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-a",
    code: "SKU-A",
    nameAr: "صنف أ",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  } as Item;
}

describe("createPurchasesByItemReport", () => {
  it("aggregates qty/cost per item and computes cost %", () => {
    const definition = createPurchasesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [
          pinvoice({ id: "p1", lines: [pline({ itemId: "item-a", qty: Qty.fromMajor("3") })] }),
          pinvoice({ id: "p2", lines: [pline({ itemId: "item-b", qty: Qty.fromMajor("1") })] }),
        ],
        items: [item({ id: "item-a", nameAr: "صنف أ" }), item({ id: "item-b", code: "SKU-B", nameAr: "صنف ب" })],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const a = outcome.rows.find((r) => r.itemId === "item-a")!;
    expect(a.qty).toBe(3);
    expect(a.cost).toBe(300);
    expect(a.costPercent).toBe(75);
  });

  it("excludes freight/expense lines (no itemId) from the item breakdown", () => {
    const definition = createPurchasesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [pinvoice({ lines: [pline(), pline({ kind: "expense", itemId: null, unitCost: Money.fromMajor("50.00") })] })],
        items: [item()],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.cost).toBe(100);
  });

  it("falls back to the raw itemId when no matching Item is in ctx", () => {
    const definition = createPurchasesByItemReport("2026-08-01", "2026-08-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      { invoices: [pinvoice({ lines: [pline({ itemId: "unknown-item" })] })], items: [] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.itemNameAr).toBe("unknown-item");
  });
});

describe("createPurchasesByItemReport — a foreign invoice (D201's twin)", () => {
  it("costs a CHF line at the base value the inventory debit posted, so the report still ties to the GL", () => {
    const definition = createPurchasesByItemReport("2026-01-01", "2026-12-31");
    const outcome = runReport(
      definition,
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
      {
        invoices: [pinvoice({ currency: "CHF", fxRate: "60.00", lines: [pline({ itemId: "item-a", qty: Qty.fromMajor("3") })] })],
        items: [item({ id: "item-a", nameAr: "صنف أ" })],
        postedInventory: () => 18000,
      },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows[0]?.cost).toBe(18000);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });
});
