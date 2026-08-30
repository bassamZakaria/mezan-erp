import { describe, it, expect } from "vitest";
import {
  itemSpecificationTypeSchema,
  itemSpecificationSchema,
  createItemSpecificationSchema,
  updateItemSpecificationSchema,
} from "./item-specifications.js";

describe("itemSpecificationTypeSchema", () => {
  it("accepts each known spec type", () => {
    for (const type of ["select", "number", "text"]) {
      expect(itemSpecificationTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(itemSpecificationTypeSchema.safeParse("boolean").success).toBe(false);
  });
});

describe("itemSpecificationSchema", () => {
  const spec = {
    code: "COLOR",
    nameAr: "اللون",
    nameEn: null,
    type: "select" as const,
    values: ["أحمر", "أزرق"],
    unit: null,
    filterable: true,
    status: "active" as const,
    usageCount: 12,
  };

  it("accepts a minimal valid spec and preserves every field verbatim", () => {
    const result = itemSpecificationSchema.safeParse(spec);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(spec);
  });

  it("rejects a spec missing type", () => {
    const { type, ...rest } = spec;
    const result = itemSpecificationSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects a negative usageCount", () => {
    const result = itemSpecificationSchema.safeParse({ ...spec, usageCount: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid code", () => {
    const result = itemSpecificationSchema.safeParse({ ...spec, code: "color!" });
    expect(result.success).toBe(false);
  });

  it("silently strips a caller-supplied usageCount override attempt on create — it is derived server-side", () => {
    const create = { code: "COLOR", nameAr: "اللون", type: "select" as const };
    const result = createItemSpecificationSchema.safeParse({ ...create, usageCount: 999 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("usageCount");
  });
});

describe("createItemSpecificationSchema", () => {
  const create = { code: "COLOR", nameAr: "اللون", type: "select" as const };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createItemSpecificationSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing type", () => {
    const { type, ...rest } = create;
    const result = createItemSpecificationSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects an out-of-enum type", () => {
    const result = createItemSpecificationSchema.safeParse({ ...create, type: "boolean" });
    expect(result.success).toBe(false);
  });
});

describe("updateItemSpecificationSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateItemSpecificationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateItemSpecificationSchema.safeParse({ filterable: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ filterable: false });
  });

  it("rejects an out-of-enum status", () => {
    const result = updateItemSpecificationSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });

  it("silently strips type — type is immutable after creation, not part of the update schema", () => {
    const result = updateItemSpecificationSchema.safeParse({ type: "number" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("type");
  });
});
