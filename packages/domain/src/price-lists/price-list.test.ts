import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { assertValidPriceListShape } from "./price-list.js";
import { InvalidPriceListError } from "./errors.js";
import type { PriceListLine } from "./price-list.js";

function tier(overrides: Partial<PriceListLine> & { itemId: string; minQty: Qty; price: Money }): PriceListLine {
  return { unitCode: null, ...overrides };
}

describe("assertValidPriceListShape", () => {
  it("passes for a valid name and tiered lines, including two different tiers for the same item", () => {
    expect(() =>
      assertValidPriceListShape("قائمة الجملة", [
        tier({ itemId: "A", minQty: Qty.zero(), price: Money.fromMajor("100") }),
        tier({ itemId: "A", minQty: Qty.fromMajor("50"), price: Money.fromMajor("85") }),
      ]),
    ).not.toThrow();
  });

  it("passes for an empty lines array", () => {
    expect(() => assertValidPriceListShape("قائمة فارغة", [])).not.toThrow();
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(() => assertValidPriceListShape("", [])).toThrow(InvalidPriceListError);
    expect(() => assertValidPriceListShape("   ", [])).toThrow(InvalidPriceListError);
  });

  it("rejects two tiers of the same item sharing the exact same minQty threshold", () => {
    expect(() =>
      assertValidPriceListShape("قائمة", [
        tier({ itemId: "A", minQty: Qty.fromMajor("10"), price: Money.fromMajor("100") }),
        tier({ itemId: "A", minQty: Qty.fromMajor("10"), price: Money.fromMajor("90") }),
      ]),
    ).toThrow(InvalidPriceListError);
  });

  it("rejects a negative minQty threshold", () => {
    expect(() =>
      assertValidPriceListShape("قائمة", [tier({ itemId: "A", minQty: Qty.fromMajor("-1"), price: Money.fromMajor("100") })]),
    ).toThrow(InvalidPriceListError);
  });

  it("rejects a negative price", () => {
    expect(() =>
      assertValidPriceListShape("قائمة", [tier({ itemId: "A", minQty: Qty.zero(), price: Money.fromMajor("-1") })]),
    ).toThrow(InvalidPriceListError);
  });

  it("collects every failing reason across multiple lines, not just the first", () => {
    try {
      assertValidPriceListShape("قائمة", [
        tier({ itemId: "A", minQty: Qty.fromMajor("-1"), price: Money.fromMajor("100") }),
        tier({ itemId: "B", minQty: Qty.zero(), price: Money.fromMajor("-5") }),
      ]);
      throw new Error("expected assertValidPriceListShape to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPriceListError);
      expect((err as InvalidPriceListError).reasons).toHaveLength(2);
    }
  });

  it("allows a zero minQty as the base tier", () => {
    expect(() =>
      assertValidPriceListShape("قائمة", [tier({ itemId: "A", minQty: Qty.zero(), price: Money.fromMajor("100") })]),
    ).not.toThrow();
  });

  it("allows a zero price (a free/promotional line is a shape-valid price, not a negative one)", () => {
    expect(() =>
      assertValidPriceListShape("قائمة", [tier({ itemId: "A", minQty: Qty.zero(), price: Money.zero() })]),
    ).not.toThrow();
  });
});
