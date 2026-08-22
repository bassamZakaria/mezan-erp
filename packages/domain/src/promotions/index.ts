export type {
  Promotion,
  PromotionType,
  PromotionScopeType,
  PromotionScope,
  PromotionBundleComponent,
  PromotionDayHourRestriction,
  PromotionDerivedStatus,
  PromotionDraft,
} from "./promotion.js";
export { promotionStatus, collectPromotionValidationReasons, assertValidPromotion } from "./promotion.js";
export { InvalidPromotionError, PromotionNotFoundError, DuplicatePromotionError, CouponRequiredError } from "./errors.js";
export { createPromotion, type CreatePromotionCommand } from "./create-promotion.js";
export { updatePromotion, type UpdatePromotionCommand } from "./update-promotion.js";
export type { PromotionRepository, PromotionListFilter } from "./ports.js";
export {
  findEligiblePromotions,
  evaluateBestPromotion,
  extendLine,
  type PromotionLineInput,
  type EvaluatePromotionsInput,
  type AppliedLineDiscount,
  type FreeGoodsLine,
  type PromotionApplicationResult,
} from "./engine.js";
