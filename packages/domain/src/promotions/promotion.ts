/**
 * Promotions — discount rules engine header entity (docs/catalog/01-sales.md
 * §"العروض"). A `Promotion` is master data describing WHEN and HOW MUCH to
 * discount; the actual per-cart calculation lives in `./engine.ts`.
 */

import { Money, Qty } from "../money/index.js";
import { InvalidPromotionError } from "./errors.js";

export type PromotionType = "percentage" | "fixed_amount" | "special_price" | "buy_x_get_y" | "bundle";

export type PromotionScopeType = "all" | "item" | "category";
export interface PromotionScope {
  readonly type: PromotionScopeType;
  /** Item ids or category ids this scope targets; empty when type === "all". */
  readonly ids: readonly string[];
}

export interface PromotionBundleComponent {
  readonly itemId: string;
  readonly qty: Qty;
}

/** تقييد الأيام والساعات — restricts the promo to specific weekdays/hours (docs/catalog/01 §"العروض"). */
export interface PromotionDayHourRestriction {
  /** 0 (Sunday) .. 6 (Saturday) — JS Date.getDay() convention. */
  readonly days: readonly number[];
  /** 0..23 inclusive start hour, local tenant time. */
  readonly startHour: number;
  /** 0..23 inclusive end hour. `endHour` may be < `startHour` to express an overnight window. */
  readonly endHour: number;
}

export interface Promotion {
  readonly id: string;
  readonly code: string;
  readonly priority: number; // higher number = applied first when multiple promotions are eligible
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly description: string | null;
  readonly type: PromotionType;
  /** 0-100, meaningful only for type "percentage". */
  readonly percentValue: number | null;
  /** Fixed discount amount (type "fixed_amount") or the special unit price (type "special_price") or the bundle's total price (type "bundle"). */
  readonly amountValue: Money | null;
  /** "حد أدنى لقيمة الفاتورة" — turns it into a spend->discount offer; incompatible with special_price (validated). */
  readonly minInvoiceValue: Money | null;
  /**
   * "حد أدنى للكمية" — the promotion applies only once the lines IN SCOPE
   * reach this total quantity. A per-cart threshold, not a per-line one: three
   * lines of 4 satisfy a minimum of 10 the way one line of 12 does.
   */
  readonly minQty: Qty | null;
  /**
   * "الحد الأقصى للخصم" — caps what this campaign may ever give away on one
   * document. The cap is applied AFTER the type's own arithmetic and
   * re-allocated across the same lines by largest remainder, so the parts
   * still sum exactly to the capped total.
   */
  readonly maxDiscountAmount: Money | null;
  /** buy-X-get-Y quantities (type "buy_x_get_y"). */
  readonly buyQty: number | null;
  readonly getQty: number | null;
  /** components turn the reward into a bundle (type "bundle"). */
  readonly bundleComponents: readonly PromotionBundleComponent[];
  readonly requiresCoupon: boolean;
  readonly dayHourRestriction: PromotionDayHourRestriction | null;
  readonly scope: PromotionScope;
  readonly startDate: string; // ISO YYYY-MM-DD
  readonly endDate: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export type PromotionDerivedStatus = "scheduled" | "active" | "expiring_soon" | "expired" | "inactive";

const EXPIRING_SOON_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** فعال / مجدول / قرب الانتهاء / منتهي — all derived from active + start/end date vs `today` (never stored). `expiring_soon` = active and endDate within 7 days of today. */
export function promotionStatus(promo: Promotion, today: string): PromotionDerivedStatus {
  if (!promo.active) return "inactive";
  if (today < promo.startDate) return "scheduled";
  if (today > promo.endDate) return "expired";

  const endMs = Date.parse(`${promo.endDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const daysUntilEnd = Math.round((endMs - todayMs) / MS_PER_DAY);
  if (daysUntilEnd <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "active";
}

/** The subset of a `Promotion`'s fields that participate in cross-field validation. */
export type PromotionDraft = Omit<Promotion, "id" | "createdAt">;

/**
 * Collects (does not throw) every validation failure against a promotion
 * draft: code/nameAr required, start<=end, type-specific value requirements,
 * min-invoice-value vs special_price incompatibility, scope ids, and
 * day/hour bounds. Shared by create and update so both enforce the same
 * invariants.
 */
export function collectPromotionValidationReasons(draft: PromotionDraft): string[] {
  const reasons: string[] = [];

  if (draft.code.trim() === "") reasons.push("كود العرض مطلوب.");
  if (draft.nameAr.trim() === "") reasons.push("اسم العرض بالعربية مطلوب.");
  if (draft.startDate > draft.endDate) reasons.push("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.");

  if (draft.type === "percentage") {
    if (draft.percentValue === null || draft.percentValue < 0 || draft.percentValue > 100) {
      reasons.push("نسبة الخصم يجب أن تكون بين 0 و 100.");
    }
  }

  if (draft.type === "fixed_amount" || draft.type === "special_price" || draft.type === "bundle") {
    if (draft.amountValue === null || draft.amountValue.scaled < 0n) {
      reasons.push("قيمة العرض مطلوبة ويجب ألا تكون سالبة.");
    }
  }

  if (draft.type === "buy_x_get_y") {
    if (draft.buyQty === null || draft.buyQty <= 0) reasons.push("كمية الشراء (X) يجب أن تكون أكبر من صفر.");
    if (draft.getQty === null || draft.getQty <= 0) reasons.push("الكمية المجانية (Y) يجب أن تكون أكبر من صفر.");
  }

  if (draft.type === "bundle" && draft.bundleComponents.length === 0) {
    reasons.push("عرض الحزمة يتطلب مكوناً واحداً على الأقل.");
  }

  if (draft.minInvoiceValue !== null && draft.type === "special_price") {
    reasons.push('الحد الأدنى لقيمة الفاتورة لا يتوافق مع نوع "السعر الخاص".');
  }

  if (draft.minQty !== null && draft.minQty.scaled <= 0n) {
    reasons.push("الحد الأدنى للكمية يجب أن يكون أكبر من صفر.");
  }

  if (draft.maxDiscountAmount !== null && draft.maxDiscountAmount.scaled <= 0n) {
    reasons.push("الحد الأقصى للخصم يجب أن يكون أكبر من صفر.");
  }

  // A buy-X-get-Y promotion gives away UNITS, not a sum; capping the money
  // without cutting the free units would let the document exceed its own cap.
  if (draft.maxDiscountAmount !== null && draft.type === "buy_x_get_y") {
    reasons.push('الحد الأقصى للخصم لا يتوافق مع نوع "اشترِ X واحصل على Y" — الخصم فيه أصناف مجانية لا مبلغ.');
  }

  if (draft.scope.type !== "all" && draft.scope.ids.length === 0) {
    reasons.push("نطاق العرض يتطلب تحديد صنف أو تصنيف واحد على الأقل.");
  }

  if (draft.dayHourRestriction) {
    const { days, startHour, endHour } = draft.dayHourRestriction;
    const isValidHour = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
    if (!isValidHour(startHour) || !isValidHour(endHour)) {
      reasons.push("ساعات تقييد العرض يجب أن تكون بين 0 و 23.");
    }
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      reasons.push("أيام تقييد العرض يجب أن تكون بين 0 (الأحد) و 6 (السبت).");
    }
  }

  return reasons;
}

/** Throws {@link InvalidPromotionError} with every collected reason when the draft is invalid. */
export function assertValidPromotion(draft: PromotionDraft): void {
  const reasons = collectPromotionValidationReasons(draft);
  if (reasons.length > 0) throw new InvalidPromotionError(reasons);
}
