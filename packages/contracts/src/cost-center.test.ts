import { describe, it, expect } from "vitest";
import {
  costCenterTypeSchema,
  costCenterStatusSchema,
  costCenterSchema,
  createCostCenterSchema,
  updateCostCenterSchema,
  importableDepartmentSchema,
  createCostCentersFromDepartmentsSchema,
} from "./cost-center.js";

describe("costCenterTypeSchema", () => {
  it("accepts each known type", () => {
    for (const type of ["general", "department", "project", "branch"]) {
      expect(costCenterTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(costCenterTypeSchema.safeParse("region").success).toBe(false);
  });
});

describe("costCenterSchema", () => {
  const costCenter = {
    id: "cc-1",
    code: "CC-001",
    nameAr: "التسويق",
    nameEn: null,
    type: "department" as const,
    departmentId: "dept-1",
    branchId: null,
    parentId: null,
    notes: null,
    status: "active" as const,
  };

  it("accepts a minimal valid cost centre and preserves every field verbatim", () => {
    const result = costCenterSchema.safeParse(costCenter);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(costCenter);
  });

  it("rejects a cost centre missing type", () => {
    const { type, ...rest } = costCenter;
    const result = costCenterSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects an out-of-enum status", () => {
    const result = costCenterSchema.safeParse({ ...costCenter, status: "archived" });
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised budgetAmount — a real dimension a caller could lose", () => {
    const result = costCenterSchema.safeParse({ ...costCenter, budgetAmount: "10000.00" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("budgetAmount");
  });
});

describe("createCostCenterSchema", () => {
  const create = { id: "cc-1", code: "CC-001", nameAr: "التسويق" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createCostCenterSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createCostCenterSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("rejects an out-of-enum type when supplied", () => {
    const result = createCostCenterSchema.safeParse({ ...create, type: "region" });
    expect(result.success).toBe(false);
  });
});

describe("updateCostCenterSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateCostCenterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateCostCenterSchema.safeParse({ status: "inactive" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ status: "inactive" });
  });

  it("rejects an out-of-enum status", () => {
    const result = updateCostCenterSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("importableDepartmentSchema", () => {
  const department = {
    id: "dept-1",
    code: "DEPT-01",
    name: "Marketing",
    nameAr: "التسويق",
    suggestedCode: "CC-DEPT-01",
    codeInUse: false,
  };

  it("accepts a minimal valid department and preserves every field verbatim", () => {
    const result = importableDepartmentSchema.safeParse(department);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(department);
  });

  it("rejects a department missing suggestedCode", () => {
    const { suggestedCode, ...rest } = department;
    const result = importableDepartmentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("suggestedCode");
  });
});

describe("createCostCentersFromDepartmentsSchema", () => {
  it("accepts an empty payload to import every un-costed department", () => {
    const result = createCostCentersFromDepartmentsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts an explicit departmentIds list and a parentId", () => {
    const payload = { departmentIds: ["dept-1", "dept-2"], parentId: "cc-parent" };
    const result = createCostCentersFromDepartmentsSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("accepts a null parentId for a top-level cost centre", () => {
    const result = createCostCentersFromDepartmentsSchema.safeParse({ parentId: null });
    expect(result.success).toBe(true);
  });
});
