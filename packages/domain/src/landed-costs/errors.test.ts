import { describe, it, expect } from "vitest";
import { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./errors.js";

describe("landed-cost errors", () => {
  it("EmptyLandedCostTargetsError has a fixed code and message", () => {
    const err = new EmptyLandedCostTargetsError();
    expect(err.code).toBe("EMPTY_LANDED_COST_TARGETS");
    expect(err.name).toBe("EmptyLandedCostTargetsError");
    expect(err.message).toContain("بند فاتورة هدف واحداً على الأقل");
    expect(err.messageEn).toContain("at least one target invoice line");
    expect(err).toBeInstanceOf(Error);
  });

  it("ZeroLandedCostWeightError names the distribution method", () => {
    const err = new ZeroLandedCostWeightError("BY_QUANTITY");
    expect(err.code).toBe("ZERO_LANDED_COST_WEIGHT");
    expect(err.method).toBe("BY_QUANTITY");
    expect(err.message).toBe('تعذّر توزيع التكلفة الإضافية بطريقة "حسب الكمية": كل بنود الهدف وزنها صفر.');
    expect(err.messageEn).toBe("Cannot distribute landed cost BY_QUANTITY: every target line has a zero weight.");
  });
});
