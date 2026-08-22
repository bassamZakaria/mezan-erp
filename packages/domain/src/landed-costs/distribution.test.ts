import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { distributeLandedCost, totalLandedCost } from "./distribution.js";
import { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./errors.js";
import type { LandedCostAllocationTarget, LandedCostItemEntry } from "./distribution.js";

const COST_ITEMS: LandedCostItemEntry[] = [
  { costType: "SHIPPING", description: "شحن بحري", amount: Money.fromMajor("600") },
  { costType: "CUSTOMS", description: "جمارك", amount: Money.fromMajor("400") },
];

function target(overrides: Partial<LandedCostAllocationTarget> = {}): LandedCostAllocationTarget {
  return {
    itemId: "ITEM1",
    warehouseId: "WH1",
    sourceInvoiceId: "PI1",
    sourceInvoiceNumber: "PI-000002",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("50"),
    ...overrides,
  };
}

describe("distributeLandedCost — BY_VALUE", () => {
  it("splits the total cost proportionally to line value (qty × unitCost)", () => {
    const targets = [
      target({ itemId: "A", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50") }), // value 500
      target({ itemId: "B", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("100") }), // value 500
    ];
    const result = distributeLandedCost(COST_ITEMS, "BY_VALUE", targets);

    // Equal value (500 each) → the 1000 total cost splits 500/500.
    expect(result[0]?.allocatedAmount.toString()).toBe("500.000000");
    expect(result[1]?.allocatedAmount.toString()).toBe("500.000000");

    // Reconciliation: parts sum EXACTLY to the entered total, always.
    const sum = Money.sum(result.map((r) => r.allocatedAmount));
    expect(sum.equals(totalLandedCost(COST_ITEMS))).toBe(true);

    // newUnitCost = unitCost + allocatedAmount / qty
    expect(result[0]?.newUnitCost.toString()).toBe("100.000000"); // 50 + 500/10
    expect(result[1]?.newUnitCost.toString()).toBe("200.000000"); // 100 + 500/5
  });

  it("reconciles exactly under an odd, non-divisible total (largest-remainder rounding)", () => {
    const oddCost: LandedCostItemEntry[] = [{ costType: "OTHER", description: "متنوع", amount: Money.fromMajor("100") }];
    const targets = [
      target({ itemId: "A", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }), // weight 1
      target({ itemId: "B", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }), // weight 1
      target({ itemId: "C", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }), // weight 1
    ];
    const result = distributeLandedCost(oddCost, "BY_VALUE", targets);
    const sum = Money.sum(result.map((r) => r.allocatedAmount));
    expect(sum.toString()).toBe("100.000000");
    // 100/3 → 33.33 each with the odd cent going to (deterministically) the first line by largest-remainder tie-break.
    expect(result.map((r) => r.allocatedAmount.toString())).toEqual([
      "33.333334",
      "33.333333",
      "33.333333",
    ]);
  });
});

describe("distributeLandedCost — BY_QUANTITY", () => {
  it("splits the total cost proportionally to quantity, ignoring value", () => {
    const targets = [
      target({ itemId: "A", qty: Qty.fromMajor("30"), unitCost: Money.fromMajor("1000") }), // high value, weight 30
      target({ itemId: "B", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("1") }), // low value, weight 10
    ];
    const result = distributeLandedCost(COST_ITEMS, "BY_QUANTITY", targets);
    // 1000 total split 30:10 → 750 / 250, regardless of value.
    expect(result[0]?.allocatedAmount.toString()).toBe("750.000000");
    expect(result[1]?.allocatedAmount.toString()).toBe("250.000000");
  });
});

describe("distributeLandedCost — errors", () => {
  it("throws EmptyLandedCostTargetsError with no target lines", () => {
    expect(() => distributeLandedCost(COST_ITEMS, "BY_VALUE", [])).toThrow(EmptyLandedCostTargetsError);
  });

  it("throws ZeroLandedCostWeightError when every target has a zero weight", () => {
    const targets = [target({ qty: Qty.zero() })];
    expect(() => distributeLandedCost(COST_ITEMS, "BY_QUANTITY", targets)).toThrow(ZeroLandedCostWeightError);
  });
});
