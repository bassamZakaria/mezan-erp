import { describe, expect, it } from "vitest";
import { FormulaError } from "./errors.js";
import {
  assertFormulaValid,
  compileFormula,
  evaluateFormulaMoney,
  evaluateFormulaQty,
} from "./formula.js";

/** The scaled result as a plain decimal string, which is what a caller stores. */
function evalTo(formula: string, scope: Record<string, string> = {}): string {
  return compileFormula(formula).evaluateQty(scope).toString();
}

describe("formula — arithmetic stays exact", () => {
  it("adds, subtracts, multiplies and divides without a float ever appearing", () => {
    expect(evalTo("1 + 2")).toBe("3.000000");
    expect(evalTo("5 - 8")).toBe("-3.000000");
    expect(evalTo("3 * 4")).toBe("12.000000");
    expect(evalTo("10 / 4")).toBe("2.500000");
  });

  it("keeps 0.1 + 0.2 exactly 0.3 — the reason this is rationals and not doubles", () => {
    expect(evalTo("0.1 + 0.2")).toBe("0.300000");
  });

  it("honours precedence and parentheses", () => {
    expect(evalTo("2 + 3 * 4")).toBe("14.000000");
    expect(evalTo("(2 + 3) * 4")).toBe("20.000000");
    expect(evalTo("2 * (3 + 4) / 7")).toBe("2.000000");
  });

  it("applies a leading sign to the whole factor", () => {
    expect(evalTo("-3 + 1")).toBe("-2.000000");
    expect(evalTo("+3 - 1")).toBe("2.000000");
    expect(evalTo("-(2 + 3)")).toBe("-5.000000");
  });

  it("reads a decimal with no integer part, and one with a trailing dot", () => {
    expect(evalTo(".5 + .25")).toBe("0.750000");
    expect(evalTo("2. + 1")).toBe("3.000000");
  });

  it("rounds the projection onto six decimals half-up, on both signs", () => {
    expect(evalTo("1 / 3")).toBe("0.333333");
    expect(evalTo("2 / 3")).toBe("0.666667");
    expect(evalTo("0 - 2 / 3")).toBe("-0.666667");
  });

  it("refuses a division by zero, whether written or reached", () => {
    expect(() => evalTo("1 / 0")).toThrow(FormulaError);
    expect(() => evalTo("1 / (2 - 2)")).toThrow(FormulaError);
  });
});

describe("formula — variables", () => {
  it("substitutes the scope's exact decimal strings", () => {
    expect(evalTo("width * height", { width: "2.5", height: "4" })).toBe("10.000000");
  });

  it("trims a scope value before parsing it", () => {
    expect(evalTo("w + 1", { w: "  2  " })).toBe("3.000000");
  });

  it("refuses a variable the scope does not carry, naming it", () => {
    try {
      evalTo("width * height", { width: "2" });
      throw new Error("expected a FormulaError");
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaError);
      expect((err as FormulaError).message).toContain("height");
    }
  });
});

describe("formula — the six functions it allows", () => {
  it("min and max fold over every argument", () => {
    expect(evalTo("min(3, 1, 2)")).toBe("1.000000");
    expect(evalTo("max(3, 1, 2)")).toBe("3.000000");
    expect(evalTo("min(5)")).toBe("5.000000");
  });

  it("abs turns a negative into its magnitude and leaves a positive alone", () => {
    expect(evalTo("abs(0 - 4.5)")).toBe("4.500000");
    expect(evalTo("abs(4.5)")).toBe("4.500000");
  });

  it("floor and ceil move away from zero only where there is a remainder", () => {
    expect(evalTo("floor(2.7)")).toBe("2.000000");
    expect(evalTo("floor(0 - 2.7)")).toBe("-3.000000");
    expect(evalTo("floor(3)")).toBe("3.000000");
    expect(evalTo("ceil(2.1)")).toBe("3.000000");
    expect(evalTo("ceil(0 - 2.1)")).toBe("-2.000000");
    expect(evalTo("ceil(3)")).toBe("3.000000");
  });

  it("round takes an optional decimal count, defaulting to whole numbers", () => {
    expect(evalTo("round(2.5)")).toBe("3.000000");
    expect(evalTo("round(2.4)")).toBe("2.000000");
    expect(evalTo("round(2.345, 2)")).toBe("2.350000");
    expect(evalTo("round(0 - 2.345, 2)")).toBe("-2.350000");
  });

  it("refuses a function called with the wrong number of arguments", () => {
    expect(() => evalTo("abs(1, 2)")).toThrow(FormulaError);
    expect(() => evalTo("floor()")).toThrow(FormulaError);
    expect(() => evalTo("ceil(1, 2)")).toThrow(FormulaError);
    expect(() => evalTo("min()")).toThrow(FormulaError);
    expect(() => evalTo("max()")).toThrow(FormulaError);
    expect(() => evalTo("round(1, 2, 3)")).toThrow(FormulaError);
  });

  it("refuses a rounding precision that is not a whole number in 0..6", () => {
    expect(() => evalTo("round(1.5, 7)")).toThrow(/0, 6/);
    expect(() => evalTo("round(1.5, 0 - 1)")).toThrow(/0, 6/);
    expect(() => evalTo("round(1.5, 1.5)")).toThrow(/0, 6/);
  });

  it("refuses a function it does not implement", () => {
    expect(() => evalTo("sqrt(4)")).toThrow(/unknown function/);
  });
});

describe("formula — what the parser refuses at save time", () => {
  it("refuses an empty formula", () => {
    expect(() => assertFormulaValid("")).toThrow(FormulaError);
    expect(() => assertFormulaValid("   ")).toThrow(FormulaError);
  });

  it("refuses unbalanced parentheses on either side", () => {
    expect(() => assertFormulaValid("(1 + 2")).toThrow(FormulaError);
    expect(() => assertFormulaValid("1 + 2)")).toThrow(FormulaError);
    expect(() => assertFormulaValid("min(1, 2")).toThrow(FormulaError);
  });

  it("refuses a trailing operator and a stray token", () => {
    expect(() => assertFormulaValid("1 +")).toThrow(FormulaError);
    expect(() => assertFormulaValid("1 2")).toThrow(FormulaError);
  });

  it("refuses a character that is not part of the language", () => {
    expect(() => assertFormulaValid("1 $ 2")).toThrow(FormulaError);
    expect(() => assertFormulaValid("1 # 2")).toThrow(FormulaError);
  });

  it("accepts a formula it can parse, silently", () => {
    expect(() => assertFormulaValid("round(width * height / 2, 3)")).not.toThrow();
  });
});

describe("formula — the one-shot helpers", () => {
  it("evaluates straight to Money and to Qty", () => {
    expect(evaluateFormulaMoney("price * qty", { price: "12.50", qty: "3" }).toString()).toBe("37.500000");
    expect(evaluateFormulaQty("qty * 2", { qty: "1.5" }).toString()).toBe("3.000000");
  });

  it("compiles once and evaluates against several scopes", () => {
    const compiled = compileFormula("w * h");
    expect(compiled.evaluateScaled({ w: "2", h: "3" })).toBe(6_000_000n);
    expect(compiled.evaluateMoney({ w: "2", h: "4" }).toString()).toBe("8.000000");
    expect(compiled.evaluateQty({ w: "2", h: "5" }).toString()).toBe("10.000000");
  });
});
