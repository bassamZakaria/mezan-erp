import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { extend, unitCostOf } from "./wac-math.js";

describe("extend — qty × unitCost, HALF_UP at scale 1e-6", () => {
  it("multiplies exactly when the product needs no rounding", () => {
    expect(extend(Qty.fromMajor("10"), Money.fromMajor("5.50")).toString()).toBe("55.000000");
    expect(extend(Qty.fromMajor("2.5"), Money.fromMajor("4.00")).toString()).toBe("10.000000");
  });

  it("rounds an exact half-microunit UP (away from zero)", () => {
    expect(extend(Qty.fromMajor("0.000001"), Money.fromMajor("0.5")).toString()).toBe("0.000001");
  });

  it("rounds a below-half remainder DOWN", () => {
    expect(extend(Qty.fromMajor("0.000001"), Money.fromMajor("0.4")).toString()).toBe("0.000000");
  });

  it("a reversing (negated) qty produces the exact negative extension, even through a rounding boundary", () => {
    const qty = Qty.fromMajor("0.000001");
    const cost = Money.fromMajor("0.5");
    const positive = extend(qty, cost);
    const negative = extend(qty.negate(), cost);
    expect(negative.toString()).toBe("-0.000001");
    expect(negative.equals(positive.negate())).toBe(true);
  });

  it("zero quantity or zero unit cost extends to zero", () => {
    expect(extend(Qty.zero(), Money.fromMajor("99.00")).toString()).toBe("0.000000");
    expect(extend(Qty.fromMajor("99"), Money.zero()).toString()).toBe("0.000000");
  });
});

describe("unitCostOf — weighted-average unit cost, HALF_UP at scale 1e-6", () => {
  it("returns Money.zero() for a zero quantity (no meaningful unit cost)", () => {
    expect(unitCostOf(Money.fromMajor("500.00"), Qty.zero()).toString()).toBe("0.000000");
  });

  it("divides exactly when it needs no rounding", () => {
    expect(unitCostOf(Money.fromMajor("100.00"), Qty.fromMajor("4")).toString()).toBe("25.000000");
  });

  it("rounds a repeating division down below the half-microunit boundary", () => {
    // 1.000000 / 3.000000 = 0.333333(3) -> remainder is below half, rounds down.
    expect(unitCostOf(Money.fromMajor("1.00"), Qty.fromMajor("3")).toString()).toBe("0.333333");
  });

  it("rounds an exact half-microunit UP", () => {
    // 0.000001 / 2 = 0.0000005 exactly -> HALF_UP rounds to 0.000001.
    expect(unitCostOf(Money.fromScaled(1n), Qty.fromScaled(2_000_000n)).toString()).toBe("0.000001");
  });

  it("is symmetric for a negative total value", () => {
    const positive = unitCostOf(Money.fromScaled(1n), Qty.fromScaled(2_000_000n));
    const negative = unitCostOf(Money.fromScaled(-1n), Qty.fromScaled(2_000_000n));
    expect(negative.equals(positive.negate())).toBe(true);
  });
});
