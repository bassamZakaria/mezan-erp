import { describe, it, expect } from "vitest";
import {
  compileFormula,
  evaluateFormulaMoney,
  evaluateFormulaQty,
  assertFormulaValid,
} from "./formula.js";
import { FormulaError } from "./errors.js";

const money = (formula: string, scope: Record<string, string>) =>
  evaluateFormulaMoney(formula, scope).toString();

describe("sandboxed formula evaluator", () => {
  it("evaluates the catalog's material/price formulas", () => {
    expect(money("2*width", { width: "3" })).toBe("6.000000");
    expect(money("2*(width+height)/100", { width: "10", height: "20" })).toBe("0.600000");
    expect(money("width*height*3.5", { width: "2", height: "4" })).toBe("28.000000");
  });

  it("honours operator precedence and parentheses", () => {
    expect(money("1+2*3", {})).toBe("7.000000");
    expect(money("(1+2)*3", {})).toBe("9.000000");
    expect(money("-width + 5", { width: "2" })).toBe("3.000000");
  });

  it("keeps division exact then rounds HALF_UP at scale 1e-6", () => {
    expect(money("1/3", {})).toBe("0.333333");
    expect(money("2/3", {})).toBe("0.666667");
    // Rationals stay exact through intermediate steps (no float drift).
    expect(money("(1/3)*3", {})).toBe("1.000000");
  });

  it("supports the whitelisted math functions", () => {
    expect(money("min(3, 5, 2)", {})).toBe("2.000000");
    expect(money("max(3, 5, 2)", {})).toBe("5.000000");
    expect(money("abs(0-7)", {})).toBe("7.000000");
    expect(money("floor(7/2)", {})).toBe("3.000000");
    expect(money("ceil(7/2)", {})).toBe("4.000000");
    expect(money("round(2/3, 2)", {})).toBe("0.670000");
  });

  it("evaluates to Qty as well", () => {
    expect(evaluateFormulaQty("2*(w+h)", { w: "1.5", h: "0.5" }).toString()).toBe("4.000000");
  });

  it("supports Arabic identifiers as variables", () => {
    expect(money("عرض*2", { عرض: "3" })).toBe("6.000000");
  });

  // --- SECURITY: no eval/Function, no host reach --------------------------
  it("NEVER reaches JavaScript globals or host objects", () => {
    // Bare identifiers only resolve against the supplied scope.
    expect(() => money("process", {})).toThrow(FormulaError);
    expect(() => money("globalThis", {})).toThrow(FormulaError);
    expect(() => money("constructor", {})).toThrow(FormulaError);
    expect(() => money("__proto__", {})).toThrow(FormulaError);
  });

  it("rejects unknown variables at evaluation with an EVAL error", () => {
    try {
      money("width + depth", { width: "1" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaError);
      expect((err as FormulaError).code).toBe("MANUFACTURING_FORMULA_EVAL");
    }
  });

  it("rejects arbitrary code / unsupported syntax at parse", () => {
    for (const bad of [
      "1; 2",
      "a.b",
      "eval('1')",
      "Function('return 1')",
      "1 == 1",
      "a ? b : c",
      "[1,2]",
      "1 & 2",
      "`x`",
    ]) {
      try {
        assertFormulaValid(bad);
        throw new Error(`should have rejected: ${bad}`);
      } catch (err) {
        expect(err).toBeInstanceOf(FormulaError);
        expect((err as FormulaError).code).toBe("MANUFACTURING_FORMULA_PARSE");
      }
    }
  });

  it("rejects unknown function calls at parse", () => {
    expect(() => assertFormulaValid("power(2, 3)")).toThrow(FormulaError);
  });

  it("throws EVAL on division by zero", () => {
    try {
      money("1/(width-width)", { width: "5" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as FormulaError).code).toBe("MANUFACTURING_FORMULA_EVAL");
    }
  });

  it("compiles once and reuses across specs", () => {
    const f = compileFormula("width*rate");
    expect(f.evaluateMoney({ width: "2", rate: "3" }).toString()).toBe("6.000000");
    expect(f.evaluateMoney({ width: "5", rate: "3" }).toString()).toBe("15.000000");
  });
});
