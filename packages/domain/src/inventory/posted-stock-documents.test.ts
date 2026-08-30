import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  filterPostedAdjustments,
  filterPostedTransfers,
  foldPostedAdjustments,
  foldPostedTransfers,
} from "./posted-stock-documents.js";
import type { StockMovement } from "./movement.js";

function movement(overrides: Partial<StockMovement> & Pick<StockMovement, "id" | "sourceDocId" | "sourceDocType">): StockMovement {
  return {
    itemId: "item-1",
    warehouseId: "wh-1",
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("5.00"),
    sourceDocNumber: null,
    reason: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("foldPostedAdjustments", () => {
  it("folds every movement of one source document into one posted adjustment, valueDelta agreeing with the lines", () => {
    const movements: StockMovement[] = [
      movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT", sourceDocNumber: "ADJ-000001", reason: "DAMAGE", direction: "OUT", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10.00"), occurredAt: "2026-01-02T00:00:00.000Z" }),
      movement({ id: "a1:1", sourceDocId: "a1", sourceDocType: "ADJUSTMENT", sourceDocNumber: "ADJ-000001", reason: "DAMAGE", direction: "OUT", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10.00"), occurredAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const [adj] = foldPostedAdjustments(movements);
    expect(adj!.id).toBe("a1");
    expect(adj!.docNo).toBe("ADJ-000001");
    expect(adj!.warehouseId).toBe("wh-1");
    expect(adj!.reason).toBe("DAMAGE");
    expect(adj!.lines).toHaveLength(2);
    // 3 units OUT at 10.00 -> value left is -30, and valueDelta agrees with the summed lines.
    expect(adj!.valueDelta.toString()).toBe("-30.000000");
    expect(Money.sum(adj!.lines.map((l) => l.value)).equals(adj!.valueDelta)).toBe(true);
  });

  it("ignores movements from other source-doc types (transfers)", () => {
    const movements: StockMovement[] = [
      movement({ id: "t1:out:0", sourceDocId: "t1", sourceDocType: "TRANSFER" }),
      movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT" }),
    ];
    const adjustments = foldPostedAdjustments(movements);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.id).toBe("a1");
  });

  it("an INITIAL_STOCK IN adjustment has a positive valueDelta", () => {
    const movements: StockMovement[] = [
      movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT", reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("50.00") }),
    ];
    const [adj] = foldPostedAdjustments(movements);
    expect(adj!.valueDelta.toString()).toBe("5000.000000");
  });

  it("sorts newest first, with a stable id tie-break on equal timestamps", () => {
    const movements: StockMovement[] = [
      movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT", occurredAt: "2026-01-01T00:00:00.000Z" }),
      movement({ id: "a2:0", sourceDocId: "a2", sourceDocType: "ADJUSTMENT", occurredAt: "2026-01-03T00:00:00.000Z" }),
      movement({ id: "a3:0", sourceDocId: "a3", sourceDocType: "ADJUSTMENT", occurredAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const adjustments = foldPostedAdjustments(movements);
    expect(adjustments.map((a) => a.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("no ADJUSTMENT movements folds to an empty list", () => {
    expect(foldPostedAdjustments([])).toEqual([]);
  });
});

describe("foldPostedTransfers", () => {
  function transferMovements(overrides: { fromWarehouseId?: string; toWarehouseId?: string; qty?: Qty; unitCost?: Money } = {}) {
    const fromWarehouseId = overrides.fromWarehouseId ?? "wh-1";
    const toWarehouseId = overrides.toWarehouseId ?? "wh-2";
    const qty = overrides.qty ?? Qty.fromMajor("5");
    const unitCost = overrides.unitCost ?? Money.fromMajor("20.00");
    return [
      movement({ id: "t1:out:0", sourceDocId: "t1", sourceDocType: "TRANSFER", warehouseId: fromWarehouseId, direction: "OUT", qty, unitCost, sourceDocNumber: "TRF-000001" }),
      movement({ id: "t1:in:0", sourceDocId: "t1", sourceDocType: "TRANSFER", warehouseId: toWarehouseId, direction: "IN", qty, unitCost, sourceDocNumber: "TRF-000001" }),
    ];
  }

  it("pairs the OUT/IN legs into one posted transfer — valuation-neutral, so total value equals the source's cost", () => {
    const [transfer] = foldPostedTransfers(transferMovements());
    expect(transfer!.id).toBe("t1");
    expect(transfer!.fromWarehouseId).toBe("wh-1");
    expect(transfer!.toWarehouseId).toBe("wh-2");
    expect(transfer!.lines).toHaveLength(1);
    expect(transfer!.totalValue.toString()).toBe("100.000000"); // 5 * 20
  });

  it("multi-line transfer sums totalValue across lines from the OUT legs", () => {
    const movements: StockMovement[] = [
      movement({ id: "t1:out:0", sourceDocId: "t1", sourceDocType: "TRANSFER", direction: "OUT", itemId: "item-a", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("20.00") }),
      movement({ id: "t1:in:0", sourceDocId: "t1", sourceDocType: "TRANSFER", direction: "IN", itemId: "item-a", warehouseId: "wh-2", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("20.00") }),
      movement({ id: "t1:out:1", sourceDocId: "t1", sourceDocType: "TRANSFER", direction: "OUT", itemId: "item-b", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("50.00") }),
      movement({ id: "t1:in:1", sourceDocId: "t1", sourceDocType: "TRANSFER", direction: "IN", itemId: "item-b", warehouseId: "wh-2", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("50.00") }),
    ];
    const [transfer] = foldPostedTransfers(movements);
    expect(transfer!.lines).toHaveLength(2);
    expect(transfer!.totalValue.toString()).toBe("200.000000"); // 100 + 100
  });

  it("falls back to the IN legs when a transfer has no OUT legs on record", () => {
    const movements: StockMovement[] = [
      movement({ id: "t1:in:0", sourceDocId: "t1", sourceDocType: "TRANSFER", warehouseId: "wh-2", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("20.00") }),
    ];
    const [transfer] = foldPostedTransfers(movements);
    expect(transfer!.lines).toHaveLength(1);
    expect(transfer!.toWarehouseId).toBe("wh-2");
  });

  it("ignores non-TRANSFER movements", () => {
    const movements: StockMovement[] = [
      movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT" }),
    ];
    expect(foldPostedTransfers(movements)).toEqual([]);
  });
});

describe("filterPostedAdjustments", () => {
  const adjustments = foldPostedAdjustments([
    movement({ id: "a1:0", sourceDocId: "a1", sourceDocType: "ADJUSTMENT", sourceDocNumber: "ADJ-000001", warehouseId: "wh-1", reason: "DAMAGE", itemId: "item-1", occurredAt: "2026-01-05T00:00:00.000Z" }),
    movement({ id: "a2:0", sourceDocId: "a2", sourceDocType: "ADJUSTMENT", sourceDocNumber: "ADJ-000002", warehouseId: "wh-2", reason: "THEFT", itemId: "item-2", occurredAt: "2026-01-15T00:00:00.000Z" }),
  ]);

  it("filters by date range (inclusive), matching the occurredAt calendar date", () => {
    expect(filterPostedAdjustments(adjustments, { fromDate: "2026-01-10" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { toDate: "2026-01-10" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { fromDate: "2026-01-05", toDate: "2026-01-05" })).toHaveLength(1);
  });

  it("filters by warehouse and by reason", () => {
    expect(filterPostedAdjustments(adjustments, { warehouseId: "wh-1" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { reason: "THEFT" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { warehouseId: "wh-1", reason: "THEFT" })).toHaveLength(0);
  });

  it("search matches doc number, id or a line's item id, case-insensitively", () => {
    expect(filterPostedAdjustments(adjustments, { search: "adj-000002" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { search: "item-1" })).toHaveLength(1);
    expect(filterPostedAdjustments(adjustments, { search: "nope" })).toHaveLength(0);
  });

  it("an empty/whitespace search matches everything", () => {
    expect(filterPostedAdjustments(adjustments, { search: "" })).toHaveLength(2);
    expect(filterPostedAdjustments(adjustments, { search: "   " })).toHaveLength(2);
  });

  it("no filter returns everything", () => {
    expect(filterPostedAdjustments(adjustments)).toHaveLength(2);
  });
});

describe("filterPostedTransfers", () => {
  const transfers = foldPostedTransfers([
    movement({ id: "t1:out:0", sourceDocId: "t1", sourceDocType: "TRANSFER", sourceDocNumber: "TRF-000001", warehouseId: "wh-1", itemId: "item-1", direction: "OUT", occurredAt: "2026-01-05T00:00:00.000Z" }),
    movement({ id: "t1:in:0", sourceDocId: "t1", sourceDocType: "TRANSFER", sourceDocNumber: "TRF-000001", warehouseId: "wh-2", itemId: "item-1", direction: "IN", occurredAt: "2026-01-05T00:00:00.000Z" }),
    movement({ id: "t2:out:0", sourceDocId: "t2", sourceDocType: "TRANSFER", sourceDocNumber: "TRF-000002", warehouseId: "wh-2", itemId: "item-2", direction: "OUT", occurredAt: "2026-01-06T00:00:00.000Z" }),
    movement({ id: "t2:in:0", sourceDocId: "t2", sourceDocType: "TRANSFER", sourceDocNumber: "TRF-000002", warehouseId: "wh-3", itemId: "item-2", direction: "IN", occurredAt: "2026-01-06T00:00:00.000Z" }),
  ]);

  it("warehouseId matches either the source or the destination leg", () => {
    expect(filterPostedTransfers(transfers, { warehouseId: "wh-1" })).toHaveLength(1); // t1's source
    expect(filterPostedTransfers(transfers, { warehouseId: "wh-2" })).toHaveLength(2); // t1's dest, t2's source
    expect(filterPostedTransfers(transfers, { warehouseId: "wh-3" })).toHaveLength(1); // t2's dest
  });

  it("fromWarehouseId and toWarehouseId narrow to one leg specifically", () => {
    expect(filterPostedTransfers(transfers, { fromWarehouseId: "wh-2" })).toHaveLength(1);
    expect(filterPostedTransfers(transfers, { fromWarehouseId: "wh-2" })[0]!.id).toBe("t2");
    expect(filterPostedTransfers(transfers, { toWarehouseId: "wh-2" })).toHaveLength(1);
    expect(filterPostedTransfers(transfers, { toWarehouseId: "wh-2" })[0]!.id).toBe("t1");
  });

  it("search matches doc number or a line's item id", () => {
    expect(filterPostedTransfers(transfers, { search: "trf-000002" })).toHaveLength(1);
    expect(filterPostedTransfers(transfers, { search: "item-2" })).toHaveLength(1);
  });

  it("date range filters by occurredAt", () => {
    expect(filterPostedTransfers(transfers, { fromDate: "2026-01-06" })).toHaveLength(1);
  });
});
