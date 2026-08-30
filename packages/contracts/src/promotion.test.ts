import { describe, it, expect } from "vitest";
import {
  promotionTypeSchema,
  promotionScopeSchema,
  promotionBundleComponentSchema,
  promotionDayHourRestrictionSchema,
  promotionSchema,
  createPromotionSchema,
  updatePromotionSchema,
  evaluatePromotionsQuerySchema,
} from "./promotion.js";

describe("promotionTypeSchema", () => {
  it("accepts each known promotion type", () => {
    for (const type of ["percentage", "fixed_amount", "special_price", "buy_x_get_y", "bundle"]) {
      expect(promotionTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(promotionTypeSchema.safeParse("loyalty_points").success).toBe(false);
  });
});

describe("promotionScopeSchema", () => {
  it("accepts a minimal valid scope and preserves it verbatim", () => {
    const scope = { type: "item" as const, ids: ["item-1", "item-2"] };
    const result = promotionScopeSchema.safeParse(scope);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(scope);
  });

  it("rejects a scope type outside the enum", () => {
    const result = promotionScopeSchema.safeParse({ type: "branch", ids: [] });
    expect(result.success).toBe(false);
  });
});

describe("promotionBundleComponentSchema", () => {
  it("accepts a minimal valid component and preserves qty as an exact string", () => {
    const component = { itemId: "item-1", qty: "2.500000" };
    const result = promotionBundleComponentSchema.safeParse(component);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.qty).toBe("2.500000");
  });

  it("rejects qty sent as a JS number instead of a string", () => {
    const result = promotionBundleComponentSchema.safeParse({ itemId: "item-1", qty: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe("promotionDayHourRestrictionSchema", () => {
  it("accepts a minimal valid restriction and preserves it verbatim", () => {
    const restriction = { days: [0, 3, 5], startHour: 9, endHour: 17 };
    const result = promotionDayHourRestrictionSchema.safeParse(restriction);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(restriction);
  });

  it("rejects an hour outside 0-23", () => {
    const result = promotionDayHourRestrictionSchema.safeParse({ days: [1], startHour: 9, endHour: 24 });
    expect(result.success).toBe(false);
  });

  it("rejects a day outside 0-6", () => {
    const result = promotionDayHourRestrictionSchema.safeParse({ days: [7], startHour: 9, endHour: 17 });
    expect(result.success).toBe(false);
  });
});

describe("promotionSchema", () => {
  const promotion = {
    id: "promo-1",
    code: "SUMMER10",
    priority: 1,
    nameAr: "خصم الصيف",
    nameEn: null,
    description: null,
    type: "percentage" as const,
    percentValue: 10,
    amountValue: null,
    minInvoiceValue: null,
    minQty: null,
    maxDiscountAmount: null,
    buyQty: null,
    getQty: null,
    bundleComponents: [],
    requiresCoupon: false,
    dayHourRestriction: null,
    scope: { type: "all" as const, ids: [] },
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    active: true,
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  it("accepts a minimal valid promotion and preserves every field verbatim", () => {
    const result = promotionSchema.safeParse(promotion);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(promotion);
  });

  it("rejects a promotion missing type", () => {
    const { type, ...rest } = promotion;
    const result = promotionSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("never coerces amountValue to a float — high-precision decimal string survives verbatim", () => {
    const result = promotionSchema.safeParse({ ...promotion, amountValue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountValue).toBe("0.100001");
  });

  it("rejects amountValue sent as a JS number instead of a string", () => {
    const result = promotionSchema.safeParse({ ...promotion, amountValue: 10.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum type", () => {
    const result = promotionSchema.safeParse({ ...promotion, type: "loyalty_points" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = promotionSchema.safeParse({ ...promotion, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("createPromotionSchema", () => {
  const create = {
    code: "SUMMER10",
    nameAr: "خصم الصيف",
    type: "percentage" as const,
    startDate: "2026-06-01",
    endDate: "2026-08-31",
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPromotionSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing endDate", () => {
    const { endDate, ...rest } = create;
    const result = createPromotionSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("endDate");
  });

  it("never coerces amountValue to a float when supplied", () => {
    const result = createPromotionSchema.safeParse({ ...create, amountValue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountValue).toBe("0.100001");
  });

  it("rejects amountValue sent as a JS number instead of a string", () => {
    const result = createPromotionSchema.safeParse({ ...create, amountValue: 10.5 });
    expect(result.success).toBe(false);
  });
});

describe("updatePromotionSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updatePromotionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updatePromotionSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });

  it("rejects an out-of-enum type when supplied", () => {
    const result = updatePromotionSchema.safeParse({ type: "loyalty_points" });
    expect(result.success).toBe(false);
  });
});

describe("evaluatePromotionsQuerySchema", () => {
  const query = {
    lines: [{ lineId: "l1", itemId: "item-1", qty: "2.000000", unitPrice: "50.000000" }],
  };

  it("accepts a minimal valid query and preserves every field verbatim", () => {
    const result = evaluatePromotionsQuerySchema.safeParse(query);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(query);
  });

  it("rejects a query with a line missing qty", () => {
    const badLine = { lineId: "l1", itemId: "item-1", unitPrice: "50.000000" };
    const result = evaluatePromotionsQuerySchema.safeParse({ lines: [badLine] });
    expect(result.success).toBe(false);
  });

  it("rejects unitPrice sent as a JS number instead of a string", () => {
    const badLine = { lineId: "l1", itemId: "item-1", qty: "2.000000", unitPrice: 50 };
    const result = evaluatePromotionsQuerySchema.safeParse({ lines: [badLine] });
    expect(result.success).toBe(false);
  });

  it("accepts an empty lines array", () => {
    const result = evaluatePromotionsQuerySchema.safeParse({ lines: [] });
    expect(result.success).toBe(true);
  });
});
