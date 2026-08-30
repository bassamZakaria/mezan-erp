import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { buildSalesReturnLinesFromInvoice } from "./from-invoice.js";
import type { SourceSalesInvoice } from "./ports.js";

function invoice(overrides: Partial<SourceSalesInvoice> = {}): SourceSalesInvoice {
  return {
    id: "INV1",
    number: "INV-000014",
    customerId: "CUST1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed",
    lines: [
      {
        itemId: "ITEM1",
        itemName: "صنف 1",
        qty: Qty.fromMajor("10"),
        alreadyReturnedQty: Qty.zero(),
        unitPrice: Money.fromMajor("20"),
        unitCost: Money.fromMajor("12"),
        taxAmount: Money.fromMajor("28"),
      },
    ],
    ...overrides,
  };
}

describe("buildSalesReturnLinesFromInvoice", () => {
  it("excludes lines with zero or omitted requested qty", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [
      { itemId: "ITEM1", qty: Qty.zero() },
    ]);
    expect(lines).toHaveLength(0);

    const linesOmitted = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "OTHER", []);
    expect(linesOmitted).toHaveLength(0);
  });

  it("computes availableQty as invoiced qty minus already-returned qty, server-side", () => {
    const inv = invoice({
      lines: [
        {
          itemId: "ITEM1",
          itemName: "صنف 1",
          qty: Qty.fromMajor("10"),
          alreadyReturnedQty: Qty.fromMajor("3"),
          unitPrice: Money.fromMajor("20"),
          unitCost: Money.fromMajor("12"),
          taxAmount: Money.fromMajor("28"),
        },
      ],
    });
    const lines = buildSalesReturnLinesFromInvoice(inv, "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("2") },
    ]);
    expect(lines[0]?.availableQty.toString()).toBe("7.000000");
    expect(lines[0]?.qty.toString()).toBe("2.000000");
  });

  it("does not itself cap the requested qty at availableQty (validation does that downstream)", () => {
    const inv = invoice({
      lines: [
        {
          itemId: "ITEM1",
          itemName: "صنف 1",
          qty: Qty.fromMajor("10"),
          alreadyReturnedQty: Qty.fromMajor("9"),
          unitPrice: Money.fromMajor("20"),
          unitCost: Money.fromMajor("12"),
          taxAmount: Money.fromMajor("28"),
        },
      ],
    });
    const lines = buildSalesReturnLinesFromInvoice(inv, "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("5") },
    ]);
    expect(lines[0]?.availableQty.toString()).toBe("1.000000");
    expect(lines[0]?.qty.toString()).toBe("5.000000");
  });

  it("prorates tax exactly for a full-line return (whole invoiced qty)", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("10") },
    ]);
    expect(lines[0]?.taxAmount.toString()).toBe("28.000000");
    expect(lines[0]?.unitPrice.toString()).toBe("20.000000");
    expect(lines[0]?.unitCost.toString()).toBe("12.000000");
  });

  it("prorates tax exactly for a partial return with clean division", () => {
    // 10 units carry 28.00 tax → 4 units carry 4/10 * 28 = 11.20 exactly.
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("4") },
    ]);
    expect(lines[0]?.taxAmount.toString()).toBe("11.200000");
  });

  it("prorates tax with HALF_UP rounding when division is not exact", () => {
    const inv = invoice({
      lines: [
        {
          itemId: "ITEM1",
          itemName: "صنف 1",
          qty: Qty.fromMajor("3"),
          alreadyReturnedQty: Qty.zero(),
          unitPrice: Money.fromMajor("20"),
          unitCost: Money.fromMajor("12"),
          taxAmount: Money.fromMajor("10"),
        },
      ],
    });
    // unitCostOf(10, 3) = 3.333333; extend(1, 3.333333) = 3.333333
    const lines = buildSalesReturnLinesFromInvoice(inv, "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("1") },
    ]);
    expect(lines[0]?.taxAmount.toString()).toBe("3.333333");
  });

  it("falls back to the full line tax when the invoice line's tax amount is zero", () => {
    const inv = invoice({
      lines: [
        {
          itemId: "ITEM1",
          itemName: "صنف 1",
          qty: Qty.fromMajor("10"),
          alreadyReturnedQty: Qty.zero(),
          unitPrice: Money.fromMajor("20"),
          unitCost: Money.fromMajor("12"),
          taxAmount: Money.zero(),
        },
      ],
    });
    const lines = buildSalesReturnLinesFromInvoice(inv, "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("4") },
    ]);
    expect(lines[0]?.taxAmount.toString()).toBe("0.000000");
  });

  it("uses the per-request line reason over the document-level default", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [
      { itemId: "ITEM1", qty: Qty.fromMajor("1"), reason: "WRONG_ITEM" },
    ]);
    expect(lines[0]?.reason).toBe("WRONG_ITEM");
  });

  it("falls back to the document-level reason when a request names none", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "EXCESS_QTY", [
      { itemId: "ITEM1", qty: Qty.fromMajor("1") },
    ]);
    expect(lines[0]?.reason).toBe("EXCESS_QTY");
  });

  it("silently skips a requested item that is not on the source invoice", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [
      { itemId: "ITEM-NOT-ON-INVOICE", qty: Qty.fromMajor("1") },
    ]);
    expect(lines).toHaveLength(0);
  });

  it("stamps the document's warehouse, the invoice's customer and the source invoice identity onto every line", () => {
    const lines = buildSalesReturnLinesFromInvoice(invoice(), "WH-RETURNS", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("1") },
    ]);
    expect(lines[0]?.warehouseId).toBe("WH-RETURNS");
    expect(lines[0]?.customerId).toBe("CUST1");
    expect(lines[0]?.sourceInvoiceId).toBe("INV1");
    expect(lines[0]?.sourceInvoiceNumber).toBe("INV-000014");
  });

  it("builds one line per requested item, in invoice-line order", () => {
    const inv = invoice({
      lines: [
        { itemId: "ITEM1", itemName: "1", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("10"), unitCost: Money.fromMajor("6"), taxAmount: Money.fromMajor("7") },
        { itemId: "ITEM2", itemName: "2", qty: Qty.fromMajor("8"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("15"), unitCost: Money.fromMajor("9"), taxAmount: Money.fromMajor("16.80") },
      ],
    });
    const lines = buildSalesReturnLinesFromInvoice(inv, "WH1", "DEFECTIVE", [
      { itemId: "ITEM2", qty: Qty.fromMajor("2") },
      { itemId: "ITEM1", qty: Qty.fromMajor("1") },
    ]);
    expect(lines.map((l) => l.itemId)).toEqual(["ITEM1", "ITEM2"]);
  });
});
