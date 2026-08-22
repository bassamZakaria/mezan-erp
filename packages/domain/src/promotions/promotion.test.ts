import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { promotionStatus, type Promotion } from "./promotion.js";
import { InMemoryPromotionRepository } from "./test-helpers/in-memory-promotion-repository.js";
import { createPromotion } from "./create-promotion.js";
import { updatePromotion } from "./update-promotion.js";
import { DuplicatePromotionError, InvalidPromotionError, PromotionNotFoundError } from "./errors.js";

const baseCommand = {
  id: "promo-1",
  code: "SUMMER10",
  nameAr: "خصم الصيف",
  type: "percentage" as const,
  percentValue: 10,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  createdAt: "2026-05-01T00:00:00.000Z",
};

describe("createPromotion", () => {
  it("creates a percentage promotion with defaults (active, all-scope, no coupon)", async () => {
    const repo = new InMemoryPromotionRepository();
    const p = await createPromotion(baseCommand, repo);
    expect(p).toMatchObject({
      id: "promo-1",
      code: "SUMMER10",
      active: true,
      requiresCoupon: false,
      scope: { type: "all", ids: [] },
      bundleComponents: [],
    });
    expect(await repo.findById("promo-1")).toEqual(p);
  });

  it("rejects a duplicate promotion code", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    await expect(createPromotion({ ...baseCommand, id: "promo-2" }, repo)).rejects.toThrow(DuplicatePromotionError);
  });

  it("rejects a missing code or Arabic name", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(createPromotion({ ...baseCommand, code: "" }, repo)).rejects.toThrow(InvalidPromotionError);
    await expect(createPromotion({ ...baseCommand, id: "p2", code: "X", nameAr: "" }, repo)).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects startDate after endDate", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion({ ...baseCommand, startDate: "2026-07-01", endDate: "2026-06-01" }, repo),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects a percentage promotion with an out-of-range percentValue", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(createPromotion({ ...baseCommand, percentValue: 150 }, repo)).rejects.toThrow(InvalidPromotionError);
    await expect(createPromotion({ ...baseCommand, id: "p2", percentValue: null }, repo)).rejects.toThrow(
      InvalidPromotionError,
    );
  });

  it("rejects fixed_amount/special_price/bundle without an amountValue", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion({ ...baseCommand, id: "p2", type: "fixed_amount", percentValue: null }, repo),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects a negative amountValue", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion(
        { ...baseCommand, id: "p2", type: "fixed_amount", percentValue: null, amountValue: Money.fromMajor("-5.00") },
        repo,
      ),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects buy_x_get_y without positive buyQty/getQty", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion({ ...baseCommand, id: "p2", type: "buy_x_get_y", percentValue: null }, repo),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects a bundle with no components", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion(
        { ...baseCommand, id: "p2", type: "bundle", percentValue: null, amountValue: Money.fromMajor("50.00") },
        repo,
      ),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("accepts a bundle with components", async () => {
    const repo = new InMemoryPromotionRepository();
    const p = await createPromotion(
      {
        ...baseCommand,
        id: "p2",
        type: "bundle",
        percentValue: null,
        amountValue: Money.fromMajor("50.00"),
        bundleComponents: [{ itemId: "X", qty: Qty.fromMajor("1") }],
      },
      repo,
    );
    expect(p.bundleComponents).toHaveLength(1);
  });

  it("rejects minInvoiceValue combined with special_price", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion(
        {
          ...baseCommand,
          id: "p2",
          type: "special_price",
          percentValue: null,
          amountValue: Money.fromMajor("8.00"),
          minInvoiceValue: Money.fromMajor("100.00"),
        },
        repo,
      ),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects a non-'all' scope with no ids", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion({ ...baseCommand, id: "p2", scope: { type: "item", ids: [] } }, repo),
    ).rejects.toThrow(InvalidPromotionError);
  });

  it("rejects an out-of-range dayHourRestriction hour", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(
      createPromotion(
        { ...baseCommand, id: "p2", dayHourRestriction: { days: [1], startHour: 25, endHour: 5 } },
        repo,
      ),
    ).rejects.toThrow(InvalidPromotionError);
  });
});

describe("updatePromotion", () => {
  it("applies a patch and re-validates the merged result", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    const updated = await updatePromotion("promo-1", { nameAr: "خصم الصيف الكبير", priority: 5 }, repo);
    expect(updated.nameAr).toBe("خصم الصيف الكبير");
    expect(updated.priority).toBe(5);
    expect(updated.code).toBe("SUMMER10");
  });

  it("throws PromotionNotFoundError for an unknown id", async () => {
    const repo = new InMemoryPromotionRepository();
    await expect(updatePromotion("nope", { nameAr: "x" }, repo)).rejects.toThrow(PromotionNotFoundError);
  });

  it("rejects renaming the code to one already used by another promotion", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    await createPromotion({ ...baseCommand, id: "promo-2", code: "WINTER10" }, repo);
    await expect(updatePromotion("promo-2", { code: "SUMMER10" }, repo)).rejects.toThrow(DuplicatePromotionError);
  });

  it("re-validates when a patch makes the promotion internally inconsistent", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    await expect(updatePromotion("promo-1", { type: "bundle", amountValue: Money.fromMajor("10.00") }, repo)).rejects.toThrow(
      InvalidPromotionError,
    );
  });

  it("deactivates a promotion (active: false)", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(baseCommand, repo);
    const updated = await updatePromotion("promo-1", { active: false }, repo);
    expect(updated.active).toBe(false);
  });
});

function promoWith(overrides: Partial<Promotion>): Promotion {
  return {
    id: "p",
    code: "P",
    priority: 0,
    nameAr: "عرض",
    nameEn: null,
    description: null,
    type: "percentage",
    percentValue: 10,
    amountValue: null,
    minInvoiceValue: null,
    buyQty: null,
    getQty: null,
    bundleComponents: [],
    requiresCoupon: false,
    dayHourRestriction: null,
    scope: { type: "all", ids: [] },
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    active: true,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("promotionStatus", () => {
  it("is 'inactive' when active is false, regardless of dates", () => {
    const p = promoWith({ active: false, startDate: "2020-01-01", endDate: "2099-12-31" });
    expect(promotionStatus(p, "2026-06-15")).toBe("inactive");
  });

  it("is 'scheduled' before the start date", () => {
    const p = promoWith({ startDate: "2026-07-01", endDate: "2026-07-31" });
    expect(promotionStatus(p, "2026-06-15")).toBe("scheduled");
  });

  it("is 'expired' after the end date", () => {
    const p = promoWith({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(promotionStatus(p, "2026-06-15")).toBe("expired");
  });

  it("is 'active' well within the window", () => {
    const p = promoWith({ startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(promotionStatus(p, "2026-06-15")).toBe("active");
  });

  it("is 'expiring_soon' when the end date is within 7 days", () => {
    const p = promoWith({ startDate: "2026-06-01", endDate: "2026-06-20" });
    expect(promotionStatus(p, "2026-06-15")).toBe("expiring_soon");
  });
});
