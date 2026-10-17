import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { evaluatePricingGuard, formatBasisPoints, marginBasisPointsOf } from "./evaluate.js";
import { createPricingGuardRule } from "./rule.js";
import { InvalidPricingGuardRuleError } from "./errors.js";
import {
  PricingGuardBreachKind,
  PricingGuardCostBasis,
  PricingGuardLineOutcome,
  PricingGuardMode,
  PricingGuardRuleStatus,
  type PricingGuardEvaluationLineInput,
  type PricingGuardRule,
} from "./types.js";

const NOW = "2026-10-17T00:00:00.000Z";

function rule(overrides: Partial<PricingGuardRule> & Pick<PricingGuardRule, "id">): PricingGuardRule {
  return {
    nameAr: "قاعدة",
    itemId: null,
    categoryId: null,
    customerCategory: null,
    floorPrice: null,
    minMarginPercent: null,
    mode: PricingGuardMode.Block,
    status: PricingGuardRuleStatus.Active,
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "u",
    updatedBy: "u",
    ...overrides,
  };
}

function line(overrides: Partial<PricingGuardEvaluationLineInput> = {}): PricingGuardEvaluationLineInput {
  return {
    lineId: "L1",
    itemId: "ITM-1",
    categoryIds: ["CAT-CHILD", "CAT-PARENT"],
    baseQty: Qty.fromMajor("10"),
    netBase: Money.fromMajor("1000"),
    unitCostBase: Money.fromMajor("80"),
    costBasis: PricingGuardCostBasis.Wac,
    ...overrides,
  };
}

describe("evaluatePricingGuard", () => {
  it("passes a line at exactly the floor and blocks one a piastre under it", () => {
    const rules = [rule({ id: "R1", itemId: "ITM-1", floorPrice: Money.fromMajor("100") })];
    expect(evaluatePricingGuard(rules, [line()], { customerCategory: null }).outcome).toBe(PricingGuardLineOutcome.Pass);
    const under = evaluatePricingGuard(rules, [line({ netBase: Money.fromMajor("999.99") })], { customerCategory: null });
    expect(under.outcome).toBe(PricingGuardLineOutcome.Blocked);
    expect(under.lines[0]?.breaches.map((b) => b.kind)).toEqual([PricingGuardBreachKind.BelowFloor]);
  });

  it("measures margin on the net selling price, not on cost", () => {
    // net 1000, cost 800 → margin 20% on price (25% markup on cost).
    const at20 = [rule({ id: "R1", minMarginPercent: 20, mode: PricingGuardMode.Approval })];
    expect(evaluatePricingGuard(at20, [line()], { customerCategory: null }).outcome).toBe(PricingGuardLineOutcome.Pass);
    const at21 = [rule({ id: "R1", minMarginPercent: 21, mode: PricingGuardMode.Approval })];
    const result = evaluatePricingGuard(at21, [line()], { customerCategory: null });
    expect(result.outcome).toBe(PricingGuardLineOutcome.NeedsApproval);
    expect(result.lines[0]?.marginBasisPoints).toBe(2000n);
  });

  it("matches a category rule through the item's ancestry and a customer-category rule only for that category", () => {
    const rules = [
      rule({ id: "CAT", categoryId: "CAT-PARENT", minMarginPercent: 30, mode: PricingGuardMode.Approval }),
      rule({ id: "WHOLESALE", customerCategory: "جملة", minMarginPercent: 50 }),
    ];
    const retail = evaluatePricingGuard(rules, [line()], { customerCategory: "قطاعي" });
    expect(retail.outcome).toBe(PricingGuardLineOutcome.NeedsApproval);
    const wholesale = evaluatePricingGuard(rules, [line()], { customerCategory: "جملة" });
    expect(wholesale.outcome).toBe(PricingGuardLineOutcome.Blocked);
    expect(wholesale.lines[0]?.breaches.map((b) => b.ruleId).sort()).toEqual(["CAT", "WHOLESALE"]);
  });

  it("ignores inactive rules and skips the margin test when no cost basis exists", () => {
    const rules = [rule({ id: "OFF", minMarginPercent: 90, status: PricingGuardRuleStatus.Inactive }), rule({ id: "M", minMarginPercent: 90 })];
    const noCost = evaluatePricingGuard(rules, [line({ unitCostBase: null, costBasis: PricingGuardCostBasis.None })], { customerCategory: null });
    expect(noCost.outcome).toBe(PricingGuardLineOutcome.Pass);
    expect(noCost.lines[0]?.marginBasisPoints).toBeNull();
  });

  it("fails a zero-priced line against any positive minimum margin", () => {
    const rules = [rule({ id: "M", minMarginPercent: 1 })];
    expect(evaluatePricingGuard(rules, [line({ netBase: Money.zero() })], { customerCategory: null }).outcome).toBe(PricingGuardLineOutcome.Blocked);
  });
});

describe("margin helpers", () => {
  it("rounds basis points half-up and formats them", () => {
    expect(marginBasisPointsOf(Money.fromMajor("3"), Money.fromMajor("2"))).toBe(3333n);
    expect(formatBasisPoints(3333n)).toBe("33.33");
    expect(formatBasisPoints(-505n)).toBe("-5.05");
  });
});

describe("createPricingGuardRule", () => {
  it("refuses a floor price that names no item and a rule that names both item and category", () => {
    const base = { nameAr: "x", categoryId: null, customerCategory: null, minMarginPercent: null, mode: PricingGuardMode.Block, note: null };
    expect(() => createPricingGuardRule("R", { ...base, itemId: null, floorPrice: Money.fromMajor("5") }, "u", NOW)).toThrow(InvalidPricingGuardRuleError);
    expect(() => createPricingGuardRule("R", { ...base, itemId: "I", categoryId: "C", floorPrice: Money.fromMajor("5") }, "u", NOW)).toThrow(InvalidPricingGuardRuleError);
    expect(createPricingGuardRule("R", { ...base, itemId: "I", floorPrice: Money.fromMajor("5") }, "u", NOW).status).toBe(PricingGuardRuleStatus.Active);
  });
});
