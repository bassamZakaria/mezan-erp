import { describe, it, expect } from "vitest";
import {
  productTemplateStatusSchema,
  productTemplateAttributeSchema,
  productTemplateSchema,
  createProductTemplateSchema,
  addTemplateAttributeSchema,
  addAttributeValueSchema,
  productTemplateVariantSchema,
  generateVariantsSchema,
  generateVariantsResultSchema,
} from "./product-templates.js";

describe("productTemplateStatusSchema", () => {
  it("accepts active and inactive", () => {
    expect(productTemplateStatusSchema.safeParse("active").success).toBe(true);
    expect(productTemplateStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(productTemplateStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("productTemplateAttributeSchema", () => {
  const attribute = { id: "attr-1", nameAr: "اللون", nameEn: null, values: ["أحمر", "أزرق"] };

  it("accepts a minimal valid attribute and preserves every field verbatim", () => {
    const result = productTemplateAttributeSchema.safeParse(attribute);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(attribute);
  });

  it("rejects an attribute missing values", () => {
    const { values, ...rest } = attribute;
    const result = productTemplateAttributeSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("values");
  });
});

describe("productTemplateSchema", () => {
  const template = {
    id: "tpl-1",
    code: "TSHIRT",
    nameAr: "قميص قطن",
    nameEn: null,
    baseUnitCode: "PCS",
    categoryId: null,
    brandId: null,
    costingMethod: "WAC" as const,
    defaultSalePrice: "199.990000",
    defaultCost: "99.990000",
    taxRatePercent: 14,
    attributes: [],
    status: "active" as const,
  };

  it("accepts a minimal valid template and preserves every field verbatim", () => {
    const result = productTemplateSchema.safeParse(template);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(template);
  });

  it("rejects a template missing costingMethod", () => {
    const { costingMethod, ...rest } = template;
    const result = productTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("costingMethod");
  });

  it("never coerces defaultSalePrice to a float — high-precision decimal string survives verbatim", () => {
    const result = productTemplateSchema.safeParse({ ...template, defaultSalePrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.defaultSalePrice).toBe("0.100001");
  });

  it("rejects defaultSalePrice sent as a JS number instead of a string", () => {
    const result = productTemplateSchema.safeParse({ ...template, defaultSalePrice: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum costingMethod", () => {
    const result = productTemplateSchema.safeParse({ ...template, costingMethod: "LIFO" });
    expect(result.success).toBe(false);
  });
});

describe("createProductTemplateSchema", () => {
  const create = { code: "TSHIRT", nameAr: "قميص قطن", baseUnitCode: "PCS" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createProductTemplateSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing baseUnitCode", () => {
    const { baseUnitCode, ...rest } = create;
    const result = createProductTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("baseUnitCode");
  });

  it("never coerces defaultCost to a float when supplied", () => {
    const result = createProductTemplateSchema.safeParse({ ...create, defaultCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.defaultCost).toBe("0.100001");
  });

  it("rejects defaultCost sent as a JS number instead of a string", () => {
    const result = createProductTemplateSchema.safeParse({ ...create, defaultCost: 10 });
    expect(result.success).toBe(false);
  });
});

describe("addTemplateAttributeSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = addTemplateAttributeSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts building from a specification code alone", () => {
    const result = addTemplateAttributeSchema.safeParse({ specificationCode: "COLOR" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty values array when supplied", () => {
    const result = addTemplateAttributeSchema.safeParse({ nameAr: "اللون", values: [] });
    expect(result.success).toBe(false);
  });
});

describe("addAttributeValueSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = addAttributeValueSchema.safeParse({ value: "أخضر" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ value: "أخضر" });
  });

  it("rejects an empty value", () => {
    const result = addAttributeValueSchema.safeParse({ value: "" });
    expect(result.success).toBe(false);
  });
});

describe("productTemplateVariantSchema", () => {
  const variant = {
    id: "var-1",
    templateId: "tpl-1",
    itemId: "item-1",
    itemCode: "TSHIRT-RED-M",
    values: { COLOR: "أحمر", SIZE: "M" },
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid variant and preserves every field verbatim", () => {
    const result = productTemplateVariantSchema.safeParse(variant);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(variant);
  });

  it("rejects a variant missing itemId", () => {
    const { itemId, ...rest } = variant;
    const result = productTemplateVariantSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("itemId");
  });
});

describe("generateVariantsSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const payload = { selections: [{ values: { COLOR: "أحمر" } }] };
    const result = generateVariantsSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects an empty selections array", () => {
    const result = generateVariantsSchema.safeParse({ selections: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("selections");
  });
});

describe("generateVariantsResultSchema", () => {
  const result = { created: [], skippedExisting: 3 };

  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const parsed = generateVariantsResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects a negative skippedExisting", () => {
    const parsed = generateVariantsResultSchema.safeParse({ ...result, skippedExisting: -1 });
    expect(parsed.success).toBe(false);
  });
});
