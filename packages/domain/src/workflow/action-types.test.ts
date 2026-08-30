import { describe, it, expect } from "vitest";
import { GATEABLE_ACTION_TYPES, isGateableActionType } from "./action-types.js";

describe("GATEABLE_ACTION_TYPES", () => {
  it("has 26 unique codes, each with an Arabic and English label and a category", () => {
    expect(GATEABLE_ACTION_TYPES).toHaveLength(26);
    const codes = GATEABLE_ACTION_TYPES.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const action of GATEABLE_ACTION_TYPES) {
      expect(action.labelAr.trim()).not.toBe("");
      expect(action.labelEn.trim()).not.toBe("");
      expect(action.category.trim()).not.toBe("");
    }
  });
});

describe("isGateableActionType", () => {
  it("is true for every catalogued code", () => {
    for (const action of GATEABLE_ACTION_TYPES) {
      expect(isGateableActionType(action.code)).toBe(true);
    }
  });

  it("is false for an unknown code, a permission-shaped string, and the empty string", () => {
    expect(isGateableActionType("NOT_A_REAL_ACTION")).toBe(false);
    expect(isGateableActionType("sales.invoice.confirm")).toBe(false);
    expect(isGateableActionType("")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isGateableActionType("sales_invoice_confirm")).toBe(false);
  });
});
