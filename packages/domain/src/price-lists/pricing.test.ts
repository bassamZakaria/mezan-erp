import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { PriceList } from "./price-list.js";
import { resolvePrice } from "./pricing.js";

const fallback = Money.fromMajor("100.00");

function makeList(overrides: Partial<PriceList> = {}): PriceList {
  return {
    id: "pl1",
    code: "RETAIL",
    nameAr: "قائمة التجزئة",
    nameEn: null,
    description: null,
    isBase: false,
    active: true,
    lines: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePrice", () => {
  it("falls back when there is no price list", () => {
    expect(resolvePrice(null, "item-1", fallback)).toEqual(fallback);
    expect(resolvePrice(undefined, "item-1", fallback)).toEqual(fallback);
  });

  it("falls back when the list has no line for the item", () => {
    const list = makeList({ lines: [{ itemId: "item-2", price: Money.fromMajor("90.00") }] });
    expect(resolvePrice(list, "item-1", fallback)).toEqual(fallback);
  });

  it("uses the line override when present on an active list", () => {
    const override = Money.fromMajor("85.50");
    const list = makeList({ lines: [{ itemId: "item-1", price: override }] });
    expect(resolvePrice(list, "item-1", fallback)).toEqual(override);
  });

  it("falls back when the list is inactive, even if a line matches", () => {
    const override = Money.fromMajor("85.50");
    const list = makeList({ active: false, lines: [{ itemId: "item-1", price: override }] });
    expect(resolvePrice(list, "item-1", fallback)).toEqual(fallback);
  });
});
