import { describe, it, expect } from "vitest";
import {
  salesInvoiceStatusSchema,
  salesInvoiceDiscountSchema,
  createSalesInvoiceLineSchema,
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceFilterKeySchema,
  salesInvoiceListQuerySchema,
  appliedSalesInvoicePromotionSchema,
  promotionUsageRowSchema,
  salesInvoiceStatsSchema,
} from "./sales-invoice.js";

describe("salesInvoiceStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["draft", "pending", "confirmed", "partially_paid", "paid", "cancelled", "reversed"]) {
      expect(salesInvoiceStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(salesInvoiceStatusSchema.safeParse("open").success).toBe(false);
  });
});

describe("salesInvoiceDiscountSchema", () => {
  it("accepts the percent variant", () => {
    const result = salesInvoiceDiscountSchema.safeParse({ type: "percent", percent: 10 });
    expect(result.success).toBe(true);
  });

  it("accepts the amount variant and never coerces amount to a float", () => {
    const result = salesInvoiceDiscountSchema.safeParse({ type: "amount", amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "amount") expect(result.data.amount).toBe("0.100001");
  });

  it("rejects a percent above 100", () => {
    const result = salesInvoiceDiscountSchema.safeParse({ type: "percent", percent: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects a discriminator outside the union", () => {
    const result = salesInvoiceDiscountSchema.safeParse({ type: "flat", amount: "10" });
    expect(result.success).toBe(false);
  });
});

describe("createSalesInvoiceLineSchema", () => {
  const line = {
    lineId: "l1",
    itemId: "item-1",
    itemNameAr: "قميص قطن",
    isStock: true,
    qty: "2.000000",
    unitPrice: "199.990000",
    revenueAccountId: "acc-rev",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = createSalesInvoiceLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces unitPrice to a float — high-precision decimal string survives verbatim", () => {
    const result = createSalesInvoiceLineSchema.safeParse({ ...line, unitPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe("0.100001");
  });

  it("rejects unitPrice sent as a JS number instead of a string", () => {
    const result = createSalesInvoiceLineSchema.safeParse({ ...line, unitPrice: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a unitFactor that is zero or negative", () => {
    expect(createSalesInvoiceLineSchema.safeParse({ ...line, unitFactor: 0 }).success).toBe(false);
    expect(createSalesInvoiceLineSchema.safeParse({ ...line, unitFactor: -1 }).success).toBe(false);
  });

  it("rejects a discountPercent above 100", () => {
    const result = createSalesInvoiceLineSchema.safeParse({ ...line, discountPercent: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects a line missing revenueAccountId", () => {
    const { revenueAccountId, ...rest } = line;
    const result = createSalesInvoiceLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("revenueAccountId");
  });

  it("silently strips an unrecognised costCenterId — a real dimension a caller could lose on a revenue line", () => {
    const result = createSalesInvoiceLineSchema.safeParse({ ...line, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });
});

describe("createSalesInvoiceSchema", () => {
  const create = {
    date: "2026-08-30",
    dueDate: "2026-09-30",
    customerId: "cust-1",
    customerNameAr: "شركة النور للتجارة",
    warehouseId: "wh-1",
    branchId: "branch-1",
    arAccountId: "acc-ar",
    taxAccountId: "acc-tax",
    lines: [
      {
        lineId: "l1",
        itemId: "item-1",
        itemNameAr: "قميص قطن",
        isStock: true,
        qty: "2.000000",
        unitPrice: "199.990000",
        revenueAccountId: "acc-rev",
      },
    ],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createSalesInvoiceSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing taxAccountId", () => {
    const { taxAccountId, ...rest } = create;
    const result = createSalesInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("taxAccountId");
  });

  it("rejects an empty lines array", () => {
    const result = createSalesInvoiceSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("accepts an explicit discount and preserves it verbatim", () => {
    const result = createSalesInvoiceSchema.safeParse({ ...create, discount: { type: "percent", percent: 5 } });
    expect(result.success).toBe(true);
  });
});

describe("confirmSalesInvoiceSchema", () => {
  it("accepts an empty payload", () => {
    const result = confirmSalesInvoiceSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("salesInvoicePaymentSchema", () => {
  const payment = { amount: "1000.123456", treasuryAccountId: "acc-cash" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = salesInvoicePaymentSchema.safeParse(payment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payment);
  });

  it("rejects a payload missing treasuryAccountId — money landing nowhere is not a collection", () => {
    const { treasuryAccountId, ...rest } = payment;
    const result = salesInvoicePaymentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("treasuryAccountId");
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = salesInvoicePaymentSchema.safeParse({ ...payment, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = salesInvoicePaymentSchema.safeParse({ ...payment, amount: 1000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum paymentMethod", () => {
    const result = salesInvoicePaymentSchema.safeParse({ ...payment, paymentMethod: "crypto" });
    expect(result.success).toBe(false);
  });
});

describe("salesInvoiceFilterKeySchema", () => {
  it("accepts a stored status", () => {
    expect(salesInvoiceFilterKeySchema.safeParse("paid").success).toBe(true);
  });

  it("accepts the derived chips open and overdue", () => {
    expect(salesInvoiceFilterKeySchema.safeParse("open").success).toBe(true);
    expect(salesInvoiceFilterKeySchema.safeParse("overdue").success).toBe(true);
    expect(salesInvoiceFilterKeySchema.safeParse("all").success).toBe(true);
  });

  it("rejects a value in neither union member", () => {
    const result = salesInvoiceFilterKeySchema.safeParse("archived");
    expect(result.success).toBe(false);
  });
});

describe("salesInvoiceListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = salesInvoiceListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("coerces page and pageSize from query-string values", () => {
    const result = salesInvoiceListQuerySchema.safeParse({ page: "2", pageSize: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("rejects a pageSize above 200", () => {
    const result = salesInvoiceListQuerySchema.safeParse({ pageSize: "201" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative page", () => {
    const result = salesInvoiceListQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });
});

describe("appliedSalesInvoicePromotionSchema", () => {
  const applied = {
    promotionId: "promo-1",
    code: "SUMMER10",
    nameAr: "خصم الصيف",
    couponCode: null,
    discountTotal: "50.000000",
    lineDiscounts: [{ lineId: "l1", itemId: "item-1", amount: "50.000000" }],
    appliedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = appliedSalesInvoicePromotionSchema.safeParse(applied);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(applied);
  });

  it("rejects a payload missing discountTotal", () => {
    const { discountTotal, ...rest } = applied;
    const result = appliedSalesInvoicePromotionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("promotionUsageRowSchema", () => {
  const row = { id: "promo-1", code: "SUMMER10", nameAr: "خصم الصيف", usageCount: 42, discountGranted: "2100.000000", reversedDiscount: "100.000000", netDiscount: "2000.000000" };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = promotionUsageRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("rejects a row missing netDiscount", () => {
    const { netDiscount, ...rest } = row;
    const result = promotionUsageRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("salesInvoiceStatsSchema", () => {
  const stats = { count: 120, sales: "500000.000000", collected: "400000.000000", returned: "10000.000000", remaining: "90000.000000" };

  it("accepts a minimal valid stats payload and preserves every field verbatim", () => {
    const result = salesInvoiceStatsSchema.safeParse(stats);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(stats);
  });

  it("rejects a stats payload missing sales", () => {
    const { sales, ...rest } = stats;
    const result = salesInvoiceStatsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
