import { describe, it, expect } from "vitest";
import { InvalidPromotionError, PromotionNotFoundError, DuplicatePromotionError, CouponRequiredError } from "./errors.js";

describe("InvalidPromotionError", () => {
  it("carries its reasons and joins them into the message", () => {
    const err = new InvalidPromotionError(["كود العرض مطلوب.", "اسم العرض بالعربية مطلوب."]);
    expect(err.code).toBe("INVALID_PROMOTION");
    expect(err.name).toBe("InvalidPromotionError");
    expect(err.reasons).toEqual(["كود العرض مطلوب.", "اسم العرض بالعربية مطلوب."]);
    expect(err.message).toBe("Invalid promotion: كود العرض مطلوب.; اسم العرض بالعربية مطلوب.");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("PromotionNotFoundError", () => {
  it("carries the missing id", () => {
    const err = new PromotionNotFoundError("promo-99");
    expect(err.code).toBe("PROMOTION_NOT_FOUND");
    expect(err.name).toBe("PromotionNotFoundError");
    expect(err.promotionId).toBe("promo-99");
    expect(err.message).toBe('Promotion "promo-99" was not found.');
  });
});

describe("DuplicatePromotionError", () => {
  it("carries the duplicated code", () => {
    const err = new DuplicatePromotionError("SUMMER10");
    expect(err.code).toBe("DUPLICATE_PROMOTION");
    expect(err.name).toBe("DuplicatePromotionError");
    expect(err.promotionCode).toBe("SUMMER10");
    expect(err.message).toBe('Promotion code "SUMMER10" already exists.');
  });
});

describe("CouponRequiredError", () => {
  it("carries the promotion code", () => {
    const err = new CouponRequiredError("SUMMER10");
    expect(err.code).toBe("COUPON_REQUIRED");
    expect(err.name).toBe("CouponRequiredError");
    expect(err.promotionCode).toBe("SUMMER10");
    expect(err.message).toBe('Promotion "SUMMER10" requires a matching coupon code.');
  });
});
