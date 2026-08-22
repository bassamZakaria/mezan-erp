import { describe, it, expect } from "vitest";
import { InMemoryCostCenterRepository } from "./test-helpers/in-memory-cost-center-repository.js";
import { createCostCenter, validateNewCostCenter } from "./create-cost-center.js";
import { DuplicateCostCenterCodeError, InvalidParentCostCenterError } from "./errors.js";

describe("createCostCenter", () => {
  it("creates a standalone (unlinked) root cost center with defaults", async () => {
    const repo = new InMemoryCostCenterRepository();
    const cc = await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" }, repo);
    expect(cc).toMatchObject({
      code: "CC-001",
      type: "general",
      departmentId: null,
      branchId: null,
      parentId: null,
      status: "active",
    });
    expect(await repo.findById("cc1")).toEqual(cc);
  });

  it("creates a child cost center under a parent", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" }, repo);
    const child = await createCostCenter(
      { id: "cc2", code: "CC-002", nameAr: "المبيعات", parentId: "cc1", type: "department", departmentId: "dep-sales" },
      repo,
    );
    expect(child.parentId).toBe("cc1");
    expect(child.departmentId).toBe("dep-sales");
  });

  it("rejects a duplicate cost center code", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" }, repo);
    await expect(createCostCenter({ id: "cc2", code: "CC-001", nameAr: "نسخة" }, repo)).rejects.toThrow(
      DuplicateCostCenterCodeError,
    );
  });

  it("rejects a parent that does not exist", async () => {
    const repo = new InMemoryCostCenterRepository();
    await expect(
      createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x", parentId: "does-not-exist" }, repo),
    ).rejects.toThrow(InvalidParentCostCenterError);
  });

  it("validateNewCostCenter is a pure pre-check that does not persist anything", () => {
    expect(() => validateNewCostCenter({ id: "x", code: "NEW", nameAr: "n" }, [])).not.toThrow();
  });
});
