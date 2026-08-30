import { describe, it, expect } from "vitest";
import { labelTemplateCodeSchema, labelTemplateSchema, labelBatchLineInputSchema } from "./label-printing.js";

describe("labelTemplateCodeSchema", () => {
  it("accepts each known template code", () => {
    for (const code of ["THERMAL_40x30", "SHELF_50x25", "PRODUCT_100x50"]) {
      expect(labelTemplateCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects a code outside the enum", () => {
    expect(labelTemplateCodeSchema.safeParse("THERMAL_99x99").success).toBe(false);
  });
});

describe("labelTemplateSchema", () => {
  const template = { code: "THERMAL_40x30" as const, labelAr: "حراري 40×30", widthMm: 40, heightMm: 30 };

  it("accepts a minimal valid template and preserves every field verbatim", () => {
    const result = labelTemplateSchema.safeParse(template);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(template);
  });

  it("rejects a template missing labelAr", () => {
    const { labelAr, ...rest } = template;
    const result = labelTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("labelAr");
  });

  it("rejects a zero or negative widthMm", () => {
    expect(labelTemplateSchema.safeParse({ ...template, widthMm: 0 }).success).toBe(false);
    expect(labelTemplateSchema.safeParse({ ...template, widthMm: -1 }).success).toBe(false);
  });

  it("rejects an out-of-enum code", () => {
    const result = labelTemplateSchema.safeParse({ ...template, code: "THERMAL_99x99" });
    expect(result.success).toBe(false);
  });
});

describe("labelBatchLineInputSchema", () => {
  const line = {
    itemId: "item-1",
    nameAr: "قميص قطن",
    code: "SKU-001",
    barcode: "6221234567890",
    price: "199.990000",
    copies: 3,
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = labelBatchLineInputSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a line missing itemId", () => {
    const { itemId, ...rest } = line;
    const result = labelBatchLineInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("itemId");
  });

  it("never coerces price to a float — high-precision decimal string survives verbatim", () => {
    const result = labelBatchLineInputSchema.safeParse({ ...line, price: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.price).toBe("0.100001");
  });

  it("rejects a price sent as a JS number instead of a string", () => {
    const result = labelBatchLineInputSchema.safeParse({ ...line, price: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative copies count", () => {
    expect(labelBatchLineInputSchema.safeParse({ ...line, copies: 0 }).success).toBe(false);
    expect(labelBatchLineInputSchema.safeParse({ ...line, copies: -1 }).success).toBe(false);
  });

  it("rejects a non-integer copies count", () => {
    const result = labelBatchLineInputSchema.safeParse({ ...line, copies: 1.5 });
    expect(result.success).toBe(false);
  });
});
