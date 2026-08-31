import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Promotion } from "./promotion.js";
import {
  evaluateBestPromotion,
  findEligiblePromotions,
  extendLine,
  type EvaluatePromotionsInput,
  type PromotionLineInput,
} from "./engine.js";

function promo(overrides: Partial<Promotion> & { id: string; type: Promotion["type"] }): Promotion {
  return {
    code: overrides.id.toUpperCase(),
    priority: 0,
    nameAr: "عرض",
    nameEn: null,
    description: null,
    percentValue: null,
    amountValue: null,
    minInvoiceValue: null,
    minQty: null,
    maxDiscountAmount: null,
    buyQty: null,
    getQty: null,
    bundleComponents: [],
    requiresCoupon: false,
    dayHourRestriction: null,
    scope: { type: "all", ids: [] },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface LineOverrides {
  readonly lineId: string;
  readonly itemId: string;
  readonly qty: string;
  readonly unitPrice: string;
  readonly categoryId?: string | null;
  readonly lineTotal?: Money;
}

function line(overrides: LineOverrides): PromotionLineInput {
  const qty = Qty.fromMajor(overrides.qty);
  const unitPrice = Money.fromMajor(overrides.unitPrice);
  return {
    lineId: overrides.lineId,
    itemId: overrides.itemId,
    categoryId: overrides.categoryId ?? null,
    qty,
    unitPrice,
    lineTotal: overrides.lineTotal ?? Money.fromMajor((Number(overrides.qty) * Number(overrides.unitPrice)).toFixed(2)),
  };
}

function baseInput(overrides: Partial<EvaluatePromotionsInput>): EvaluatePromotionsInput {
  return {
    promotions: [],
    lines: [],
    subtotal: Money.zero(),
    date: "2026-06-15",
    dayOfWeek: 1,
    hour: 12,
    ...overrides,
  };
}

describe("extendLine rounds HALF_UP on the magnitude, in both directions and both signs", () => {
  it("rounds down when the remainder is under half the divisor", () => {
    expect(extendLine(Qty.fromMajor("1.000001"), Money.fromMajor("1.000001")).toString()).toBe("1.000000");
  });

  it("rounds up when the remainder is at or over half the divisor", () => {
    expect(extendLine(Qty.fromMajor("0.333333"), Money.fromMajor("3.333333")).toString()).toBe("1.110000");
  });

  it("carries a negative unit price through as a negative extension, rounded on the magnitude", () => {
    expect(extendLine(Qty.fromMajor("0.333333"), Money.fromMajor("-3.333333")).toString()).toBe("-1.110000");
  });
});

describe("percentOf returns zero outright for a zero percent, without dividing", () => {
  it("a percentage promotion with no percentValue set discounts nothing", () => {
    const p = promo({ id: "p-zero-pct", type: "percentage" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.discountTotal.toString()).toBe("0.000000");
  });
});

describe("fixed_amount and special_price fall back to zero when their amount is unset", () => {
  it("a fixed_amount promotion with no amountValue discounts nothing", () => {
    const p = promo({ id: "p-no-amt", type: "fixed_amount" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.discountTotal.toString()).toBe("0.000000");
  });

  it("a special_price promotion with no amountValue prices the line at zero, discounting the full line", () => {
    const p = promo({ id: "p-no-special", type: "special_price", scope: { type: "item", ids: ["A"] } });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "2", unitPrice: "10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("20.00") }));
    expect(result?.discountTotal.toString()).toBe("20.000000");
  });

  it("a special_price at or above the line's own price discounts nothing", () => {
    const p = promo({ id: "p-no-savings", type: "special_price", amountValue: Money.fromMajor("15.00"), scope: { type: "item", ids: ["A"] } });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("10.00") }));
    expect(result?.discountTotal.toString()).toBe("0.000000");
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("0.000000");
  });
});

describe("buy_x_get_y with no buyQty/getQty configured gives nothing away", () => {
  it("treats a missing group size as ineligible for any free units", () => {
    const p = promo({ id: "p-no-group", type: "buy_x_get_y" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "100", unitPrice: "10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("1000.00") }));
    expect(result?.discountTotal.toString()).toBe("0.000000");
    expect(result?.freeGoods).toEqual([]);
  });
});

describe("bundle eligibility guards", () => {
  it("is ineligible with no bundle components configured at all", () => {
    const p = promo({ id: "p-empty-bundle", type: "bundle" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "5", unitPrice: "10.00" });
    expect(findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("50.00") }))).toEqual([]);
  });

  it("is ineligible when a bundle component's own required quantity is zero", () => {
    const p = promo({
      id: "p-zero-component-qty",
      type: "bundle",
      amountValue: Money.fromMajor("5.00"),
      bundleComponents: [{ itemId: "A", qty: Qty.zero() }],
    });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "5", unitPrice: "10.00" });
    expect(findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("50.00") }))).toEqual([]);
  });

  it("gives no bundle discount when the bundle price is at or above the components' regular cost", () => {
    const p = promo({
      id: "p-no-bundle-savings",
      type: "bundle",
      amountValue: Money.fromMajor("100.00"),
      bundleComponents: [{ itemId: "X", qty: Qty.fromMajor("1") }],
    });
    const lineX = line({ lineId: "LX", itemId: "X", qty: "1", unitPrice: "50.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineX], subtotal: Money.fromMajor("50.00") }));
    expect(result?.discountTotal.toString()).toBe("0.000000");
  });

  it("prices the bundle at zero when no amountValue is configured, discounting the full regular cost", () => {
    const p = promo({
      id: "p-free-bundle",
      type: "bundle",
      bundleComponents: [{ itemId: "X", qty: Qty.fromMajor("1") }],
    });
    const lineX = line({ lineId: "LX", itemId: "X", qty: "1", unitPrice: "50.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineX], subtotal: Money.fromMajor("50.00") }));
    expect(result?.discountTotal.toString()).toBe("50.000000");
  });

  it("DEFECT: a negative component price produces a positive bundle discount with nowhere to attribute it, and the cap then zeroes it out entirely", () => {
    // bundleComponents/unitPrice are caller-supplied and unvalidated for sign,
    // so a negative unit price on a bundled item is not refused. It makes the
    // component's own weight non-positive, so distributeByLineTotal-style
    // allocation (here inlined in computeBundle/applyCap) has no line to give
    // the money to — the discount is real but unattributed, and a cap on top
    // of it discards the discount rather than trimming it.
    const p = promo({
      id: "p-negative-component",
      type: "bundle",
      amountValue: Money.fromMajor("-1000.00"),
      maxDiscountAmount: Money.fromMajor("50.00"),
      bundleComponents: [{ itemId: "X", qty: Qty.fromMajor("1") }],
    });
    const lineX = line({ lineId: "LX", itemId: "X", qty: "5", unitPrice: "-10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineX], subtotal: Money.fromMajor("-50.00") }));
    expect(result).not.toBeNull();
    expect(result?.discountTotal.toString()).toBe("0.000000");
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("0.000000");
  });
});

describe("applyCap clamps a negative individual line discount to zero weight when re-splitting the cap", () => {
  it("DEFECT: a buy_x_get_y line priced negatively contributes a negative per-line discount, which the cap re-split then excludes entirely", () => {
    const p = promo({ id: "p-cap-negative-line", type: "buy_x_get_y", buyQty: 1, getQty: 1, maxDiscountAmount: Money.fromMajor("50.00") });
    const linePositive = line({ lineId: "LP", itemId: "P", qty: "4", unitPrice: "100.00" });
    const lineNegative = line({ lineId: "LN", itemId: "N", qty: "4", unitPrice: "-30.00" });
    const result = evaluateBestPromotion(
      baseInput({ promotions: [p], lines: [linePositive, lineNegative], subtotal: Money.fromMajor("280.00") }),
    );
    expect(result?.discountTotal.toString()).toBe("50.000000");
    expect(result?.lineDiscounts.find((d) => d.lineId === "LP")?.amount.toString()).toBe("50.000000");
    expect(result?.lineDiscounts.find((d) => d.lineId === "LN")?.amount.toString()).toBe("0.000000");
  });
});

describe("distributeByLineTotal has nothing to attribute a discount to when every scoped line's own total is non-positive", () => {
  it("DEFECT: a negative-lineTotal line yields a non-zero discountTotal with an all-zero line breakdown, so the parts do not sum to the total", () => {
    const p = promo({ id: "p-negative-line", type: "percentage", percentValue: 10, scope: { type: "item", ids: ["A"] } });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00", lineTotal: Money.fromMajor("-100.00") });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("-100.00") }));
    expect(result).not.toBeNull();
    expect(result?.discountTotal.toString()).toBe("-10.000000");
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("0.000000");
  });
});

describe("active flag gates eligibility before anything else", () => {
  it("excludes an inactive promotion even when every other condition is met", () => {
    const p = promo({ id: "p-inactive", type: "percentage", percentValue: 10, active: false });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    expect(findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00") }))).toEqual([]);
  });
});

describe("overnight day/hour window (start hour after end hour wraps past midnight)", () => {
  const overnight = { days: [1], startHour: 22, endHour: 3 };

  it("includes an hour at or after the start (before midnight)", () => {
    const p = promo({ id: "p-over-1", type: "percentage", percentValue: 10, dayHourRestriction: overnight });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), dayOfWeek: 1, hour: 23 }));
    expect(eligible).toHaveLength(1);
  });

  it("includes an hour at or before the end (after midnight)", () => {
    const p = promo({ id: "p-over-2", type: "percentage", percentValue: 10, dayHourRestriction: overnight });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), dayOfWeek: 1, hour: 2 }));
    expect(eligible).toHaveLength(1);
  });

  it("excludes an hour in the middle of the day, outside the overnight window", () => {
    const p = promo({ id: "p-over-3", type: "percentage", percentValue: 10, dayHourRestriction: overnight });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), dayOfWeek: 1, hour: 12 }));
    expect(eligible).toEqual([]);
  });
});

describe("priority tie-break — the createdAt comparison's own branches", () => {
  it("keeps the earlier-created promotion first when it is already ahead in the array", () => {
    const earlier = promo({ id: "p-early", type: "percentage", percentValue: 5, priority: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const later = promo({ id: "p-late", type: "percentage", percentValue: 10, priority: 1, createdAt: "2026-02-01T00:00:00.000Z" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [earlier, later], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.promotion.id).toBe("p-early");
  });

  it("leaves two promotions with an identical priority AND createdAt in their original order", () => {
    const first = promo({ id: "p-first", type: "percentage", percentValue: 5, priority: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const second = promo({ id: "p-second", type: "percentage", percentValue: 10, priority: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [first, second], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.promotion.id).toBe("p-first");
  });
});
