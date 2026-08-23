import { describe, expect, it } from "vitest";
import { evaluateCondition } from "./condition.js";

describe("evaluateCondition", () => {
  it("passes unconditionally when there is no condition", () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(null, undefined)).toBe(true);
  });

  it("fails when the payload is not an object", () => {
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "100" }, "oops")).toBe(false);
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "100" }, null)).toBe(false);
  });

  it("fails when the field is missing from the payload", () => {
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "100" }, { other: 1 })).toBe(false);
  });

  it("eq / neq compare as strings", () => {
    expect(evaluateCondition({ field: "status", operator: "eq", value: "overdue" }, { status: "overdue" })).toBe(true);
    expect(evaluateCondition({ field: "status", operator: "eq", value: "overdue" }, { status: "paid" })).toBe(false);
    expect(evaluateCondition({ field: "status", operator: "neq", value: "overdue" }, { status: "paid" })).toBe(true);
  });

  it("contains does substring matching", () => {
    expect(evaluateCondition({ field: "documentNumber", operator: "contains", value: "INV" }, { documentNumber: "INV-000123" })).toBe(
      true,
    );
    expect(evaluateCondition({ field: "documentNumber", operator: "contains", value: "PO-" }, { documentNumber: "INV-000123" })).toBe(
      false,
    );
  });

  it("gt/gte/lt/lte compare numerically", () => {
    const payload = { amount: 500 };
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "100" }, payload)).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "500" }, payload)).toBe(false);
    expect(evaluateCondition({ field: "amount", operator: "gte", value: "500" }, payload)).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "lt", value: "1000" }, payload)).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "lte", value: "500" }, payload)).toBe(true);
  });

  it("numeric operators fail gracefully on non-numeric values", () => {
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "abc" }, { amount: 10 })).toBe(false);
    expect(evaluateCondition({ field: "amount", operator: "gt", value: "10" }, { amount: "abc" })).toBe(false);
  });
});
