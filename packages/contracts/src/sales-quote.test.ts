import { describe, it, expect } from "vitest";
import {
  salesQuoteStatusSchema,
  salesQuoteDiscountSchema,
  createSalesQuoteLineSchema,
  createSalesQuoteSchema,
  salesQuoteListQuerySchema,
  convertSalesQuoteLineSchema,
  convertSalesQuoteToInvoiceSchema,
} from "./sales-quote.js";

describe("salesQuoteStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["draft", "sent", "accepted", "rejected", "converted", "cancelled"]) {
      expect(salesQuoteStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(salesQuoteStatusSchema.safeParse("expired").success).toBe(false);
  });
});

describe("salesQuoteDiscountSchema", () => {
  it("accepts the percent variant and preserves it verbatim", () => {
    const discount = { type: "percent" as const, percent: 10 };
    const result = salesQuoteDiscountSchema.safeParse(discount);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(discount);
  });

  it("accepts the amount variant and never coerces amount to a float", () => {
    const discount = { type: "amount" as const, amount: "0.100001" };
    const result = salesQuoteDiscountSchema.safeParse(discount);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(discount);
  });

  it("rejects a percent discount above 100", () => {
    const result = salesQuoteDiscountSchema.safeParse({ type: "percent", percent: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects a percent discount below 0", () => {
    const result = salesQuoteDiscountSchema.safeParse({ type: "percent", percent: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects amount sent as a JS number for the amount variant", () => {
    const result = salesQuoteDiscountSchema.safeParse({ type: "amount", amount: 100 });
    expect(result.success).toBe(false);
  });

  it("rejects a discriminator outside the union", () => {
    const result = salesQuoteDiscountSchema.safeParse({ type: "flat", amount: "10" });
    expect(result.success).toBe(false);
  });

  it("rejects the wrong field set for a given discriminator (percent field on the amount variant)", () => {
    const result = salesQuoteDiscountSchema.safeParse({ type: "amount", percent: 10 });
    expect(result.success).toBe(false);
  });
});

describe("createSalesQuoteLineSchema", () => {
  const line = { lineId: "l1", itemId: "item-1", itemNameAr: "قميص قطن", qty: "2.000000", unitPrice: "199.990000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = createSalesQuoteLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces unitPrice to a float — high-precision decimal string survives verbatim", () => {
    const result = createSalesQuoteLineSchema.safeParse({ ...line, unitPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe("0.100001");
  });

  it("rejects unitPrice sent as a JS number instead of a string", () => {
    const result = createSalesQuoteLineSchema.safeParse({ ...line, unitPrice: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a discountPercent above 100", () => {
    const result = createSalesQuoteLineSchema.safeParse({ ...line, discountPercent: 150 });
    expect(result.success).toBe(false);
  });
});

describe("createSalesQuoteSchema", () => {
  const create = {
    date: "2026-08-30",
    expiryDate: "2026-09-30",
    customerId: "cust-1",
    customerNameAr: "شركة النور للتجارة",
    branchId: "branch-1",
    lines: [{ lineId: "l1", itemId: "item-1", itemNameAr: "قميص قطن", qty: "2.000000", unitPrice: "199.990000" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createSalesQuoteSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing branchId", () => {
    const { branchId, ...rest } = create;
    const result = createSalesQuoteSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects an empty lines array", () => {
    const result = createSalesQuoteSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("accepts an explicit percent discount", () => {
    const result = createSalesQuoteSchema.safeParse({ ...create, discount: { type: "percent", percent: 5 } });
    expect(result.success).toBe(true);
  });

  it("silently strips an unrecognised costCenterId — a real dimension a caller could lose", () => {
    const result = createSalesQuoteSchema.safeParse({ ...create, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });
});

describe("salesQuoteListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = salesQuoteListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status filter", () => {
    const result = salesQuoteListQuerySchema.safeParse({ status: "expired" });
    expect(result.success).toBe(false);
  });
});

describe("convertSalesQuoteLineSchema", () => {
  const line = { lineId: "l1", isStock: true, revenueAccountId: "acc-rev" };

  it("accepts a minimal valid line with nullish accounts omitted", () => {
    const result = convertSalesQuoteLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a line missing revenueAccountId", () => {
    const { revenueAccountId, ...rest } = line;
    const result = convertSalesQuoteLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("revenueAccountId");
  });
});

describe("convertSalesQuoteToInvoiceSchema", () => {
  const convert = {
    dueDate: "2026-09-30",
    warehouseId: "wh-1",
    arAccountId: "acc-ar",
    taxAccountId: "acc-tax",
    lines: [{ lineId: "l1", isStock: true, revenueAccountId: "acc-rev" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = convertSalesQuoteToInvoiceSchema.safeParse(convert);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(convert);
  });

  it("rejects an empty lines array", () => {
    const result = convertSalesQuoteToInvoiceSchema.safeParse({ ...convert, lines: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing taxAccountId", () => {
    const { taxAccountId, ...rest } = convert;
    const result = convertSalesQuoteToInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("taxAccountId");
  });
});
