import { Money } from "../money/index.js";
import { InvalidPricingGuardRuleError } from "./errors.js";
import { PricingGuardMode, PricingGuardRuleStatus, type PricingGuardRule } from "./types.js";

export interface PricingGuardRuleInput {
  readonly nameAr: string;
  readonly itemId: string | null;
  readonly categoryId: string | null;
  readonly customerCategory: string | null;
  readonly floorPrice: Money | null;
  readonly minMarginPercent: number | null;
  readonly mode: PricingGuardMode;
  readonly note: string | null;
}

const PERCENT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function validatePricingGuardRule(input: PricingGuardRuleInput): void {
  const ar: string[] = [];
  const en: string[] = [];
  if (input.nameAr.trim() === "") {
    ar.push("اسم القاعدة مطلوب");
    en.push("the rule needs a name");
  }
  if (input.itemId && input.categoryId) {
    ar.push("القاعدة تحدد صنفاً أو فئة، لا الاثنين معاً");
    en.push("a rule names an item or a category, not both");
  }
  if (input.floorPrice === null && input.minMarginPercent === null) {
    ar.push("حدد حداً أدنى للسعر أو حداً أدنى لهامش الربح");
    en.push("set a floor price or a minimum margin");
  }
  if (input.floorPrice !== null && input.floorPrice.scaled <= 0n) {
    ar.push("الحد الأدنى للسعر يجب أن يكون أكبر من صفر");
    en.push("the floor price must be above zero");
  }
  if (input.floorPrice !== null && !input.itemId) {
    ar.push("الحد الأدنى للسعر يخص صنفاً بعينه، لأن السعر يقاس بوحدة الصنف الأساسية");
    en.push("a floor price belongs to one item, since it is per the item's base unit");
  }
  if (input.minMarginPercent !== null) {
    const valid = Number.isFinite(input.minMarginPercent) && PERCENT_PATTERN.test(String(input.minMarginPercent)) && input.minMarginPercent > -100 && input.minMarginPercent < 100;
    if (!valid) {
      ar.push("الحد الأدنى لهامش الربح نسبة بين -100 و100 بخانتين عشريتين على الأكثر");
      en.push("the minimum margin is a percentage between -100 and 100 with at most two decimals");
    }
  }
  if (!Object.values(PricingGuardMode).includes(input.mode)) {
    ar.push("طريقة التطبيق غير معروفة");
    en.push("unknown enforcement mode");
  }
  if (ar.length > 0) throw new InvalidPricingGuardRuleError(ar, en);
}

export function createPricingGuardRule(id: string, input: PricingGuardRuleInput, actor: string, now: string): PricingGuardRule {
  validatePricingGuardRule(input);
  return {
    id,
    nameAr: input.nameAr.trim(),
    itemId: input.itemId,
    categoryId: input.categoryId,
    customerCategory: input.customerCategory?.trim() || null,
    floorPrice: input.floorPrice,
    minMarginPercent: input.minMarginPercent,
    mode: input.mode,
    status: PricingGuardRuleStatus.Active,
    note: input.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  };
}

export function revisePricingGuardRule(current: PricingGuardRule, input: PricingGuardRuleInput, actor: string, now: string): PricingGuardRule {
  validatePricingGuardRule(input);
  return {
    ...current,
    nameAr: input.nameAr.trim(),
    itemId: input.itemId,
    categoryId: input.categoryId,
    customerCategory: input.customerCategory?.trim() || null,
    floorPrice: input.floorPrice,
    minMarginPercent: input.minMarginPercent,
    mode: input.mode,
    note: input.note?.trim() || null,
    updatedAt: now,
    updatedBy: actor,
  };
}

export function setPricingGuardRuleStatus(current: PricingGuardRule, status: PricingGuardRuleStatus, actor: string, now: string): PricingGuardRule {
  return { ...current, status, updatedAt: now, updatedBy: actor };
}
