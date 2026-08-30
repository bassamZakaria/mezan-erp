/**
 * Promotion thresholds — حد أدنى لقيمة الفاتورة، حد أدنى للكمية،
 * الحد الأقصى للخصم — each proved just below, exactly at, and just above.
 *
 * Boundary direction, stated once so a future change has to argue with it:
 *   minInvoiceValue  is INCLUSIVE  (subtotal >= threshold qualifies)
 *   minQty           is INCLUSIVE  (scoped qty >= threshold qualifies)
 *   maxDiscountAmount is INCLUSIVE (a discount EQUAL to the cap is not trimmed)
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Promotion } from "./promotion.js";
import { evaluateBestPromotion, findEligiblePromotions, type EvaluatePromotionsInput, type PromotionLineInput } from "./engine.js";

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

function line(lineId: string, itemId: string, qty: string, unitPrice: string, categoryId: string | null = null): PromotionLineInput {
  const q = Qty.fromMajor(qty);
  const price = Money.fromMajor(unitPrice);
  return { lineId, itemId, categoryId, qty: q, unitPrice: price, lineTotal: Money.fromMajor((Number(qty) * Number(unitPrice)).toFixed(2)) };
}

function input(overrides: Partial<EvaluatePromotionsInput>): EvaluatePromotionsInput {
  return { promotions: [], lines: [], subtotal: Money.zero(), date: "2026-06-15", dayOfWeek: 1, hour: 12, ...overrides };
}

describe("minInvoiceValue — حد أدنى لقيمة الفاتورة", () => {
  const p = promo({ id: "p-min-value", type: "percentage", percentValue: 10, minInvoiceValue: Money.fromMajor("500.00") });

  function at(subtotal: string) {
    return input({ promotions: [p], lines: [line("L1", "A", "1", subtotal)], subtotal: Money.fromMajor(subtotal) });
  }

  it("refuses one piastre BELOW the threshold", () => {
    expect(findEligiblePromotions(at("499.99"))).toHaveLength(0);
    expect(evaluateBestPromotion(at("499.99"))).toBeNull();
  });

  it("qualifies EXACTLY at the threshold — the comparison is >=, not >", () => {
    expect(findEligiblePromotions(at("500.00"))).toHaveLength(1);
    expect(evaluateBestPromotion(at("500.00"))!.discountTotal.toString()).toBe("50.000000");
  });

  it("qualifies one piastre ABOVE the threshold", () => {
    expect(evaluateBestPromotion(at("500.01"))!.discountTotal.toString()).toBe("50.000000");
  });

  it("measures the threshold against the DOCUMENT subtotal, not the scoped subtotal", () => {
    // Scoped to item A only, which is 100.00 of a 500.00 basket. The promotion
    // is still eligible, and discounts only what is in scope.
    const scoped = promo({ ...p, id: "p-scoped", scope: { type: "item", ids: ["A"] } });
    const result = evaluateBestPromotion(
      input({
        promotions: [scoped],
        lines: [line("L1", "A", "1", "100.00"), line("L2", "B", "1", "400.00")],
        subtotal: Money.fromMajor("500.00"),
      }),
    );
    expect(result!.discountTotal.toString()).toBe("10.000000");
    expect(result!.lineDiscounts.map((d) => [d.lineId, d.amount.toString()])).toEqual([["L1", "10.000000"]]);
  });
});

describe("minQty — حد أدنى للكمية", () => {
  const p = promo({
    id: "p-min-qty",
    type: "percentage",
    percentValue: 10,
    minQty: Qty.fromMajor("10"),
    scope: { type: "category", ids: ["CAT-A"] },
  });

  function withQty(qty: string) {
    return input({
      promotions: [p],
      lines: [line("L1", "A", qty, "10.00", "CAT-A")],
      subtotal: Money.fromMajor((Number(qty) * 10).toFixed(2)),
    });
  }

  it("refuses one unit BELOW the threshold", () => {
    expect(findEligiblePromotions(withQty("9"))).toHaveLength(0);
  });

  it("qualifies EXACTLY at the threshold — the comparison is >=, not >", () => {
    const result = evaluateBestPromotion(withQty("10"));
    expect(result).not.toBeNull();
    expect(result!.discountTotal.toString()).toBe("10.000000");
  });

  it("refuses one MICRO-UNIT below the threshold, not merely one whole unit", () => {
    expect(findEligiblePromotions(withQty("9.999999"))).toHaveLength(0);
  });

  it("qualifies one unit ABOVE the threshold", () => {
    expect(evaluateBestPromotion(withQty("11"))!.discountTotal.toString()).toBe("11.000000");
  });

  it("counts only the lines IN SCOPE — quantity bought outside the category does not unlock it", () => {
    const mixed = input({
      promotions: [p],
      lines: [line("L1", "A", "6", "10.00", "CAT-A"), line("L2", "B", "20", "10.00", "CAT-B")],
      subtotal: Money.fromMajor("260.00"),
    });
    expect(findEligiblePromotions(mixed)).toHaveLength(0);
  });

  it("adds up several in-scope lines to reach the threshold — it is a per-cart minimum, not per-line", () => {
    const split = input({
      promotions: [p],
      lines: [line("L1", "A", "4", "10.00", "CAT-A"), line("L2", "B", "6", "10.00", "CAT-A")],
      subtotal: Money.fromMajor("100.00"),
    });
    const result = evaluateBestPromotion(split);
    expect(result!.discountTotal.toString()).toBe("10.000000");
    expect(result!.lineDiscounts.map((d) => d.amount.toString())).toEqual(["4.000000", "6.000000"]);
  });
});

describe("maxDiscountAmount — الحد الأقصى للخصم", () => {
  const lines = [line("L1", "A", "1", "100.00"), line("L2", "B", "1", "100.00"), line("L3", "C", "1", "100.00")];

  function withFixed(amount: string) {
    return input({
      promotions: [
        promo({
          id: "p-cap",
          type: "fixed_amount",
          amountValue: Money.fromMajor(amount),
          maxDiscountAmount: Money.fromMajor("100.00"),
        }),
      ],
      lines,
      subtotal: Money.fromMajor("300.00"),
    });
  }

  it("leaves a discount one piastre BELOW the cap alone", () => {
    const result = evaluateBestPromotion(withFixed("99.99"))!;
    expect(result.discountTotal.toString()).toBe("99.990000");
    expect(result.lineDiscounts.map((d) => d.amount.toString())).toEqual(["33.330000", "33.330000", "33.330000"]);
  });

  it("leaves a discount EXACTLY at the cap alone — the comparison is <=, so equality is not a trim", () => {
    const result = evaluateBestPromotion(withFixed("100.00"))!;
    expect(result.discountTotal.toString()).toBe("100.000000");
    expect(result.lineDiscounts.map((d) => d.amount.toString())).toEqual(["33.340000", "33.330000", "33.330000"]);
  });

  it("trims a discount one piastre ABOVE the cap back to exactly the cap, re-split so the parts still reconcile", () => {
    const result = evaluateBestPromotion(withFixed("100.01"))!;
    expect(result.discountTotal.toString()).toBe("100.000000");
    expect(result.lineDiscounts.map((d) => d.amount.toString())).toEqual(["33.340000", "33.330000", "33.330000"]);
    expect(Money.sum(result.lineDiscounts.map((d) => d.amount)).toString()).toBe("100.000000");
  });

  it("caps a percentage promotion that would otherwise give away half the basket", () => {
    const result = evaluateBestPromotion(
      input({
        promotions: [
          promo({ id: "p-half", type: "percentage", percentValue: 50, maxDiscountAmount: Money.fromMajor("100.00") }),
        ],
        lines,
        subtotal: Money.fromMajor("300.00"),
      }),
    )!;
    // 50% of 300.00 is 150.00; the campaign may only ever give away 100.00.
    expect(result.discountTotal.toString()).toBe("100.000000");
    expect(result.lineDiscounts.map((d) => d.amount.toString())).toEqual(["33.340000", "33.330000", "33.330000"]);
    expect(Money.sum(result.lineDiscounts.map((d) => d.amount)).scaled).toBe(result.discountTotal.scaled);
  });

  it("caps only the promotion that actually applied, at ITS own cap", () => {
    const result = evaluateBestPromotion(
      input({
        promotions: [
          promo({ id: "p-low", type: "percentage", percentValue: 50, priority: 1, maxDiscountAmount: Money.fromMajor("100.00") }),
          promo({ id: "p-high", type: "percentage", percentValue: 20, priority: 9, maxDiscountAmount: Money.fromMajor("10.00") }),
        ],
        lines,
        subtotal: Money.fromMajor("300.00"),
      }),
    )!;
    expect(result.promotion.id).toBe("p-high");
    expect(result.discountTotal.toString()).toBe("10.000000");
  });
});
