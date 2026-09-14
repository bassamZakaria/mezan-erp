import { describe, it, expect } from "vitest";
import { warehouseTypeSchema, warehouseSchema, createWarehouseSchema, updateWarehouseSchema } from "./warehouse.js";

describe("warehouseTypeSchema", () => {
  it("accepts each of the known warehouse types, the contracting site store included", () => {
    for (const type of ["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN", "SITE"]) {
      expect(warehouseTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(warehouseTypeSchema.safeParse("STAGING").success).toBe(false);
  });

  it("rejects a lowercase type — the enum is case-sensitive", () => {
    expect(warehouseTypeSchema.safeParse("main").success).toBe(false);
  });
});

describe("warehouseSchema", () => {
  const warehouse = {
    id: "wh-1",
    code: "MAIN-01",
    name: "المخزن الرئيسي",
    nameEn: null,
    branchId: "branch-1",
    type: "MAIN" as const,
    isDefault: true,
    active: true,
    projectId: null,
    custodianUserId: null,
  };

  it("accepts a minimal valid warehouse and preserves every field verbatim", () => {
    const result = warehouseSchema.safeParse(warehouse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(warehouse);
  });

  it("rejects a warehouse missing branchId", () => {
    const { branchId, ...rest } = warehouse;
    const result = warehouseSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects a warehouse missing type", () => {
    const { type, ...rest } = warehouse;
    const result = warehouseSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects an invalid code", () => {
    const result = warehouseSchema.safeParse({ ...warehouse, code: "bad code" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised costCenterId — a real dimension a caller could lose", () => {
    const result = warehouseSchema.safeParse({ ...warehouse, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });
});

describe("createWarehouseSchema", () => {
  const create = { id: "wh-1", code: "MAIN-01", name: "المخزن الرئيسي", branchId: "branch-1" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createWarehouseSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing branchId", () => {
    const { branchId, ...rest } = create;
    const result = createWarehouseSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects an invalid code even though other fields are optional", () => {
    const result = createWarehouseSchema.safeParse({ ...create, code: "bad code" });
    expect(result.success).toBe(false);
  });
});

describe("updateWarehouseSchema", () => {
  it("accepts a partial payload with a single field", () => {
    const result = updateWarehouseSchema.safeParse({ name: "المخزن الفرعي" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "المخزن الفرعي" });
  });

  it("accepts an empty payload — every field is optional on update", () => {
    const result = updateWarehouseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id — id is omitted from the update schema entirely", () => {
    const result = updateWarehouseSchema.safeParse({ id: "wh-2" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });

  it("rejects an out-of-enum type when supplied", () => {
    const result = updateWarehouseSchema.safeParse({ type: "STAGING" });
    expect(result.success).toBe(false);
  });
});
