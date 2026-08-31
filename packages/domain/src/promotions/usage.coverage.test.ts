import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  aggregatePromotionUsage,
  type AggregatePromotionUsageInput,
  type PromotionUsageCatalogEntry,
  type PromotionUsageInvoice,
  type PromotionUsageReturn,
} from "./usage.js";

const CATALOG: PromotionUsageCatalogEntry[] = [
  { id: "promo-1", code: "SAVE10", nameAr: "خصم 10", startDate: "2026-08-01", endDate: "2026-08-31" },
];

function invoice(overrides: Partial<PromotionUsageInvoice> = {}): PromotionUsageInvoice {
  return {
    id: "inv-1",
    date: "2026-08-10",
    live: true,
    lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10") }],
    promotion: {
      promotionId: "promo-1",
      code: "SAVE10",
      nameAr: "خصم 10",
      discountTotal: Money.fromMajor("20"),
      lineDiscounts: [{ itemId: "ITEM1", amount: Money.fromMajor("20") }],
    },
    ...overrides,
  };
}

function ret(overrides: Partial<PromotionUsageReturn> = {}): PromotionUsageReturn {
  return {
    sourceInvoiceId: "inv-1",
    date: "2026-08-15",
    live: true,
    lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("5") }],
    ...overrides,
  };
}

function aggregate(input: Partial<AggregatePromotionUsageInput>) {
  return aggregatePromotionUsage({ catalog: CATALOG, invoices: [], returns: [], ...input });
}

describe("aggregatePromotionUsage — half-up rounding on a non-terminating ratio", () => {
  it("rounds the reversed discount up when returning 2 of 3 units, then snaps to the nearest 0.01", () => {
    const rows = aggregate({
      invoices: [
        invoice({
          lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("3") }],
          promotion: {
            promotionId: "promo-1",
            code: "SAVE10",
            nameAr: "خصم 10",
            discountTotal: Money.fromMajor("10"),
            lineDiscounts: [{ itemId: "ITEM1", amount: Money.fromMajor("10") }],
          },
        }),
      ],
      returns: [ret({ lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("2") }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("6.670000");
  });
});

describe("aggregatePromotionUsage — a returned line the invoice never discounted", () => {
  it("reverses nothing for a returned item that carried no recorded line discount", () => {
    const rows = aggregate({
      invoices: [
        invoice({
          lines: [
            { itemId: "ITEM1", qty: Qty.fromMajor("10") },
            { itemId: "ITEM2", qty: Qty.fromMajor("4") },
          ],
          // Only ITEM1 carries a recorded discount — ITEM2 rode along at full price.
          promotion: {
            promotionId: "promo-1",
            code: "SAVE10",
            nameAr: "خصم 10",
            discountTotal: Money.fromMajor("20"),
            lineDiscounts: [{ itemId: "ITEM1", amount: Money.fromMajor("20") }],
          },
        }),
      ],
      returns: [ret({ lines: [{ itemId: "ITEM2", qty: Qty.fromMajor("2") }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });

  it("reverses nothing for a returned item that was never on the original invoice", () => {
    const rows = aggregate({
      invoices: [invoice()], // only ITEM1, 10 units
      returns: [ret({ lines: [{ itemId: "ITEM-NEVER-SOLD", qty: Qty.fromMajor("1") }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });

  it("reverses nothing for a return line recorded with zero quantity", () => {
    const rows = aggregate({
      invoices: [invoice()],
      returns: [ret({ lines: [{ itemId: "ITEM1", qty: Qty.zero() }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });
});

describe("aggregatePromotionUsage — dateFrom excludes a document dated before the window", () => {
  it("excludes an invoice dated before dateFrom", () => {
    const rows = aggregate({
      invoices: [invoice({ date: "2026-07-20" })],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(rows[0]?.usageCount).toBe(0);
    expect(rows[0]?.discountGranted.toString()).toBe("0.000000");
  });
});

describe("aggregatePromotionUsage — catalog entry starting after the requested window", () => {
  it("excludes a catalog entry whose startDate is after dateTo", () => {
    const rows = aggregate({
      catalog: [{ id: "promo-future", code: "FUTURE", nameAr: "قادم", startDate: "2026-09-01", endDate: "2026-09-30" }],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(rows).toHaveLength(0);
  });
});
