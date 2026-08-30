import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { distributeLandedCost, totalLandedCost, landedCostTotalsByType } from "./distribution.js";
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
    weight: Qty.fromMajor("0"),
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

  it("throws ZeroLandedCostWeightError for BY_WEIGHT when every target's shipped weight is zero", () => {
    const targets = [target({ weight: Qty.zero() }), target({ itemId: "B", weight: Qty.zero() })];
    expect(() => distributeLandedCost(COST_ITEMS, "BY_WEIGHT", targets)).toThrow(ZeroLandedCostWeightError);
  });
});

describe("distributeLandedCost — BY_WEIGHT", () => {
  it("splits the total cost proportionally to shipped weight, ignoring qty and value", () => {
    const targets = [
      target({ itemId: "A", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1"), weight: Qty.fromMajor("75") }),
      target({ itemId: "B", qty: Qty.fromMajor("1000"), unitCost: Money.fromMajor("1000"), weight: Qty.fromMajor("25") }),
    ];
    const result = distributeLandedCost(COST_ITEMS, "BY_WEIGHT", targets);
    expect(result[0]?.allocatedAmount.toString()).toBe("750.000000");
    expect(result[1]?.allocatedAmount.toString()).toBe("250.000000");
  });

  it("a zero-weight line among non-zero ones gets nothing allocated to it", () => {
    const targets = [
      target({ itemId: "A", weight: Qty.fromMajor("10") }),
      target({ itemId: "B", weight: Qty.zero() }),
    ];
    const result = distributeLandedCost(COST_ITEMS, "BY_WEIGHT", targets);
    expect(result.find((r) => r.itemId === "B")?.allocatedAmount.toString()).toBe("0.000000");
    expect(result.find((r) => r.itemId === "A")?.allocatedAmount.toString()).toBe("1000.000000");
  });
});

describe("newUnitCost", () => {
  it("leaves unitCost unchanged (rather than dividing by zero) when the target's own qty is zero", () => {
    const targets = [target({ itemId: "A", qty: Qty.zero(), unitCost: Money.fromMajor("50"), weight: Qty.fromMajor("10") })];
    const result = distributeLandedCost(COST_ITEMS, "BY_WEIGHT", targets);
    expect(result[0]?.newUnitCost.toString()).toBe("50.000000");
    expect(result[0]?.allocatedAmount.toString()).toBe("1000.000000");
  });
});

describe("landedCostTotalsByType", () => {
  it("sums entered costs by نوع التكلفة, in the fixed catalog order, omitting types with nothing entered", () => {
    const items = [
      { costType: "OTHER" as const, description: "متفرقات", amount: Money.fromMajor("50") },
      { costType: "SHIPPING" as const, description: "شحن 1", amount: Money.fromMajor("300") },
      { costType: "SHIPPING" as const, description: "شحن 2", amount: Money.fromMajor("300") },
      { costType: "CUSTOMS" as const, description: "جمارك", amount: Money.fromMajor("400") },
    ];
    const byType = landedCostTotalsByType(items);
    // SHIPPING, CUSTOMS, INSURANCE, CLEARANCE, OTHER is the declared catalog order;
    // INSURANCE/CLEARANCE have nothing entered and must be omitted entirely.
    expect(byType.map((b) => b.costType)).toEqual(["SHIPPING", "CUSTOMS", "OTHER"]);
    expect(byType.find((b) => b.costType === "SHIPPING")?.amount.toString()).toBe("600.000000");
    const sum = Money.sum(byType.map((b) => b.amount));
    expect(sum.toString()).toBe(totalLandedCost(items).toString());
  });

  it("returns an empty array for no cost items", () => {
    expect(landedCostTotalsByType([])).toEqual([]);
  });
});
