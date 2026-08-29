import type { Money, Qty } from "../money/index.js";
import { InvalidPriceListError } from "./errors.js";

/**
 * Price lists — master data (docs/archive/catalog/01 "قوائم الأسعار"). A price list
 * carries per-item absolute sell-price overrides; it does not encode a
 * discount percentage. An item may appear more than once on the same list,
 * once per MINIMUM-QUANTITY tier: 100.00 from 1, 92.00 from 10, 85.00 from 50.
 * When resolving the price for an invoice/quote line the highest tier the
 * line's quantity reaches wins over the item's normal sale price — see
 * `resolvePrice` in ./pricing.ts.
 */
export interface PriceListLine {
  readonly itemId: string;
  /**
   * Unit this tier is quoted in — display only. The threshold and the price are
   * both expressed in whatever unit the caller prices the line in, so this
   * names that unit rather than converting it.
   */
  readonly unitCode: string | null;
  /** Volume threshold: this price applies from this quantity upwards. Zero is the base tier. */
  readonly minQty: Qty;
  /** Absolute sell-price override for this item at this tier (not a discount %). */
  readonly price: Money;
}

export interface PriceList {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly description: string | null;
  /** "قائمة أساسية" — marks this as the tenant's base/default list (docs/archive/catalog/01 §"قوائم الأسعار"). */
  readonly isBase: boolean;
  readonly active: boolean;
  readonly lines: readonly PriceListLine[];
  readonly createdAt: string;
}

/**
 * Shape-level validation shared by create/update: non-empty `nameAr`, no two
 * tiers of the same item sharing a threshold, non-negative thresholds and
 * non-negative prices. Code uniqueness is a repository-level concern (see
 * create-price-list.ts).
 */
export function assertValidPriceListShape(nameAr: string, lines: readonly PriceListLine[]): void {
  const reasons: string[] = [];

  if (nameAr.trim().length === 0) {
    reasons.push("اسم قائمة الأسعار مطلوب.");
  }

  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.itemId}@${line.minQty.scaled.toString()}`;
    if (seen.has(key)) {
      reasons.push(`شريحة مكررة للصنف "${line.itemId}" عند الحد الأدنى للكمية ${line.minQty.toString()}.`);
    }
    seen.add(key);
    if (line.minQty.scaled < 0n) {
      reasons.push(`الحد الأدنى للكمية للصنف "${line.itemId}" لا يمكن أن يكون سالباً.`);
    }
    if (line.price.scaled < 0n) {
      reasons.push(`سعر السطر للصنف "${line.itemId}" لا يمكن أن يكون سالباً.`);
    }
  }

  if (reasons.length > 0) {
    throw new InvalidPriceListError(reasons);
  }
}
