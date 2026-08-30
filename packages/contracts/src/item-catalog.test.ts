import { describe, it, expect } from "vitest";
import {
  itemCatalogStatusSchema,
  itemUnitSchema,
  createItemUnitSchema,
  updateItemUnitSchema,
  itemCategorySchema,
  createItemCategorySchema,
  updateItemCategorySchema,
} from "./item-catalog.js";

describe("itemCatalogStatusSchema", () => {
  it("accepts active and inactive", () => {
    expect(itemCatalogStatusSchema.safeParse("active").success).toBe(true);
    expect(itemCatalogStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(itemCatalogStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("itemUnitSchema", () => {
  const unit = { code: "PCS", nameAr: "قطعة", nameEn: null, status: "active" as const };

  it("accepts a minimal valid unit and preserves every field verbatim", () => {
    const result = itemUnitSchema.safeParse(unit);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(unit);
  });

  it("rejects a unit missing status", () => {
    const { status, ...rest } = unit;
    const result = itemUnitSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("status");
  });

  it("rejects a lowercase code", () => {
    const result = itemUnitSchema.safeParse({ ...unit, code: "pcs" });
    expect(result.success).toBe(false);
  });

  it("rejects a code longer than 12 characters", () => {
    const result = itemUnitSchema.safeParse({ ...unit, code: "A".repeat(13) });
    expect(result.success).toBe(false);
  });
});

describe("createItemUnitSchema", () => {
  const create = { code: "PCS", nameAr: "قطعة" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createItemUnitSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createItemUnitSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects an invalid code", () => {
    const result = createItemUnitSchema.safeParse({ ...create, code: "bad code" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised status — status is only settable via update", () => {
    const result = createItemUnitSchema.safeParse({ ...create, status: "inactive" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });
});

describe("updateItemUnitSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateItemUnitSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateItemUnitSchema.safeParse({ status: "inactive" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ status: "inactive" });
  });

  it("rejects an out-of-enum status", () => {
    const result = updateItemUnitSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("itemCategorySchema", () => {
  const category = { id: "cat-1", nameAr: "أجهزة كهربائية", nameEn: null, parentId: null, status: "active" as const };

  it("accepts a minimal valid category and preserves every field verbatim", () => {
    const result = itemCategorySchema.safeParse(category);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(category);
  });

  it("accepts a non-null parentId for a sub-category", () => {
    const result = itemCategorySchema.safeParse({ ...category, parentId: "cat-parent" });
    expect(result.success).toBe(true);
  });

  it("rejects a category missing id", () => {
    const { id, ...rest } = category;
    const result = itemCategorySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("id");
  });
});

describe("createItemCategorySchema", () => {
  const create = { id: "cat-1", nameAr: "أجهزة كهربائية" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createItemCategorySchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createItemCategorySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });
});

describe("updateItemCategorySchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateItemCategorySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateItemCategorySchema.safeParse({ parentId: "cat-parent" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ parentId: "cat-parent" });
  });

  it("rejects an out-of-enum status", () => {
    const result = updateItemCategorySchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});
