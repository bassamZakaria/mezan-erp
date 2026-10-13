import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { matchSourceLines, overdrawnSourceLines, returnedQtyBySourceLine } from "./match-source-lines.js";
import { buildSalesReturnLinesFromInvoice } from "../sales-returns/from-invoice.js";
import { buildPurchaseReturnLinesFromInvoice } from "../purchase-returns/from-invoice.js";
import type { SourceSalesInvoice } from "../sales-returns/ports.js";
import type { SourcePurchaseInvoice } from "../purchase-returns/ports.js";

const five = Qty.fromMajor("5");
const one = Qty.fromMajor("1");
const line = (sourceLineId: string, itemId: string, qty = five, alreadyReturnedQty = Qty.zero()) => ({ sourceLineId, itemId, qty, alreadyReturnedQty });
const lines = [line("L1", "A"), line("L2", "A"), line("L3", "B")];
const pairs = (match: { matched: readonly { line: { sourceLineId: string }; request: { sourceLineId?: string | null } }[] }) =>
  match.matched.map((m) => [m.line.sourceLineId, m.request.sourceLineId ?? null]);

describe("matchSourceLines", () => {
  it("takes exactly the line a request names", () => {
    const match = matchSourceLines(lines, [{ itemId: "A", sourceLineId: "L2", qty: one }]);
    expect(match.matched.map((m) => m.line.sourceLineId)).toEqual(["L2"]);
    expect(match.unmatched).toEqual([]);
  });

  it("falls back to the FIRST line of the item for a request that names none — once, never every line of the item", () => {
    const match = matchSourceLines(lines, [{ itemId: "A", qty: one }]);
    expect(match.matched.map((m) => m.line.sourceLineId)).toEqual(["L1"]);
  });

  it("gives two unnamed requests for one item two different lines", () => {
    const match = matchSourceLines(lines, [{ itemId: "A", qty: one }, { itemId: "A", qty: one }]);
    expect(match.matched.map((m) => m.line.sourceLineId)).toEqual(["L1", "L2"]);
  });

  it("lets a named request claim its line before an unnamed one falls back", () => {
    const match = matchSourceLines(lines, [{ itemId: "A", qty: one }, { itemId: "A", sourceLineId: "L1", qty: one }]);
    expect(pairs(match)).toEqual([["L1", "L1"], ["L2", null]]);
  });

  it("hands back a named line that belongs to another item, and a request for an item not on the invoice, as unmatched — never silently dropped", () => {
    const foreignLine = { itemId: "B", sourceLineId: "L1", qty: one };
    const foreignItem = { itemId: "Z", qty: one };
    const match = matchSourceLines(lines, [foreignLine, foreignItem]);
    expect(match.matched).toEqual([]);
    expect(match.unmatched).toEqual([foreignLine, foreignItem]);
  });

  it("matches two requests naming the SAME line to that line twice, so their total can be checked against it", () => {
    const three = Qty.fromMajor("3");
    const match = matchSourceLines([line("L1", "A", three)], [{ itemId: "A", sourceLineId: "L1", qty: three }, { itemId: "A", sourceLineId: "L1", qty: three }]);
    expect(pairs(match)).toEqual([["L1", "L1"], ["L1", "L1"]]);
    expect(match.unmatched).toEqual([]);
  });

  it("gives a request that names no line the first line with ROOM, not the first line — 7 already returned over 5 + 5 leaves 3 on the second", () => {
    const sold = [{ sourceLineId: "L1", itemId: "A", qty: five }, { sourceLineId: "L2", itemId: "A", qty: five }];
    const taken = returnedQtyBySourceLine(sold, [{ itemId: "A", qty: Qty.fromMajor("7") }]);
    const withHistory = sold.map((l, i) => ({ ...l, alreadyReturnedQty: taken[i] as Qty }));
    const match = matchSourceLines(withHistory, [{ itemId: "A", qty: Qty.fromMajor("3") }]);
    expect(match.matched.map((m) => m.line.sourceLineId)).toEqual(["L2"]);
    expect(overdrawnSourceLines(withHistory, [{ itemId: "A", qty: Qty.fromMajor("3") }]).overdrawn).toEqual([]);
  });

  it("still names a real line when nothing is left, so the refusal says which line is exhausted", () => {
    const spent = [line("L1", "A", five, five)];
    const match = matchSourceLines(spent, [{ itemId: "A", qty: one }]);
    expect(match.matched.map((m) => m.line.sourceLineId)).toEqual(["L1"]);
  });
});

describe("overdrawnSourceLines — the total asked of each source line against what it has left", () => {
  const three = Qty.fromMajor("3");

  it("reports a line two requests together take more from than it has, though each alone fits", () => {
    const { overdrawn } = overdrawnSourceLines([line("L1", "A", three)], [{ itemId: "A", sourceLineId: "L1", qty: three }, { itemId: "A", sourceLineId: "L1", qty: three }]);
    expect(overdrawn.map((o) => [o.line.sourceLineId, o.requested.toString(), o.available.toString()])).toEqual([["L1", "6.000000", "3.000000"]]);
  });

  it("counts what confirmed returns already took", () => {
    const { overdrawn } = overdrawnSourceLines([line("L1", "A", three, Qty.fromMajor("2"))], [{ itemId: "A", sourceLineId: "L1", qty: Qty.fromMajor("2") }]);
    expect(overdrawn.map((o) => [o.requested.toString(), o.available.toString()])).toEqual([["2.000000", "1.000000"]]);
  });

  it("reports nothing when every line's total fits exactly", () => {
    const result = overdrawnSourceLines(lines, [{ itemId: "A", sourceLineId: "L1", qty: five }, { itemId: "A", sourceLineId: "L2", qty: five }]);
    expect(result).toEqual({ overdrawn: [], unmatched: [] });
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
    const [built, ...rest] = buildSalesReturnLinesFromInvoice(sale, "WH1", "DEFECTIVE", [{ itemId: "A", sourceLineId: "L2", qty: Qty.fromMajor("1") }]).lines;
    expect(rest).toEqual([]);
    expect(built).toMatchObject({ sourceLineId: "L2", taxRateId: "VAT-EXPORT", taxRatePercent: 0 });
    expect(built?.taxAmount.toString()).toBe("0.000000");
  });

  it("a sales return naming no line returns ONE line, against the first", () => {
    const built = buildSalesReturnLinesFromInvoice(sale, "WH1", "DEFECTIVE", [{ itemId: "A", qty: Qty.fromMajor("1") }]).lines;
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
    const built = buildPurchaseReturnLinesFromInvoice(purchase, "WH1", "DEFECTIVE", [{ itemId: "A", sourceLineId: "1", qty: Qty.fromMajor("2") }]).lines;
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

