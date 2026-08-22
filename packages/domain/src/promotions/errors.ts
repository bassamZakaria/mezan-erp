/** Raised when a promotion draft fails validation; `reasons` lists every failure, in Arabic, for the UI to show verbatim. */
export class InvalidPromotionError extends Error {
  readonly code = "INVALID_PROMOTION";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid promotion: ${reasons.join("; ")}`);
    this.name = "InvalidPromotionError";
  }
}

/** Raised when an operation references a promotion id that does not exist. */
export class PromotionNotFoundError extends Error {
  readonly code = "PROMOTION_NOT_FOUND";
  constructor(readonly promotionId: string) {
    super(`Promotion "${promotionId}" was not found.`);
    this.name = "PromotionNotFoundError";
  }
}

/** Raised when a promotion code already exists (codes are unique across promotions). */
export class DuplicatePromotionError extends Error {
  readonly code = "DUPLICATE_PROMOTION";
  constructor(readonly promotionCode: string) {
    super(`Promotion code "${promotionCode}" already exists.`);
    this.name = "DuplicatePromotionError";
  }
}

/** كود الكوبون مطلوب — raised when a promotion requires a coupon but none, or a mismatched one, was supplied. */
export class CouponRequiredError extends Error {
  readonly code = "COUPON_REQUIRED";
  constructor(readonly promotionCode: string) {
    super(`Promotion "${promotionCode}" requires a matching coupon code.`);
    this.name = "CouponRequiredError";
  }
}
