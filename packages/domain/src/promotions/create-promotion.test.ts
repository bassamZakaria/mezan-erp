import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createPromotion, type CreatePromotionCommand } from "./create-promotion.js";
import { DuplicatePromotionError, InvalidPromotionError } from "./errors.js";
import { InMemoryPromotionRepository } from "./test-helpers/in-memory-promotion-repository.js";

const baseCommand: CreatePromotionCommand = {
  id: "promo-1",
  code: "SUMMER10",
  nameAr: "خصم الصيف",
  type: "percentage",
  percentValue: 10,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  createdAt: "2026-05-01T00:00:00.000Z",
};

describe("createPromotion", () => {
  it("creates a promotion with the product's documented defaults", async () => {
    const repo = new InMemoryPromotionRepository();
    const promotion = await createPromotion(baseCommand, repo);
    expect(promotion.active).toBe(true);
    expect(promotion.scope).toEqual({ type: "all", ids: [] });
    expect(promotion.requiresCoupon).toBe(false);
    expect(promotion.bundleComponents).toEqual([]);
    expect(promotion.priority).toBe(0);
    expect(await repo.findById("promo-1")).toEqual(promotion);
  });

  it("honours every explicitly supplied field over its default", async () => {
    const repo = new InMemoryPromotionRepository();
    const promotion = await createPromotion(
      {
        ...baseCommand,
        priority: 5,
        active: false,
        requiresCoupon: true,
        scope: { type: "item", ids: ["ITEM-1"] },
      },
      repo,
    );
    expect(promotion.priority).toBe(5);
    expect(promotion.active).toBe(false);
    expect(promotion.requiresCoupon).toBe(true);
    expect(promotion.scope).toEqual({ type: "item", ids: ["ITEM-1"] });
  });

  it("rejects a duplicate promotion code", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    await expect(createPromotion({ ...baseCommand, id: "promo-2" }, repo)).rejects.toBeInstanceOf(DuplicatePromotionError);
  });

  it("rejects a draft that fails cross-field validation (start after end)", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion({ ...baseCommand, startDate: "2026-07-01", endDate: "2026-06-01" }, repo),
    ).rejects.toBeInstanceOf(InvalidPromotionError);
  });

  it("rejects a percentage promotion with no percentValue", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(createPromotion({ ...baseCommand, percentValue: null }, repo)).rejects.toBeInstanceOf(InvalidPromotionError);
  });

  it("rejects a bundle type with no components", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion(
        { ...baseCommand, type: "bundle", percentValue: null, amountValue: Money.fromMajor("100"), bundleComponents: [] },
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidPromotionError);
  });

  it("creates a bundle with components and a min-qty threshold", async () => {
    const repo = new InMemoryPromotionRepository();
    const promotion = await createPromotion(
      {
        ...baseCommand,
        type: "bundle",
        percentValue: null,
        amountValue: Money.fromMajor("150"),
        bundleComponents: [{ itemId: "A", qty: Qty.fromMajor("1") }, { itemId: "B", qty: Qty.fromMajor("2") }],
        minQty: Qty.fromMajor("1"),
      },
      repo,
    );
    expect(promotion.bundleComponents).toHaveLength(2);
    expect(promotion.minQty?.toString()).toBe("1.000000");
  });

  it("does not persist anything when validation fails", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(createPromotion({ ...baseCommand, percentValue: 500 }, repo)).rejects.toBeInstanceOf(InvalidPromotionError);
    expect(await repo.list()).toEqual([]);
  });
});
