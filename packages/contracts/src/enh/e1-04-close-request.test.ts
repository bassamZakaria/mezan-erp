import { describe, expect, it } from "vitest";
import { periodCloseRequestSchema } from "./e1-04.js";

describe("the body of a period close or lock", () => {
  it("carries a reason and nothing else — a caller's own verdict on the checks is refused, not ignored", () => {
    expect(periodCloseRequestSchema.safeParse({}).success).toBe(true);
    expect(periodCloseRequestSchema.safeParse({ overrideReason: "أُقفل بتجاوز بعد مراجعة المدير المالي" }).success).toBe(true);
    for (const smuggled of [{ failedChecks: [] }, { passed: true }, { overrideReason: "أُقفل بتجاوز بعد مراجعة المدير المالي", checks: [] }]) {
      expect(periodCloseRequestSchema.safeParse(smuggled).success, JSON.stringify(smuggled)).toBe(false);
    }
  });
});
