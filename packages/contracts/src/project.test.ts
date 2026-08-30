import { describe, it, expect } from "vitest";
import { projectStatusSchema, projectSchema, createProjectSchema, updateProjectSchema } from "./project.js";

describe("projectStatusSchema", () => {
  it("accepts each known status", () => {
    for (const status of ["planned", "active", "on_hold", "completed", "cancelled"]) {
      expect(projectStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(projectStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("projectSchema", () => {
  const project = {
    id: "proj-1",
    code: "PRJ-001",
    nameAr: "برج النيل",
    nameEn: null,
    status: "active" as const,
    customerId: null,
    managerId: null,
    startDate: null,
    endDate: null,
    budget: "5000000.123456",
    siteAddress: null,
    notes: null,
    costCenterId: "cc-1",
  };

  it("accepts a minimal valid project and preserves every field verbatim", () => {
    const result = projectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(project);
  });

  it("rejects a project missing costCenterId — every project must post its cost", () => {
    const { costCenterId, ...rest } = project;
    const result = projectSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("costCenterId");
  });

  it("rejects an empty-string costCenterId", () => {
    const result = projectSchema.safeParse({ ...project, costCenterId: "" });
    expect(result.success).toBe(false);
  });

  it("never coerces budget to a float — high-precision decimal string survives verbatim", () => {
    const result = projectSchema.safeParse({ ...project, budget: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.budget).toBe("0.100001");
  });

  it("rejects budget sent as a JS number instead of a string", () => {
    const result = projectSchema.safeParse({ ...project, budget: 5000000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = projectSchema.safeParse({ ...project, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  const create = { id: "proj-1", code: "PRJ-001", nameAr: "برج النيل" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createProjectSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing nameAr", () => {
    const { nameAr, ...rest } = create;
    const result = createProjectSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameAr");
  });

  it("never coerces budget to a float when supplied", () => {
    const result = createProjectSchema.safeParse({ ...create, budget: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.budget).toBe("0.100001");
  });

  it("rejects budget sent as a JS number instead of a string", () => {
    const result = createProjectSchema.safeParse({ ...create, budget: 100 });
    expect(result.success).toBe(false);
  });

  it("FINDING: silently strips costCenterId on create, even though the read schema requires it on every project — a caller cannot set a project's cost centre at creation time", () => {
    const result = createProjectSchema.safeParse({ ...create, costCenterId: "cc-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });

  it("silently strips status on create — a project cannot be created with any status but the server default", () => {
    const result = createProjectSchema.safeParse({ ...create, status: "on_hold" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });
});

describe("updateProjectSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateProjectSchema.safeParse({ status: "on_hold" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ status: "on_hold" });
  });

  it("never coerces budget to a float when supplied", () => {
    const result = updateProjectSchema.safeParse({ budget: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.budget).toBe("0.100001");
  });

  it("FINDING: silently strips costCenterId on update — a project's cost centre can never be corrected through this endpoint either", () => {
    const result = updateProjectSchema.safeParse({ costCenterId: "cc-2" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("costCenterId");
  });

  it("rejects an out-of-enum status when supplied", () => {
    const result = updateProjectSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});
