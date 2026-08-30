/**
 * Multi-tier price lists (قوائم الأسعار): which شريحة a quantity lands on at
 * each boundary, and whether the tier survives into the invoice line the
 * confirm measures.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { PriceList } from "./price-list.js";
import { resolvePrice, resolvePriceTier } from "./pricing.js";

const BASE_SALE_PRICE = Money.fromMajor("100.00");

/**
 * Deliberately quotes NO tier at zero/one: the item is only cheaper once a
 * customer buys ten. Below ten the line has to fall back to the item sale
 * price, not to the ten-up tier.
 */
const LIST: PriceList = {
  id: "PL-1",
  code: "WHOLESALE",
  nameAr: "قائمة الجملة",
  nameEn: null,
  description: null,
  isBase: false,
  active: true,
  lines: [
    { itemId: "ITEM-A", unitCode: "PCS", minQty: Qty.fromMajor("50"), price: Money.fromMajor("85.00") },
    { itemId: "ITEM-A", unitCode: "PCS", minQty: Qty.fromMajor("10"), price: Money.fromMajor("92.00") },
    { itemId: "ITEM-B", unitCode: "PCS", minQty: Qty.fromMajor("0"), price: Money.fromMajor("7.50") },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function priceAt(qty: string): string {
  return resolvePrice(LIST, "ITEM-A", BASE_SALE_PRICE, Qty.fromMajor(qty)).toString();
}

describe("tier selection at every boundary quantity", () => {
  it("falls back to the base sale price below the FIRST tier, never to tier one", () => {
    expect(resolvePriceTier(LIST, "ITEM-A", Qty.fromMajor("3"))).toBeNull();
    expect(priceAt("3")).toBe("100.000000");
    expect(priceAt("9")).toBe("100.000000");
    expect(priceAt("9.999999")).toBe("100.000000");
  });

  it("takes the 10-up tier from exactly ten, inclusive", () => {
    expect(resolvePriceTier(LIST, "ITEM-A", Qty.fromMajor("10"))!.minQty.toString()).toBe("10.000000");
    expect(priceAt("10")).toBe("92.000000");
    expect(priceAt("11")).toBe("92.000000");
  });

  it("stays on the 10-up tier right up to one micro-unit below fifty", () => {
    expect(priceAt("49")).toBe("92.000000");
    expect(priceAt("49.999999")).toBe("92.000000");
  });

  it("takes the 50-up tier from exactly fifty, inclusive, whatever order the tiers are stored in", () => {
    expect(resolvePriceTier(LIST, "ITEM-A", Qty.fromMajor("50"))!.minQty.toString()).toBe("50.000000");
    expect(priceAt("50")).toBe("85.000000");
    expect(priceAt("5000")).toBe("85.000000");
  });

  it("honours a zero-threshold base tier for an item that has one", () => {
    expect(resolvePrice(LIST, "ITEM-B", BASE_SALE_PRICE, Qty.fromMajor("0.000001")).toString()).toBe("7.500000");
    expect(resolvePrice(LIST, "ITEM-B", BASE_SALE_PRICE, Qty.fromMajor("999")).toString()).toBe("7.500000");
  });

  it("quotes nothing for an item the list does not carry, and nothing at all when the list is inactive", () => {
    expect(resolvePrice(LIST, "ITEM-Z", BASE_SALE_PRICE, Qty.fromMajor("100")).toString()).toBe("100.000000");
    const inactive = { ...LIST, active: false };
    expect(resolvePrice(inactive, "ITEM-A", BASE_SALE_PRICE, Qty.fromMajor("100")).toString()).toBe("100.000000");
  });
});
