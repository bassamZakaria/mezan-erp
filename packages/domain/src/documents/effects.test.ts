import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildEffects } from "./effects.js";

describe("buildEffects", () => {
  it("defaults blocked to false and passes through effect lines", () => {
    const effects = buildEffects({
      effects: [{ kind: "info", description: "لا يوجد تأثير" }],
    });
    expect(effects.blocked).toBe(false);
    expect(effects.blockedReason).toBeUndefined();
    expect(effects.effects).toHaveLength(1);
    expect(effects.effects[0]?.description).toBe("لا يوجد تأثير");
  });

  it("carries balanced/totals/blockedReason through unchanged", () => {
    const totalDebit = Money.fromMajor("100");
    const totalCredit = Money.fromMajor("90");
    const effects = buildEffects({
      effects: [{ kind: "gl", description: "قيد غير متوازن" }],
      balanced: false,
      totalDebit,
      totalCredit,
      blocked: true,
      blockedReason: "القيد غير متوازن",
    });
    expect(effects.balanced).toBe(false);
    expect(effects.totalDebit?.equals(totalDebit)).toBe(true);
    expect(effects.totalCredit?.equals(totalCredit)).toBe(true);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("القيد غير متوازن");
  });

  it("an explicit blocked:false with a reason still exposes the reason (caller's choice, not silently dropped)", () => {
    const effects = buildEffects({
      effects: [],
      blocked: false,
      blockedReason: "غير مستخدم",
    });
    expect(effects.blocked).toBe(false);
    expect(effects.blockedReason).toBe("غير مستخدم");
  });
});
