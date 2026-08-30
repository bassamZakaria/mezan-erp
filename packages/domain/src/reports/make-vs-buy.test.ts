import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createMakeVsBuyReport } from "./make-vs-buy.js";
import type { Item } from "../items/item.js";
import type { Bom, BomLine } from "../manufacturing/index.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "fin-1",
    code: "SHIRT-1",
    nameAr: "قميص",
    nameEn: null,
    type: "finished_good",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    description: null,
    defaultSupplierId: null,
    seasonId: null,
    specifications: [],
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
  };
}

function bomLine(overrides: Partial<BomLine> = {}): BomLine {
  return { itemId: "raw-1", qty: Qty.fromMajor("5"), wastePercent: 0, optional: false, notes: null, ...overrides };
}

function bom(overrides: Partial<Bom> = {}): Bom {
  return {
    id: "bom-1",
    number: "BOM-000001",
    productItemId: "fin-1",
    version: 1,
    standardQty: Qty.fromMajor("10"),
    unit: "PCS",
    laborCost: Money.fromMajor("50.00"),
    overheadCost: Money.fromMajor("30.00"),
    versionNotes: null,
    lines: [bomLine()],
    status: "active",
    custom: false,
    createdBy: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return {
    itemId: "raw-1",
    description: null,
    kind: "inventory",
    qty: Qty.fromMajor("1"),
    unitCost: Money.fromMajor("10.00"),
    taxRatePercent: 0,
    ...overrides,
  };
}

function invoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pinv-1",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-01",
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
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseParams = { search: "" };

describe("createMakeVsBuyReport", () => {
  it("computes the weighted-average make cost and buy cost, and picks the cheaper side", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom()],
      purchaseInvoices: [
        // raw-1 weighted-average purchase cost: (4×3.00 + 6×5.00) / (4+6) = 42.00/10 = 4.20
        invoice({ id: "pi-raw-a", lines: [pline({ qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("3.00") })] }),
        invoice({ id: "pi-raw-b", lines: [pline({ qty: Qty.fromMajor("6"), unitCost: Money.fromMajor("5.00") })] }),
        // fin-1 weighted-average purchase cost: (10×100.00 + 5×130.00) / 15 = 1650.00/15 = 110.00
        invoice({ id: "pi-fin-a", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("100.00") })] }),
        invoice({ id: "pi-fin-b", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("130.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Hand-computed independently of the report:
    // material cost = effective qty (5) × raw-1 unit cost (4.20) = 21.00
    // total cost = material (21.00) + labor (50.00) + overhead (30.00) = 101.00
    // make cost = total cost (101.00) ÷ standard qty (10) = 10.10
    const expectedMakeCost = 10.1;
    const expectedBuyCost = 110.0;
    const expectedDiff = expectedBuyCost - expectedMakeCost; // 99.90

    expect(outcome.rows).toHaveLength(1);
    const row = outcome.rows[0];
    expect(row?.itemId).toBe("fin-1");
    expect(row?.itemCode).toBe("SHIRT-1");
    expect(row?.itemNameAr).toBe("قميص");
    expect(row?.bomNumber).toBe("BOM-000001");
    expect(row?.makeCost).toBe(expectedMakeCost);
    expect(row?.buyCost).toBe(expectedBuyCost);
    expect(row?.diff).toBe(expectedDiff);
    expect(row?.verdict).toBe("make");
    expect(row?.verdictLabel).toBe("التصنيع أرخص");
  });

  it("picks 'buy' when the purchase cost is below the manufacturing cost", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom({ laborCost: Money.fromMajor("0.00"), overheadCost: Money.fromMajor("0.00") })],
      purchaseInvoices: [
        // raw-1 avg = 20.00 → material = 5 × 20.00 = 100.00, make cost = 100.00/10 = 10.00
        invoice({ id: "pi-raw", lines: [pline({ qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00") })] }),
        // fin-1 avg = 3.00, well below 10.00
        invoice({ id: "pi-fin", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("3.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.makeCost).toBe(10.0);
    expect(outcome.rows[0]?.buyCost).toBe(3.0);
    expect(outcome.rows[0]?.diff).toBe(-7.0);
    expect(outcome.rows[0]?.verdict).toBe("buy");
    expect(outcome.rows[0]?.verdictLabel).toBe("الشراء أرخص");
  });

  it("only CONFIRMED purchase invoices count toward buy cost or component cost", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom({ laborCost: Money.fromMajor("0.00"), overheadCost: Money.fromMajor("0.00") })],
      purchaseInvoices: [
        invoice({ id: "pi-raw", lines: [pline({ qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00") })] }),
        invoice({ id: "pi-fin", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("3.00") })] }),
        // A draft invoice at a wildly different price must not shift the raw-1 average.
        invoice({
          id: "pi-raw-draft",
          status: "draft",
          lines: [pline({ qty: Qty.fromMajor("1000"), unitCost: Money.fromMajor("0.01") })],
        }),
        // A cancelled invoice at a wildly different price must not shift the fin-1 average.
        invoice({
          id: "pi-fin-cancelled",
          status: "cancelled",
          lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("1000"), unitCost: Money.fromMajor("999.00") })],
        }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    // Same figures as the "buy" test above — the draft/cancelled invoices changed nothing.
    expect(outcome.rows[0]?.makeCost).toBe(10.0);
    expect(outcome.rows[0]?.buyCost).toBe(3.0);
  });

  it("verdict is 'tie' when buy cost exactly equals make cost", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [
        bom({
          standardQty: Qty.fromMajor("10"),
          laborCost: Money.fromMajor("0.00"),
          overheadCost: Money.fromMajor("0.00"),
          lines: [bomLine({ itemId: "raw-1", qty: Qty.fromMajor("10"), wastePercent: 0 })],
        }),
      ],
      purchaseInvoices: [
        // raw-1 avg = 5.00 → material = 10 × 5.00 = 50.00, make cost = 50.00 / 10 = 5.00
        invoice({ id: "pi-raw", lines: [pline({ qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5.00") })] }),
        // fin-1 avg = 5.00 exactly
        invoice({ id: "pi-fin", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("20"), unitCost: Money.fromMajor("5.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.makeCost).toBe(5.0);
    expect(outcome.rows[0]?.buyCost).toBe(5.0);
    expect(outcome.rows[0]?.diff).toBe(0);
    expect(outcome.rows[0]?.verdict).toBe("tie");
    expect(outcome.rows[0]?.verdictLabel).toBe("متعادل");
  });

  it("buy cost is null (not zero) for an item never purchased itself, forcing an 'unknown' verdict even though make cost is known", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom()],
      purchaseInvoices: [
        // Only the component was ever purchased — fin-1 itself never was.
        invoice({ id: "pi-raw", lines: [pline({ qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("4.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.makeCost).not.toBeNull();
    expect(outcome.rows[0]?.buyCost).toBeNull();
    expect(outcome.rows[0]?.diff).toBeNull();
    expect(outcome.rows[0]?.verdict).toBe("unknown");
    expect(outcome.rows[0]?.verdictLabel).toBe("بيانات غير كافية");
  });

  it("make cost is null (never treats a missing component as free) when a BOM component was never purchased", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom()],
      purchaseInvoices: [
        // fin-1 itself was purchased, but raw-1 (the only BOM component) never was.
        invoice({ id: "pi-fin", lines: [pline({ itemId: "fin-1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("50.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.makeCost).toBeNull();
    expect(outcome.rows[0]?.buyCost).toBe(50.0);
    expect(outcome.rows[0]?.diff).toBeNull();
    expect(outcome.rows[0]?.verdict).toBe("unknown");
  });

  it("excludes an item with no active BOM entirely", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [],
      purchaseInvoices: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes a non-active BOM (inactive superseded version)", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom({ status: "inactive" })],
      purchaseInvoices: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes a custom (ad-hoc) BOM even when active", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item()],
      boms: [bom({ custom: true })],
      purchaseInvoices: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("excludes an item whose type does not track stock, even with an active BOM and known costs", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [item({ id: "svc-1", code: "SVC-1", nameAr: "خدمة", type: "service" })],
      boms: [bom({ productItemId: "svc-1" })],
      purchaseInvoices: [
        invoice({ id: "pi-raw", lines: [pline({ qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("4.00") })] }),
        invoice({ id: "pi-svc", lines: [pline({ itemId: "svc-1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("50.00") })] }),
      ],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("sorts rows by itemNameAr using Arabic collation", () => {
    const definition = createMakeVsBuyReport();
    const outcome = runReport(definition, baseParams, {
      items: [
        item({ id: "item-b", code: "B-1", nameAr: "برتقال" }),
        item({ id: "item-a", code: "A-1", nameAr: "أرز" }),
      ],
      boms: [
        bom({ id: "bom-b", number: "BOM-000002", productItemId: "item-b" }),
        bom({ id: "bom-a", number: "BOM-000001", productItemId: "item-a" }),
      ],
      purchaseInvoices: [],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.itemNameAr)).toEqual(["أرز", "برتقال"]);
  });

  it("search matches by name or code, case-insensitively, and an unmatched search returns no rows", () => {
    const definition = createMakeVsBuyReport();
    const ctx = {
      items: [
        item({ id: "item-b", code: "ORANGE-02", nameAr: "برتقال" }),
        item({ id: "item-a", code: "RICE-01", nameAr: "أرز" }),
      ],
      boms: [
        bom({ id: "bom-b", number: "BOM-000002", productItemId: "item-b" }),
        bom({ id: "bom-a", number: "BOM-000001", productItemId: "item-a" }),
      ],
      purchaseInvoices: [],
    };

    const byCode = runReport(definition, { search: "rice" }, ctx);
    expect(byCode.ok).toBe(true);
    if (byCode.ok) expect(byCode.rows.map((r) => r.itemId)).toEqual(["item-a"]);

    const byName = runReport(definition, { search: "برتقال" }, ctx);
    expect(byName.ok).toBe(true);
    if (byName.ok) expect(byName.rows.map((r) => r.itemId)).toEqual(["item-b"]);

    const noMatch = runReport(definition, { search: "xyz-nope" }, ctx);
    expect(noMatch.ok).toBe(true);
    if (noMatch.ok) expect(noMatch.rows).toHaveLength(0);
  });
});
