import { describe, it, expect } from "vitest";
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_DEFINITIONS,
  isAdjustmentReason,
  getAdjustmentReasonDefinition,
} from "./reasons.js";

describe("adjustment reasons — the 8 documented reasons (docs/catalog/03)", () => {
  it("encodes exactly 8 reasons including INITIAL_STOCK", () => {
    expect(ADJUSTMENT_REASONS).toHaveLength(8);
    expect(ADJUSTMENT_REASON_DEFINITIONS).toHaveLength(8);
    expect(ADJUSTMENT_REASONS).toContain("INITIAL_STOCK");
  });

  it("INITIAL_STOCK is an IN-only opening-balance reason", () => {
    const def = getAdjustmentReasonDefinition("INITIAL_STOCK");
    expect(def.direction).toBe("IN");
    expect(def.labelAr).toBe("رصيد افتتاحي");
  });

  it("shrinkage reasons are OUT-only", () => {
    for (const code of ["DAMAGE", "THEFT", "EXPIRY", "SHORTAGE", "SUPPLIER_RETURN"] as const) {
      expect(getAdjustmentReasonDefinition(code).direction).toBe("OUT");
    }
  });

  it("physical-count and other allow either direction", () => {
    expect(getAdjustmentReasonDefinition("PHYSICAL_COUNT").direction).toBe("EITHER");
    expect(getAdjustmentReasonDefinition("OTHER").direction).toBe("EITHER");
  });

  it("isAdjustmentReason guards unknown codes", () => {
    expect(isAdjustmentReason("INITIAL_STOCK")).toBe(true);
    expect(isAdjustmentReason("NOPE")).toBe(false);
  });
});
