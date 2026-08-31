import { describe, expect, it } from "vitest";
import { Qty } from "../money/index.js";
import {
  UNIT_FACTOR_SCALE,
  UnknownUnitError,
  fromBaseQty,
  resolveUnitFactor,
  toBaseQty,
  unitFactorToScaled,
  type UnitSetup,
} from "./conversion.js";

const setup: UnitSetup = {
  baseUnitCode: "PCS",
  alternateUnits: [
    { code: "BOX", factor: 12 },
    { code: "DOZEN", factor: 12 },
    { code: "HALF", factor: 0.5 },
  ],
};

describe("unitFactorToScaled", () => {
  it("lifts a whole factor to the 1e-6 scale", () => {
    expect(unitFactorToScaled(1)).toBe(UNIT_FACTOR_SCALE);
    expect(unitFactorToScaled(12)).toBe(12_000_000n);
  });

  it("lifts a six-decimal factor exactly", () => {
    expect(unitFactorToScaled(0.000001)).toBe(1n);
    expect(unitFactorToScaled(2.500001)).toBe(2_500_001n);
  });

  it("refuses a factor that is zero, negative, or not a number at all", () => {
    expect(() => unitFactorToScaled(0)).toThrow(RangeError);
    expect(() => unitFactorToScaled(-3)).toThrow(RangeError);
    expect(() => unitFactorToScaled(Number.NaN)).toThrow(RangeError);
    expect(() => unitFactorToScaled(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("refuses a factor with more than six decimals rather than truncating it", () => {
    expect(() => unitFactorToScaled(1.00000012)).toThrow(/6 decimal places/);
  });
});

describe("resolveUnitFactor", () => {
  it("treats the base unit, an empty code and a missing code alike as 1", () => {
    expect(resolveUnitFactor(setup, "PCS")).toBe(1);
    expect(resolveUnitFactor(setup, "")).toBe(1);
    expect(resolveUnitFactor(setup, "   ")).toBe(1);
    expect(resolveUnitFactor(setup, null)).toBe(1);
    expect(resolveUnitFactor(setup, undefined)).toBe(1);
  });

  it("returns the alternate unit's own factor", () => {
    expect(resolveUnitFactor(setup, "BOX")).toBe(12);
    expect(resolveUnitFactor(setup, " BOX ")).toBe(12);
    expect(resolveUnitFactor(setup, "HALF")).toBe(0.5);
  });

  it("refuses a unit the item does not carry, naming both codes", () => {
    try {
      resolveUnitFactor(setup, "PALLET");
      throw new Error("expected UnknownUnitError");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownUnitError);
      expect((err as UnknownUnitError).code).toBe("UNKNOWN_UNIT");
      expect((err as UnknownUnitError).unitCode).toBe("PALLET");
      expect((err as UnknownUnitError).baseUnitCode).toBe("PCS");
    }
  });
});

describe("toBaseQty / fromBaseQty", () => {
  it("returns the quantity untouched when the factor is exactly one", () => {
    const qty = Qty.fromMajor("7.5");
    expect(toBaseQty(qty, 1)).toBe(qty);
    expect(fromBaseQty(qty, 1)).toBe(qty);
  });

  it("converts an alternate unit into the base quantity the stock ledger moves", () => {
    expect(toBaseQty(Qty.fromMajor("3"), 12).toString()).toBe("36.000000");
    expect(toBaseQty(Qty.fromMajor("2.5"), 12).toString()).toBe("30.000000");
    expect(toBaseQty(Qty.fromMajor("4"), 0.5).toString()).toBe("2.000000");
  });

  it("inverts the conversion, so a base quantity reads back in the entered unit", () => {
    expect(fromBaseQty(Qty.fromMajor("36"), 12).toString()).toBe("3.000000");
    expect(fromBaseQty(Qty.fromMajor("2"), 0.5).toString()).toBe("4.000000");
  });

  it("rounds half up at the sixth decimal rather than truncating", () => {
    // 1 ÷ 3 = 0.333333|3… rounds down; 2 ÷ 3 = 0.666666|6… rounds up.
    expect(fromBaseQty(Qty.fromMajor("1"), 3).toString()).toBe("0.333333");
    expect(fromBaseQty(Qty.fromMajor("2"), 3).toString()).toBe("0.666667");
  });

  it("keeps the sign through a negative quantity, rounding away from zero at the half", () => {
    expect(toBaseQty(Qty.fromMajor("-3"), 12).toString()).toBe("-36.000000");
    expect(fromBaseQty(Qty.fromMajor("-2"), 3).toString()).toBe("-0.666667");
  });

  it("round-trips a quantity that divides exactly", () => {
    const base = toBaseQty(Qty.fromMajor("5"), 12);
    expect(fromBaseQty(base, 12).toString()).toBe("5.000000");
  });

  it("refuses to convert against a factor the item master could not have held", () => {
    expect(() => toBaseQty(Qty.fromMajor("1"), 0)).toThrow(RangeError);
    expect(() => fromBaseQty(Qty.fromMajor("1"), -2)).toThrow(RangeError);
  });
});
