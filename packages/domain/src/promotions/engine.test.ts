import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Promotion } from "./promotion.js";
import {
  evaluateBestPromotion,
  findEligiblePromotions,
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
    dayOfWeek: 1, // Monday
    hour: 12,
    ...overrides,
  };
}

describe("percentage promotions", () => {
  it("discounts only the scoped lines, distributed proportionally", () => {
    const p = promo({ id: "p1", type: "percentage", percentValue: 10, scope: { type: "item", ids: ["A"] } });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "1000.00" });
    const lineB = line({ lineId: "L2", itemId: "B", qty: "1", unitPrice: "500.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA, lineB], subtotal: Money.fromMajor("1500.00") }));

    expect(result).not.toBeNull();
    expect(result?.discountTotal.toString()).toBe("100.000000");
    expect(result?.lineDiscounts).toEqual([{ lineId: "L1", amount: expect.objectContaining({ scaled: 100_000_000n }) }]);
  });
});

describe("fixed_amount promotions", () => {
  it("caps the discount at the scoped subtotal", () => {
    const p = promo({ id: "p2", type: "fixed_amount", amountValue: Money.fromMajor("5000.00") });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "1000.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("1000.00") }));

    expect(result?.discountTotal.toString()).toBe("1000.000000");
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("1000.000000");
  });

  it("discounts by the fixed amount when below the subtotal", () => {
    const p = promo({ id: "p2b", type: "fixed_amount", amountValue: Money.fromMajor("30.00") });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "70.00" });
    const lineB = line({ lineId: "L2", itemId: "B", qty: "1", unitPrice: "30.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA, lineB], subtotal: Money.fromMajor("100.00") }));

    expect(result?.discountTotal.toString()).toBe("30.000000");
    // weighted 70/30 -> 21/9
    expect(result?.lineDiscounts.find((d) => d.lineId === "L1")?.amount.toString()).toBe("21.000000");
    expect(result?.lineDiscounts.find((d) => d.lineId === "L2")?.amount.toString()).toBe("9.000000");
  });
});

describe("special_price promotions", () => {
  it("discounts a scoped line down to the special price, leaving an out-of-scope line untouched", () => {
    const p = promo({ id: "p3", type: "special_price", amountValue: Money.fromMajor("8.00"), scope: { type: "item", ids: ["A"] } });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "3", unitPrice: "10.00" });
    const lineB = line({ lineId: "L2", itemId: "B", qty: "2", unitPrice: "20.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA, lineB], subtotal: Money.fromMajor("70.00") }));

    expect(result?.discountTotal.toString()).toBe("6.000000"); // 30 - 24
    expect(result?.lineDiscounts).toHaveLength(1);
    expect(result?.lineDiscounts[0]).toMatchObject({ lineId: "L1" });
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("6.000000");
  });
});

describe("buy_x_get_y promotions", () => {
  it("computes free units and their discount for a buy-2-get-1 offer", () => {
    const p = promo({ id: "p4", type: "buy_x_get_y", buyQty: 2, getQty: 1 });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "9", unitPrice: "10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("90.00") }));

    // 9 units / group-of-3 = 3 groups -> 3 free units * 10.00 = 30.00
    expect(result?.discountTotal.toString()).toBe("30.000000");
    expect(result?.freeGoods).toEqual([{ itemId: "A", qty: expect.objectContaining({ scaled: 3_000_000n }) }]);
    expect(result?.lineDiscounts[0]?.amount.toString()).toBe("30.000000");
  });

  it("grants no free units below one full group", () => {
    const p = promo({ id: "p4b", type: "buy_x_get_y", buyQty: 2, getQty: 1 });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "2", unitPrice: "10.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("20.00") }));

    expect(result?.discountTotal.toString()).toBe("0.000000");
    expect(result?.freeGoods).toEqual([]);
  });
});

describe("bundle promotions", () => {
  it("computes the bundle discount across two components proportional to their regular cost", () => {
    const p = promo({
      id: "p5",
      type: "bundle",
      amountValue: Money.fromMajor("100.00"),
      bundleComponents: [
        { itemId: "X", qty: Qty.fromMajor("1") },
        { itemId: "Y", qty: Qty.fromMajor("2") },
      ],
    });
    const lineX = line({ lineId: "LX", itemId: "X", qty: "5", unitPrice: "60.00" });
    const lineY = line({ lineId: "LY", itemId: "Y", qty: "10", unitPrice: "30.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [p], lines: [lineX, lineY], subtotal: Money.fromMajor("900.00") }));

    // bundleCount = min(floor(5/1), floor(10/2)) = 5
    // regularCost = 5*(1*60) + 5*(2*30) = 300 + 300 = 600; bundlePrice = 5*100 = 500 -> discount 100
    expect(result?.discountTotal.toString()).toBe("100.000000");
    expect(result?.lineDiscounts.find((d) => d.lineId === "LX")?.amount.toString()).toBe("50.000000");
    expect(result?.lineDiscounts.find((d) => d.lineId === "LY")?.amount.toString()).toBe("50.000000");
  });

  it("is not eligible when a component is missing entirely", () => {
    const p = promo({
      id: "p5b",
      type: "bundle",
      amountValue: Money.fromMajor("100.00"),
      bundleComponents: [
        { itemId: "X", qty: Qty.fromMajor("1") },
        { itemId: "Z", qty: Qty.fromMajor("1") },
      ],
    });
    const lineX = line({ lineId: "LX", itemId: "X", qty: "5", unitPrice: "60.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineX], subtotal: Money.fromMajor("300.00") }));
    expect(eligible).toEqual([]);
  });
});

describe("date-range eligibility", () => {
  it("excludes an expired promotion", () => {
    const p = promo({ id: "p6", type: "percentage", percentValue: 10, startDate: "2025-01-01", endDate: "2025-12-31" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), date: "2026-06-15" }));
    expect(eligible).toEqual([]);
  });

  it("excludes a not-yet-started (scheduled) promotion", () => {
    const p = promo({ id: "p7", type: "percentage", percentValue: 10, startDate: "2027-01-01", endDate: "2027-12-31" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), date: "2026-06-15" }));
    expect(eligible).toEqual([]);
  });
});

describe("coupon requirement", () => {
  it("excludes a coupon-required promotion when no coupon (or the wrong one) is supplied", () => {
    const p = promo({ id: "p8", type: "percentage", percentValue: 10, code: "SAVE10", requiresCoupon: true });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const withoutCoupon = findEligiblePromotions(baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(withoutCoupon).toEqual([]);

    const withWrongCoupon = findEligiblePromotions(
      baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), couponCode: "NOPE" }),
    );
    expect(withWrongCoupon).toEqual([]);
  });

  it("includes a coupon-required promotion when the coupon matches (case-insensitive, trimmed)", () => {
    const p = promo({ id: "p9", type: "percentage", percentValue: 10, code: "SAVE10", requiresCoupon: true });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(
      baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), couponCode: "  save10  " }),
    );
    expect(result).not.toBeNull();
    expect(result?.promotion.id).toBe("p9");
  });
});

describe("day/hour restriction", () => {
  it("excludes an evaluation outside the allowed weekday/hour window", () => {
    const p = promo({
      id: "p10",
      type: "percentage",
      percentValue: 10,
      dayHourRestriction: { days: [5, 6], startHour: 18, endHour: 22 }, // Fri/Sat evenings only
    });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(
      baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), dayOfWeek: 1, hour: 12 }),
    );
    expect(eligible).toEqual([]);
  });

  it("includes an evaluation inside the allowed weekday/hour window", () => {
    const p = promo({
      id: "p11",
      type: "percentage",
      percentValue: 10,
      dayHourRestriction: { days: [5, 6], startHour: 18, endHour: 22 },
    });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const eligible = findEligiblePromotions(
      baseInput({ promotions: [p], lines: [lineA], subtotal: Money.fromMajor("100.00"), dayOfWeek: 5, hour: 19 }),
    );
    expect(eligible).toHaveLength(1);
  });
});

describe("priority and tie-break", () => {
  it("prefers the higher-priority promotion", () => {
    const low = promo({ id: "low", type: "percentage", percentValue: 5, priority: 1 });
    const high = promo({ id: "high", type: "percentage", percentValue: 10, priority: 10 });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [low, high], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.promotion.id).toBe("high");
  });

  it("breaks a priority tie by earliest createdAt", () => {
    const later = promo({ id: "later", type: "percentage", percentValue: 5, priority: 1, createdAt: "2026-02-01T00:00:00.000Z" });
    const earlier = promo({ id: "earlier", type: "percentage", percentValue: 10, priority: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [later, earlier], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result?.promotion.id).toBe("earlier");
  });
});

describe("no eligible promotion", () => {
  it("returns null when nothing is eligible", () => {
    const lineA = line({ lineId: "L1", itemId: "A", qty: "1", unitPrice: "100.00" });
    const result = evaluateBestPromotion(baseInput({ promotions: [], lines: [lineA], subtotal: Money.fromMajor("100.00") }));
    expect(result).toBeNull();
  });
});
