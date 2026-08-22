import type { Money } from "../money/index.js";
import type { PriceList } from "./price-list.js";

/**
 * Resolves the sell price for `itemId` on `priceList`: the line override if
 * present and the list is active, else `fallback` (the item's normal sale
 * price). This is the actual pricing-application logic invoked from
 * invoice/quote line building — a price list never changes what price would
 * apply unless it is active and has an explicit line for the item.
 */
export function resolvePrice(priceList: PriceList | null | undefined, itemId: string, fallback: Money): Money {
  if (!priceList || !priceList.active) return fallback;
  const line = priceList.lines.find((l) => l.itemId === itemId);
  return line ? line.price : fallback;
}
