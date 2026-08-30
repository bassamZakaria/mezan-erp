import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  STOCK_SOURCE_DOC_TYPES,
  isRevaluation,
  occurredAtFromDocumentDate,
  signedQty,
  signedValue,
  type StockMovement,
} from "./movement.js";

function movement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "m1",
    itemId: "item-1",
    warehouseId: "wh-1",
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("5.00"),
    sourceDocType: "ADJUSTMENT",
    sourceDocId: "adj-1",
    sourceDocNumber: "ADJ-000001",
    reason: "INITIAL_STOCK",
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("STOCK_SOURCE_DOC_TYPES", () => {
  it("lists every document type that can originate a movement", () => {
    expect(STOCK_SOURCE_DOC_TYPES).toContain("ADJUSTMENT");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("TRANSFER");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("PURCHASE_INVOICE");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("SALES_INVOICE");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("SALES_RETURN");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("PURCHASE_RETURN");
    expect(STOCK_SOURCE_DOC_TYPES).toContain("LANDED_COST");
    expect(new Set(STOCK_SOURCE_DOC_TYPES).size).toBe(STOCK_SOURCE_DOC_TYPES.length); // no duplicates
  });
});

describe("occurredAtFromDocumentDate", () => {
  it("stamps a bare calendar date to midnight UTC so it sorts before any same-day timestamp", () => {
    const stamped = occurredAtFromDocumentDate("2026-08-20");
    expect(stamped).toBe("2026-08-20T00:00:00.000Z");
    expect(stamped < "2026-08-20T09:00:00.000Z").toBe(true);
  });

  it("passes an already-ISO timestamp through unchanged", () => {
    expect(occurredAtFromDocumentDate("2026-08-20T14:30:00.000Z")).toBe("2026-08-20T14:30:00.000Z");
  });
});

describe("isRevaluation", () => {
  it("is false for an ordinary quantity movement", () => {
    expect(isRevaluation(movement())).toBe(false);
  });

  it("is true only when valueDelta is non-zero", () => {
    expect(isRevaluation(movement({ valueDelta: Money.zero() }))).toBe(false);
    expect(isRevaluation(movement({ valueDelta: Money.fromMajor("50.00") }))).toBe(true);
    expect(isRevaluation(movement({ valueDelta: null }))).toBe(false);
  });
});

describe("signedQty — the quantity consequence of a movement", () => {
  it("is +qty for an IN and -qty for an OUT", () => {
    const inMove = movement({ direction: "IN", qty: Qty.fromMajor("10") });
    const outMove = movement({ direction: "OUT", qty: Qty.fromMajor("10") });
    expect(signedQty(inMove).toString()).toBe("10.000000");
    expect(signedQty(outMove).toString()).toBe("-10.000000");
    // a reversal is the exact negative
    expect(signedQty(outMove).equals(signedQty(inMove).negate())).toBe(true);
  });

  it("is always zero for a revaluation — value moves with no quantity consequence", () => {
    const revaluation = movement({
      direction: "IN",
      qty: Qty.zero(),
      unitCost: Money.zero(),
      valueDelta: Money.fromMajor("100.00"),
      revaluesSourceDocId: "rcpt-1",
    });
    expect(isRevaluation(revaluation)).toBe(true);
    expect(signedQty(revaluation).isZero()).toBe(true);
  });
});

describe("signedValue — the money consequence of a movement, paired with signedQty", () => {
  it("an IN's value is +qty*unitCost and an OUT's is the exact negative — quantity and value move together", () => {
    const inMove = movement({ direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5.00") });
    const outMove = movement({ direction: "OUT", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5.00") });
    expect(signedQty(inMove).toString()).toBe("10.000000");
    expect(signedValue(inMove).toString()).toBe("50.000000");
    expect(signedQty(outMove).toString()).toBe("-10.000000");
    expect(signedValue(outMove).toString()).toBe("-50.000000");
    expect(signedValue(outMove).equals(signedValue(inMove).negate())).toBe(true);
  });

  it("a revaluation carries value with zero quantity consequence — the one movement allowed to decouple them", () => {
    const revaluation = movement({
      direction: "IN",
      qty: Qty.zero(),
      unitCost: Money.zero(),
      valueDelta: Money.fromMajor("100.00"),
      revaluesSourceDocId: "rcpt-1",
    });
    expect(signedQty(revaluation).isZero()).toBe(true);
    expect(signedValue(revaluation).toString()).toBe("100.000000");
  });

  it("an OUT-direction revaluation negates the valueDelta", () => {
    const revaluation = movement({
      direction: "OUT",
      qty: Qty.zero(),
      unitCost: Money.zero(),
      valueDelta: Money.fromMajor("100.00"),
      revaluesSourceDocId: "rcpt-1",
    });
    expect(signedValue(revaluation).toString()).toBe("-100.000000");
  });
});
