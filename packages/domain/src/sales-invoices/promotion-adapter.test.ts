import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createPromotion, type CreatePromotionCommand } from "../promotions/create-promotion.js";
import { InMemoryPromotionRepository } from "../promotions/test-helpers/in-memory-promotion-repository.js";
import { createSalesInvoicePromotionHook } from "./promotion-adapter.js";
import type { SalesInvoicePromotionRequest } from "./ports.js";
import type { SalesInvoiceLine } from "./sales-invoice.js";

const NOW = "2026-06-15T12:00:00.000Z"; // a Monday

function line(overrides: Partial<SalesInvoiceLine> & { lineId: string; itemId: string }): SalesInvoiceLine {
  return {
    itemNameAr: overrides.itemId,
    isStock: false,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("0"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: "4000",
    cogsAccountId: null,
    inventoryAccountId: null,
    unitCost: null,
    unitCode: "",
    unitFactor: 1,
    discountType: "percent" as const,
    discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function promoCmd(overrides: Partial<CreatePromotionCommand> = {}): CreatePromotionCommand {
  return {
    id: overrides.id ?? "promo-1",
    code: overrides.code ?? "PROMO1",
    nameAr: "عرض",
    type: "percentage",
    percentValue: 10,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

async function requestFor(lines: readonly SalesInvoiceLine[], couponCode: string | null = null): Promise<SalesInvoicePromotionRequest> {
  return { lines, date: "2026-06-15", couponCode };
}

describe("createSalesInvoicePromotionHook", () => {
  it("returns null when the invoice has no lines", async () => {
    const repo = new InMemoryPromotionRepository();
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    expect(await hook.evaluate(await requestFor([]))).toBeNull();
  });

  it("returns null when there are no active promotions", async () => {
    const repo = new InMemoryPromotionRepository();
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100") })];
    expect(await hook.evaluate(await requestFor(lines))).toBeNull();
  });

  it("applies the eligible active promotion and stamps a snapshot with per-line discounts", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(promoCmd(), repo);
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("100") })];

    const applied = await hook.evaluate(await requestFor(lines));
    expect(applied).not.toBeNull();
    expect(applied?.promotionId).toBe("promo-1");
    expect(applied?.code).toBe("PROMO1");
    expect(applied?.discountTotal.toString()).toBe("20.000000"); // 10% of 200
    expect(applied?.lineDiscounts).toEqual([{ lineId: "L1", itemId: "A", amount: applied?.discountTotal }]);
    expect(applied?.appliedAt).toBe(NOW);
  });

  it("resolves an item's category through categoryOfItem for a category-scoped promotion", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(
      promoCmd({ id: "promo-cat", code: "CATPROMO", scope: { type: "category", ids: ["CAT-1"] } }),
      repo,
    );
    const hook = createSalesInvoicePromotionHook(repo, {
      now: () => NOW,
      categoryOfItem: async (itemId) => (itemId === "A" ? "CAT-1" : null),
    });
    const inScope = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];
    const applied = await hook.evaluate(await requestFor(inScope));
    expect(applied?.promotionId).toBe("promo-cat");

    const outOfScope = [line({ lineId: "L1", itemId: "B", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];
    expect(await hook.evaluate(await requestFor(outOfScope))).toBeNull();
  });

  it("picks the higher-priority promotion when two could both apply", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(promoCmd({ id: "promo-low", code: "LOW", priority: 1, percentValue: 5 }), repo);
    await createPromotion(promoCmd({ id: "promo-high", code: "HIGH", priority: 10, percentValue: 20 }), repo);
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];

    const applied = await hook.evaluate(await requestFor(lines));
    expect(applied?.promotionId).toBe("promo-high");
    expect(applied?.discountTotal.toString()).toBe("20.000000");
  });

  it("excludes an expired promotion", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(promoCmd({ id: "promo-expired", code: "EXPIRED", startDate: "2026-01-01", endDate: "2026-01-31" }), repo);
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];
    expect(await hook.evaluate(await requestFor(lines))).toBeNull();
  });

  it("excludes a coupon-required promotion when the request names a coupon code that does not exist", async () => {
    const repo = new InMemoryPromotionRepository();
    await createPromotion(promoCmd({ id: "promo-coupon", code: "REALCODE", requiresCoupon: true }), repo);
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];

    expect(await hook.evaluate(await requestFor(lines, "DOES-NOT-EXIST"))).toBeNull();
    expect(await hook.evaluate(await requestFor(lines, null))).toBeNull();

    const applied = await hook.evaluate(await requestFor(lines, "REALCODE"));
    expect(applied?.promotionId).toBe("promo-coupon");
    expect(applied?.couponCode).toBe("REALCODE");
  });

  it("returns null rather than a zero-value snapshot when the eligible promotion grants nothing", async () => {
    const repo = new InMemoryPromotionRepository();
    // special_price above the line's own price grants zero discount.
    await createPromotion(
      promoCmd({ id: "promo-noop", code: "NOOP", type: "special_price", percentValue: null, amountValue: Money.fromMajor("500") }),
      repo,
    );
    const hook = createSalesInvoicePromotionHook(repo, { now: () => NOW });
    const lines = [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100") })];
    expect(await hook.evaluate(await requestFor(lines))).toBeNull();
  });
});
