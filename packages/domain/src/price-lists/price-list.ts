import type { Money } from "../money/index.js";
import { InvalidPriceListError } from "./errors.js";

/**
 * Price lists — master data (docs/catalog/01 "قوائم الأسعار"). A price list
 * carries per-item absolute sell-price overrides; it does not encode a
 * discount percentage. When resolving the price for an item on an
 * invoice/quote line, a matching line wins over the item's normal sale
 * price — see `resolvePrice` in ./pricing.ts.
 */
export interface PriceListLine {
  readonly itemId: string;
  /** Absolute sell-price override for this item on this list (not a discount %). */
  readonly price: Money;
}

export interface PriceList {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly description: string | null;
  /** "قائمة أساسية" — marks this as the tenant's base/default list (docs/catalog/01 §"قوائم الأسعار"). */
  readonly isBase: boolean;
  readonly active: boolean;
  readonly lines: readonly PriceListLine[];
  readonly createdAt: string;
}

/**
 * Shape-level validation shared by create/update: non-empty `nameAr`, no
 * duplicate `itemId` across `lines`, and every line's price non-negative.
 * Code uniqueness is a repository-level concern (see create-price-list.ts).
 */
export function assertValidPriceListShape(nameAr: string, lines: readonly PriceListLine[]): void {
  const reasons: string[] = [];

  if (nameAr.trim().length === 0) {
    reasons.push("nameAr must not be empty.");
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) {
      reasons.push(`Duplicate itemId "${line.itemId}" in price list lines.`);
    }
    seen.add(line.itemId);
    if (line.price.scaled < 0n) {
      reasons.push(`Line price for itemId "${line.itemId}" must not be negative.`);
    }
  }

  if (reasons.length > 0) {
    throw new InvalidPriceListError(reasons);
  }
}
