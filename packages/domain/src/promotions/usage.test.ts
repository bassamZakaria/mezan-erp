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

describe("aggregatePromotionUsage", () => {
  it("sums two invoices under the same promotion into one row with usageCount 2", () => {
    const rows = aggregate({
      invoices: [invoice({ id: "inv-1" }), invoice({ id: "inv-2", promotion: { ...invoice().promotion!, discountTotal: Money.fromMajor("15") } })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usageCount).toBe(2);
    expect(rows[0]?.discountGranted.toString()).toBe("35.000000");
  });

  it("a non-live (cancelled) invoice contributes nothing", () => {
    const rows = aggregate({ invoices: [invoice({ live: false })] });
    expect(rows[0]?.usageCount).toBe(0);
    expect(rows[0]?.discountGranted.toString()).toBe("0.000000");
  });

  it("a return of half the invoiced qty reverses exactly half the line discount", () => {
    const rows = aggregate({
      invoices: [invoice()], // 10 units, discount 20.00
      returns: [ret({ lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("5") }] })],
    });
    expect(rows[0]?.discountGranted.toString()).toBe("20.000000");
    expect(rows[0]?.reversedDiscount.toString()).toBe("10.000000");
    expect(rows[0]?.netDiscount.toString()).toBe("10.000000");
  });

  it("a return of the full invoiced qty reverses the full line discount", () => {
    const rows = aggregate({
      invoices: [invoice()],
      returns: [ret({ lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10") }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("20.000000");
    expect(rows[0]?.netDiscount.toString()).toBe("0.000000");
  });

  it("clamps reversed discount at granted — net discount never goes negative", () => {
    // Two returns that together exceed the invoiced qty (defensive: shouldn't
    // happen upstream, but the aggregator must not go negative).
    const rows = aggregate({
      invoices: [invoice()],
      returns: [
        ret({ lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10") }] }),
        ret({ lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10") }] }),
      ],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("20.000000");
    expect(rows[0]?.netDiscount.toString()).toBe("0.000000");
  });

  it("a non-live return contributes nothing", () => {
    const rows = aggregate({
      invoices: [invoice()],
      returns: [ret({ live: false, lines: [{ itemId: "ITEM1", qty: Qty.fromMajor("10") }] })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });

  it("a return against an unpromoted or unknown invoice is ignored", () => {
    const rows = aggregate({
      invoices: [invoice()],
      returns: [ret({ sourceInvoiceId: "inv-does-not-exist" })],
    });
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });

  it("dateFrom/dateTo excludes invoices and returns outside the window", () => {
    const rows = aggregate({
      invoices: [invoice({ date: "2026-08-10" })],
      returns: [ret({ date: "2026-09-01" })],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(rows[0]?.discountGranted.toString()).toBe("20.000000");
    // Return dated outside the window is excluded even though its invoice is in range.
    expect(rows[0]?.reversedDiscount.toString()).toBe("0.000000");
  });

  it("keeps the promotion's own invoice-time snapshot code/name, not a renamed live catalog entry", () => {
    const rows = aggregate({
      invoices: [invoice({ promotion: { ...invoice().promotion!, code: "OLDCODE", nameAr: "الاسم القديم" } })],
      catalog: [{ id: "promo-1", code: "NEWCODE", nameAr: "الاسم الجديد", startDate: "2026-08-01", endDate: "2026-08-31" }],
    });
    expect(rows[0]?.code).toBe("OLDCODE");
    expect(rows[0]?.nameAr).toBe("الاسم القديم");
  });

  it("includes a catalog entry with zero usage when its own date range overlaps the window", () => {
    const rows = aggregate({
      catalog: [{ id: "promo-unused", code: "UNUSED", nameAr: "غير مستخدم", startDate: "2026-08-01", endDate: "2026-08-31" }],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usageCount).toBe(0);
  });

  it("excludes a catalog entry whose own date range falls entirely outside the requested window", () => {
    const rows = aggregate({
      catalog: [{ id: "promo-old", code: "OLD", nameAr: "قديم", startDate: "2026-01-01", endDate: "2026-01-31" }],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(rows).toHaveLength(0);
  });

  it("sorts by netDiscount descending, ties broken by code ascending", () => {
    const rows = aggregate({
      catalog: [
        { id: "promo-a", code: "BBB", nameAr: "ب", startDate: "2026-08-01", endDate: "2026-08-31" },
        { id: "promo-b", code: "AAA", nameAr: "أ", startDate: "2026-08-01", endDate: "2026-08-31" },
        { id: "promo-c", code: "CCC", nameAr: "ج", startDate: "2026-08-01", endDate: "2026-08-31" },
      ],
      invoices: [
        invoice({ id: "inv-a", promotion: { promotionId: "promo-a", code: "BBB", nameAr: "ب", discountTotal: Money.fromMajor("10"), lineDiscounts: [] } }),
        invoice({ id: "inv-c", promotion: { promotionId: "promo-c", code: "CCC", nameAr: "ج", discountTotal: Money.fromMajor("50"), lineDiscounts: [] } }),
      ],
    });
    // promo-b (AAA) has zero usage (tied with... none), so order should be by netDiscount desc: CCC(50), BBB(10), AAA(0)
    expect(rows.map((r) => r.code)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("breaks a netDiscount tie by code ascending", () => {
    const rows = aggregate({
      catalog: [
        { id: "promo-z", code: "ZZZ", nameAr: "ز", startDate: "2026-08-01", endDate: "2026-08-31" },
        { id: "promo-a", code: "AAA", nameAr: "أ", startDate: "2026-08-01", endDate: "2026-08-31" },
      ],
      invoices: [
        invoice({ id: "inv-z", promotion: { promotionId: "promo-z", code: "ZZZ", nameAr: "ز", discountTotal: Money.fromMajor("10"), lineDiscounts: [] } }),
        invoice({ id: "inv-a", promotion: { promotionId: "promo-a", code: "AAA", nameAr: "أ", discountTotal: Money.fromMajor("10"), lineDiscounts: [] } }),
      ],
    });
    expect(rows.map((r) => r.code)).toEqual(["AAA", "ZZZ"]);
  });
});
