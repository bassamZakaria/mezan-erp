import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { collectPromotionValidationReasons, type PromotionDraft } from "./promotion.js";

function draft(overrides: Partial<PromotionDraft> & { type: PromotionDraft["type"] }): PromotionDraft {
  return {
    code: "P",
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
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    active: true,
    ...overrides,
  };
}

describe("buy_x_get_y requires a positive buyQty and a positive getQty independently", () => {
  it("refuses a zero or negative buyQty even when getQty is fine", () => {
    expect(collectPromotionValidationReasons(draft({ type: "buy_x_get_y", buyQty: 0, getQty: 1 }))).toContain(
      "كمية الشراء (X) يجب أن تكون أكبر من صفر.",
    );
  });

  it("refuses a zero or negative getQty even when buyQty is fine", () => {
    const reasons = collectPromotionValidationReasons(draft({ type: "buy_x_get_y", buyQty: 1, getQty: -1 }));
    expect(reasons).toContain("الكمية المجانية (Y) يجب أن تكون أكبر من صفر.");
    expect(reasons).not.toContain("كمية الشراء (X) يجب أن تكون أكبر من صفر.");
  });

  it("accepts a positive buyQty and getQty", () => {
    expect(collectPromotionValidationReasons(draft({ type: "buy_x_get_y", buyQty: 2, getQty: 1 }))).toEqual([]);
  });
});

describe("minQty must be strictly positive when supplied at all", () => {
  it("is not required — a null minQty is valid", () => {
    expect(collectPromotionValidationReasons(draft({ type: "percentage", percentValue: 10, minQty: null }))).toEqual([]);
  });

  it("refuses a zero minQty", () => {
    expect(
      collectPromotionValidationReasons(draft({ type: "percentage", percentValue: 10, minQty: Qty.zero() })),
    ).toContain("الحد الأدنى للكمية يجب أن يكون أكبر من صفر.");
  });

  it("accepts a positive minQty", () => {
    expect(
      collectPromotionValidationReasons(draft({ type: "percentage", percentValue: 10, minQty: Qty.fromMajor("5") })),
    ).toEqual([]);
  });
});

describe("maxDiscountAmount must be strictly positive, and is incompatible with buy_x_get_y specifically", () => {
  it("refuses a zero maxDiscountAmount", () => {
    expect(
      collectPromotionValidationReasons(draft({ type: "percentage", percentValue: 10, maxDiscountAmount: Money.zero() })),
    ).toContain("الحد الأقصى للخصم يجب أن يكون أكبر من صفر.");
  });

  it("accepts a positive maxDiscountAmount on a type other than buy_x_get_y", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, maxDiscountAmount: Money.fromMajor("50.00") }),
      ),
    ).toEqual([]);
  });

  it("refuses ANY maxDiscountAmount, even a positive one, on a buy_x_get_y promotion", () => {
    const reasons = collectPromotionValidationReasons(
      draft({ type: "buy_x_get_y", buyQty: 1, getQty: 1, maxDiscountAmount: Money.fromMajor("50.00") }),
    );
    expect(reasons).toContain('الحد الأقصى للخصم لا يتوافق مع نوع "اشترِ X واحصل على Y" — الخصم فيه أصناف مجانية لا مبلغ.');
  });

  it("does not raise the buy_x_get_y incompatibility when no maxDiscountAmount is set", () => {
    const reasons = collectPromotionValidationReasons(draft({ type: "buy_x_get_y", buyQty: 1, getQty: 1 }));
    expect(reasons).not.toContain('الحد الأقصى للخصم لا يتوافق مع نوع "اشترِ X واحصل على Y" — الخصم فيه أصناف مجانية لا مبلغ.');
  });
});

describe("dayHourRestriction hour bounds — start and end are each checked", () => {
  it("accepts a restriction whose start and end hours are both in range", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, dayHourRestriction: { days: [1, 2], startHour: 9, endHour: 17 } }),
      ),
    ).toEqual([]);
  });

  it("refuses an out-of-range start hour", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, dayHourRestriction: { days: [1], startHour: 24, endHour: 17 } }),
      ),
    ).toContain("ساعات تقييد العرض يجب أن تكون بين 0 و 23.");
  });

  it("refuses an out-of-range end hour even when the start hour is fine", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, dayHourRestriction: { days: [1], startHour: 9, endHour: -1 } }),
      ),
    ).toContain("ساعات تقييد العرض يجب أن تكون بين 0 و 23.");
  });

  it("refuses a day outside 0..6", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, dayHourRestriction: { days: [7], startHour: 9, endHour: 17 } }),
      ),
    ).toContain("أيام تقييد العرض يجب أن تكون بين 0 (الأحد) و 6 (السبت).");
  });

  it("refuses a non-integer day", () => {
    expect(
      collectPromotionValidationReasons(
        draft({ type: "percentage", percentValue: 10, dayHourRestriction: { days: [1.5], startHour: 9, endHour: 17 } }),
      ),
    ).toContain("أيام تقييد العرض يجب أن تكون بين 0 (الأحد) و 6 (السبت).");
  });
});
