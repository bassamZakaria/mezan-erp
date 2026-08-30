import { describe, it, expect } from "vitest";
import {
  priceListLineSchema,
  priceListLineViewSchema,
  priceListSchema,
  createPriceListSchema,
  updatePriceListSchema,
  resolvePriceListPriceSchema,
} from "./price-list.js";

describe("priceListLineSchema", () => {
  const line = { itemId: "item-1", unitCode: "PCS", minQty: "10", price: "45.500000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = priceListLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("accepts a line without minQty — the base tier is implied", () => {
    const { minQty, ...rest } = line;
    const result = priceListLineSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("never coerces price to a float — high-precision decimal string survives verbatim", () => {
    const result = priceListLineSchema.safeParse({ ...line, price: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.price).toBe("0.100001");
  });

  it("rejects price sent as a JS number instead of a string", () => {
    const result = priceListLineSchema.safeParse({ ...line, price: 45.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative minQty", () => {
    const result = priceListLineSchema.safeParse({ ...line, minQty: "-5" });
    expect(result.success).toBe(false);
  });

  it("rejects a minQty sent as a JS number instead of a string", () => {
    const result = priceListLineSchema.safeParse({ ...line, minQty: 10 });
    expect(result.success).toBe(false);
  });
});

describe("priceListLineViewSchema", () => {
  it("requires minQty explicitly, unlike the input schema", () => {
    const { itemId, unitCode, price } = { itemId: "item-1", unitCode: null, price: "45.500000" };
    const result = priceListLineViewSchema.safeParse({ itemId, unitCode, price });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("minQty");
  });

  it("accepts a minimal valid view row and preserves every field verbatim", () => {
    const row = { itemId: "item-1", unitCode: null, minQty: "0", price: "45.500000" };
    const result = priceListLineViewSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });
});

describe("priceListSchema", () => {
  const priceList = {
    id: "pl-1",
    code: "RETAIL",
    nameAr: "قائمة التجزئة",
    nameEn: null,
    description: null,
    isBase: true,
    active: true,
    lines: [{ itemId: "item-1", unitCode: null, minQty: "0", price: "45.500000" }],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid price list and preserves every field verbatim", () => {
    const result = priceListSchema.safeParse(priceList);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(priceList);
  });

  it("rejects a price list missing isBase", () => {
    const { isBase, ...rest } = priceList;
    const result = priceListSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("isBase");
  });

  it("silently strips an unrecognised currency — a real dimension a caller could lose", () => {
    const result = priceListSchema.safeParse({ ...priceList, currency: "USD" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("currency");
  });
});

describe("createPriceListSchema", () => {
  const create = { code: "RETAIL", nameAr: "قائمة التجزئة" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPriceListSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createPriceListSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects a line with price sent as a JS number", () => {
    const result = createPriceListSchema.safeParse({
      ...create,
      lines: [{ itemId: "item-1", price: 45.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("updatePriceListSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updatePriceListSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updatePriceListSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });
});

describe("resolvePriceListPriceSchema", () => {
  const query = { itemId: "item-1", fallback: "0" };

  it("accepts a minimal valid query with optionals omitted", () => {
    const result = resolvePriceListPriceSchema.safeParse(query);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(query);
  });

  it("rejects a query missing fallback", () => {
    const { fallback, ...rest } = query;
    const result = resolvePriceListPriceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("fallback");
  });

  it("rejects a negative qty when supplied", () => {
    const result = resolvePriceListPriceSchema.safeParse({ ...query, qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects fallback sent as a JS number instead of a string", () => {
    const result = resolvePriceListPriceSchema.safeParse({ ...query, fallback: 0 });
    expect(result.success).toBe(false);
  });
});
