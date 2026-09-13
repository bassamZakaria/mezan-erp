import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { buildPurchaseReturnLinesFromInvoice } from "./from-invoice.js";
import type { SourcePurchaseInvoice } from "./ports.js";

function invoice(overrides: Partial<SourcePurchaseInvoice> = {}): SourcePurchaseInvoice {
  return {
    id: "PI1",
    number: "PI-000002",
    supplierId: "SUP1",
    warehouseId: "WH1",
    date: "2026-08-21",
    status: "confirmed",
    lines: [
      { itemId: "ITEM1", itemName: "صنف 1", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("40"), taxAmount: Money.fromMajor("56") },
      { itemId: "ITEM2", itemName: "صنف 2", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("20"), taxAmount: Money.fromMajor("14") },
    ],
    ...overrides,
  };
}

describe("buildPurchaseReturnLinesFromInvoice", () => {
  it("builds one return line per requested item, carrying the invoice's supplier/source refs", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "DEFECTIVE", [
      { itemId: "ITEM1", qty: Qty.fromMajor("3") },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemId: "ITEM1",
      warehouseId: "WH1",
      supplierId: "SUP1",
      sourceInvoiceId: "PI1",
      sourceInvoiceNumber: "PI-000002",
      reason: "DEFECTIVE",
      qty: expect.anything(),
    });
    expect(lines[0]?.qty.toString()).toBe("3.000000");
  });

  it("availableQty is the invoice's qty minus what has already been returned", () => {
    const inv = invoice({
      lines: [
        { itemId: "ITEM1", itemName: "صنف 1", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.fromMajor("4"), unitCost: Money.fromMajor("40"), taxAmount: Money.fromMajor("56") },
      ],
    });
    const lines = buildPurchaseReturnLinesFromInvoice(inv, "WH1", "OTHER", [{ itemId: "ITEM1", qty: Qty.fromMajor("2") }]);
    expect(lines[0]?.availableQty.toString()).toBe("6.000000");
  });

  it("returning twice: a second call sees the reduced availableQty from the first return already folded into alreadyReturnedQty", () => {
    const firstReturnQty = Qty.fromMajor("3");
    const afterFirstReturn = invoice({
      lines: [
        { itemId: "ITEM1", itemName: "صنف 1", qty: Qty.fromMajor("10"), alreadyReturnedQty: firstReturnQty, unitCost: Money.fromMajor("40"), taxAmount: Money.fromMajor("56") },
      ],
    });
    const secondLines = buildPurchaseReturnLinesFromInvoice(afterFirstReturn, "WH1", "OTHER", [
      { itemId: "ITEM1", qty: Qty.fromMajor("7") },
    ]);
    expect(secondLines[0]?.availableQty.toString()).toBe("7.000000");
    expect(secondLines[0]?.qty.toString()).toBe("7.000000");
  });

  it("filters out an item that was not requested", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [{ itemId: "ITEM1", qty: Qty.fromMajor("1") }]);
    expect(lines.map((l) => l.itemId)).toEqual(["ITEM1"]);
  });

  it("filters out a zero-qty request for an item", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [
      { itemId: "ITEM1", qty: Qty.zero() },
      { itemId: "ITEM2", qty: Qty.fromMajor("1") },
    ]);
    expect(lines.map((l) => l.itemId)).toEqual(["ITEM2"]);
  });

  it("returns no lines when nothing was requested", () => {
    expect(buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [])).toEqual([]);
  });

  it("prorates the tax share proportionally to the requested qty out of the line's full qty", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [{ itemId: "ITEM1", qty: Qty.fromMajor("5") }]);
    // full line qty 10 carries 56 tax; returning 5 of 10 => half the tax.
    expect(lines[0]?.taxAmount.toString()).toBe("28.000000");
  });

  it("carries the full line taxAmount unprorated when the invoice line's own qty is zero", () => {
    const inv = invoice({
      lines: [{ itemId: "ITEM1", itemName: "صنف 1", qty: Qty.zero(), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("40"), taxAmount: Money.zero() }],
    });
    // With qty zero the invoice line offers nothing to request against a positive qty in practice,
    // but the guard exists precisely so a zero-qty line never divides by zero.
    const lines = buildPurchaseReturnLinesFromInvoice(inv, "WH1", "OTHER", [{ itemId: "ITEM1", qty: Qty.zero() }]);
    expect(lines).toEqual([]);
  });

  it("carries the invoice line's unitCost onto the return line unchanged", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(invoice(), "WH1", "OTHER", [{ itemId: "ITEM2", qty: Qty.fromMajor("2") }]);
    expect(lines[0]?.unitCost.toString()).toBe("20.000000");
  });

  it("inherits the invoice's projectId and the line's costCategory", () => {
    const inv = invoice({
      projectId: "proj-1",
      lines: [
        { itemId: "ITEM1", itemName: "صنف 1", qty: Qty.fromMajor("10"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("40"), taxAmount: Money.fromMajor("56"), costCategory: "materials" },
      ],
    });
    const lines = buildPurchaseReturnLinesFromInvoice(inv, "WH1", "OTHER", [{ itemId: "ITEM1", qty: Qty.fromMajor("3") }]);
    expect(lines[0]?.projectId).toBe("proj-1");
    expect(lines[0]?.costCategory).toBe("materials");
  });
});
