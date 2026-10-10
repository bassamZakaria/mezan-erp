import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { matchSourceLines, returnedQtyBySourceLine } from "./match-source-lines.js";
import { buildSalesReturnLinesFromInvoice } from "../sales-returns/from-invoice.js";
import { buildPurchaseReturnLinesFromInvoice } from "../purchase-returns/from-invoice.js";
import type { SourceSalesInvoice } from "../sales-returns/ports.js";
import type { SourcePurchaseInvoice } from "../purchase-returns/ports.js";

const lines = [
  { sourceLineId: "L1", itemId: "A" },
  { sourceLineId: "L2", itemId: "A" },
  { sourceLineId: "L3", itemId: "B" },
];

describe("matchSourceLines", () => {
  it("takes exactly the line a request names", () => {
    const matched = matchSourceLines(lines, [{ itemId: "A", sourceLineId: "L2" }]);
    expect(matched.map((m) => m.line.sourceLineId)).toEqual(["L2"]);
  });

  it("falls back to the FIRST line of the item for a request that names none — once, never every line of the item", () => {
    const matched = matchSourceLines(lines, [{ itemId: "A" }]);
    expect(matched.map((m) => m.line.sourceLineId)).toEqual(["L1"]);
  });

  it("gives two unnamed requests for one item two different lines", () => {
    const matched = matchSourceLines(lines, [{ itemId: "A" }, { itemId: "A" }]);
    expect(matched.map((m) => m.line.sourceLineId)).toEqual(["L1", "L2"]);
  });

  it("lets a named request claim its line before an unnamed one falls back", () => {
    const matched = matchSourceLines(lines, [{ itemId: "A" }, { itemId: "A", sourceLineId: "L1" }]);
    expect(matched.map((m) => [m.line.sourceLineId, m.request.sourceLineId ?? null])).toEqual([["L1", "L1"], ["L2", null]]);
  });

  it("ignores a named line that belongs to another item, and a request for an item not on the invoice", () => {
    expect(matchSourceLines(lines, [{ itemId: "B", sourceLineId: "L1" }])).toEqual([]);
    expect(matchSourceLines(lines, [{ itemId: "Z" }])).toEqual([]);
  });
});

describe("a return of an item sold on two lines at two tax rates (review finding 8)", () => {
  const sale: SourceSalesInvoice = {
    id: "INV1",
    number: "INV-1",
    customerId: "C1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed",
    lines: [
      { sourceLineId: "L1", itemId: "A", itemName: "صنف", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("100"), unitCost: Money.zero(), taxAmount: Money.fromMajor("70"), taxRatePercent: 14, taxRateId: "VAT14" },
      { sourceLineId: "L2", itemId: "A", itemName: "صنف", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("100"), unitCost: Money.zero(), taxAmount: Money.zero(), taxRatePercent: 0, taxRateId: "VAT-EXPORT" },
    ],
  };

  it("a sales return naming the export line comes back under the export rate, with no VAT", () => {
    const [line, ...rest] = buildSalesReturnLinesFromInvoice(sale, "WH1", "DEFECTIVE", [{ itemId: "A", sourceLineId: "L2", qty: Qty.fromMajor("1") }]);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ sourceLineId: "L2", taxRateId: "VAT-EXPORT", taxRatePercent: 0 });
    expect(line?.taxAmount.toString()).toBe("0.000000");
  });

  it("a sales return naming no line returns ONE line, against the first", () => {
    const built = buildSalesReturnLinesFromInvoice(sale, "WH1", "DEFECTIVE", [{ itemId: "A", qty: Qty.fromMajor("1") }]);
    expect(built.map((l) => [l.sourceLineId, l.taxRateId, l.taxAmount.toString()])).toEqual([["L1", "VAT14", "14.000000"]]);
  });

  const purchase: SourcePurchaseInvoice = {
    id: "PI1",
    number: "PI-1",
    supplierId: "S1",
    warehouseId: "WH1",
    date: "2026-08-20",
    status: "confirmed",
    lines: [
      { sourceLineId: "0", itemId: "A", itemName: "صنف", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("100"), taxAmount: Money.fromMajor("70"), taxRatePercent: 14, taxRateId: "VAT14" },
      { sourceLineId: "1", itemId: "A", itemName: "صنف", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("100"), taxAmount: Money.zero(), taxRatePercent: 0, taxRateId: "VAT-EXEMPT" },
    ],
  };

  it("a purchase return naming the second line comes back under that line's rate", () => {
    const built = buildPurchaseReturnLinesFromInvoice(purchase, "WH1", "DEFECTIVE", [{ itemId: "A", sourceLineId: "1", qty: Qty.fromMajor("2") }]);
    expect(built.map((l) => [l.sourceLineId, l.taxRateId, l.taxAmount.toString()])).toEqual([["1", "VAT-EXEMPT", "0.000000"]]);
  });
});

describe("returnedQtyBySourceLine — what earlier returns took from EACH line (D79 review round 2)", () => {
  const q = (major: string) => Qty.fromMajor(major);
  const sold = [
    { sourceLineId: "L1", itemId: "A", qty: q("5") },
    { sourceLineId: "L2", itemId: "A", qty: q("5") },
    { sourceLineId: "L3", itemId: "B", qty: q("2") },
  ];
  const taken = (returned: { itemId: string; sourceLineId?: string | null; qty: Qty }[]) =>
    returnedQtyBySourceLine(sold, returned).map((qty) => qty.toString());

  it("counts a return against the line it names, leaving the item's other line whole", () => {
    expect(taken([{ itemId: "A", sourceLineId: "L2", qty: q("3") }])).toEqual(["0.000000", "3.000000", "0.000000"]);
  });

  it("is not the item's total on every line — the per-item count that made one line's return block the other", () => {
    const perLine = taken([{ itemId: "A", sourceLineId: "L1", qty: q("5") }]);
    expect(perLine[0]).toBe("5.000000");
    expect(perLine[1]).toBe("0.000000");
  });

  it("spreads a return that names no line over the item's lines in order, each up to what it has left", () => {
    expect(taken([{ itemId: "A", qty: q("7") }])).toEqual(["5.000000", "2.000000", "0.000000"]);
  });

  it("fills around named returns whatever order they were stored in", () => {
    expect(taken([{ itemId: "A", qty: q("4") }, { itemId: "A", sourceLineId: "L1", qty: q("3") }])).toEqual(["5.000000", "2.000000", "0.000000"]);
  });

  it("keeps the whole of an over-return on the item's last line, so the total taken is never understated", () => {
    expect(taken([{ itemId: "A", qty: q("12") }])).toEqual(["5.000000", "7.000000", "0.000000"]);
  });

  it("counts nothing for a named line of another item or an item that was never sold, and sums exactly", () => {
    expect(taken([{ itemId: "B", sourceLineId: "L1", qty: q("1") }, { itemId: "Z", qty: q("9") }])).toEqual(["0.000000", "0.000000", "1.000000"]);
    expect(taken([{ itemId: "A", sourceLineId: "L1", qty: q("0.000001") }, { itemId: "A", sourceLineId: "L1", qty: q("0.000002") }])[0]).toBe("0.000003");
  });
});

