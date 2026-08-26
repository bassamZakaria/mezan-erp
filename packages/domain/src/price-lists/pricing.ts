import { Qty, type Money } from "../money/index.js";
import type { PriceList, PriceListLine } from "./price-list.js";

/** A line quantity of one, the tier a caller that asks for "the list price" means. */
const ONE = Qty.fromMajor("1");

/**
 * The tier that applies to `itemId` at `qty` on `priceList`: the highest
 * `minQty` threshold the quantity reaches, or null when the list is inactive,
 * absent, or quotes nothing for this item at this quantity. Tiers with a
 * threshold ABOVE the quantity never apply — a "من 50" price is not what a
 * customer buying 3 pays.
 */
export function resolvePriceTier(
  priceList: PriceList | null | undefined,
  itemId: string,
  qty: Qty = ONE,
): PriceListLine | null {
  if (!priceList || !priceList.active) return null;
  let best: PriceListLine | null = null;
  for (const line of priceList.lines) {
    if (line.itemId !== itemId) continue;
    if (line.minQty.scaled > qty.scaled) continue;
    if (best === null || line.minQty.scaled > best.minQty.scaled) best = line;
  }
  return best;
}

/**
 * Resolves the sell price for `itemId` at `qty` on `priceList`: the applicable
 * minimum-quantity tier if the list is active and quotes one, else `fallback`
 * (the item's normal sale price). This is the actual pricing-application logic
 * invoked from invoice/quote line building — a price list never changes what
 * price would apply unless it is active and has a tier the line reaches.
 */
export function resolvePrice(
  priceList: PriceList | null | undefined,
  itemId: string,
  fallback: Money,
  qty: Qty = ONE,
): Money {
  return resolvePriceTier(priceList, itemId, qty)?.price ?? fallback;
}
