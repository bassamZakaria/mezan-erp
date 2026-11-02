import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

/** Raised when a promotion draft fails validation; `reasons` lists every failure, in Arabic, for the UI to show verbatim. */
export class InvalidPromotionError extends Error {
  readonly code = "INVALID_PROMOTION";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`بيانات العرض غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid promotion: ${split.en}`;
    this.name = "InvalidPromotionError";
  }
}

/** Raised when an operation references a promotion id that does not exist. */
export class PromotionNotFoundError extends Error {
  readonly code = "PROMOTION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly promotionId: string) {
    super(`العرض "${promotionId}" غير موجود.`);
    this.messageEn = `Promotion "${promotionId}" was not found.`;
    this.name = "PromotionNotFoundError";
  }
}

/** Raised when a promotion code already exists (codes are unique across promotions). */
export class DuplicatePromotionError extends Error {
  readonly code = "DUPLICATE_PROMOTION";
  readonly messageEn: string;
  constructor(readonly promotionCode: string) {
    super(`كود العرض "${promotionCode}" مستخدم من قبل.`);
    this.messageEn = `Promotion code "${promotionCode}" already exists.`;
    this.name = "DuplicatePromotionError";
  }
}

/** كود الكوبون مطلوب — raised when a promotion requires a coupon but none, or a mismatched one, was supplied. */
export class CouponRequiredError extends Error {
  readonly code = "COUPON_REQUIRED";
  readonly messageEn: string;
  constructor(readonly promotionCode: string) {
    super(`العرض "${promotionCode}" يتطلب كود كوبون مطابق.`);
    this.messageEn = `Promotion "${promotionCode}" requires a matching coupon code.`;
    this.name = "CouponRequiredError";
  }
}
