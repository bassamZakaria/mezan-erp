import { describe, it, expect } from "vitest";
import { InMemoryCostCenterRepository } from "./test-helpers/in-memory-cost-center-repository.js";
import { createCostCenter } from "./create-cost-center.js";
import { updateCostCenter } from "./update-cost-center.js";
import { CircularParentCostCenterError, CostCenterNotFoundError, InvalidParentCostCenterError } from "./errors.js";

describe("updateCostCenter", () => {
  it("updates fields in place", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" }, repo);
    const updated = await updateCostCenter("cc1", { nameAr: "الإدارة", notes: "ملاحظة" }, repo);
    expect(updated.nameAr).toBe("الإدارة");
    expect(updated.notes).toBe("ملاحظة");
  });

  it("404s (throws CostCenterNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryCostCenterRepository();
    await expect(updateCostCenter("nope", { nameAr: "x" }, repo)).rejects.toThrow(CostCenterNotFoundError);
  });

  it("rejects a parent that does not exist", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x" }, repo);
    await expect(updateCostCenter("cc1", { parentId: "nope" }, repo)).rejects.toThrow(InvalidParentCostCenterError);
  });

  it("rejects setting itself as its own parent", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x" }, repo);
    await expect(updateCostCenter("cc1", { parentId: "cc1" }, repo)).rejects.toThrow(CircularParentCostCenterError);
  });

  it("rejects a reparent that would create a cycle", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "root" }, repo);
    await createCostCenter({ id: "cc2", code: "CC-002", nameAr: "child", parentId: "cc1" }, repo);
    await expect(updateCostCenter("cc1", { parentId: "cc2" }, repo)).rejects.toThrow(CircularParentCostCenterError);
  });

  it("can deactivate a cost center via status", async () => {
    const repo = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x" }, repo);
    const updated = await updateCostCenter("cc1", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });
});
