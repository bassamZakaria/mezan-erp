import { describe, it, expect } from "vitest";
import { createCostCenter, buildCostCenterTree } from "@mezan/domain";
import { createSqliteCostCenterRepository } from "./cost-center-repository.js";

describe("SqliteCostCenterRepository", () => {
  it("creates and retrieves a cost center by id and by code", async () => {
    const repo = createSqliteCostCenterRepository();
    try {
      await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "الإدارة العامة" }, repo);
      expect(await repo.findById("cc1")).toMatchObject({ code: "CC-001", nameAr: "الإدارة العامة" });
      expect(await repo.findByCode("CC-001")).toMatchObject({ id: "cc1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips null parentId/departmentId/branchId/notes (not the string 'null')", async () => {
    const repo = createSqliteCostCenterRepository();
    try {
      await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x" }, repo);
      const reloaded = await repo.findById("cc1");
      expect(reloaded?.parentId).toBeNull();
      expect(reloaded?.departmentId).toBeNull();
      expect(reloaded?.branchId).toBeNull();
      expect(reloaded?.notes).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status flip)", async () => {
    const repo = createSqliteCostCenterRepository();
    try {
      const created = await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "x" }, repo);
      await repo.update({ ...created, status: "inactive" });
      expect((await repo.findById("cc1"))?.status).toBe("inactive");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted cost center and a real tree can be built from the rows", async () => {
    const repo = createSqliteCostCenterRepository();
    try {
      await createCostCenter({ id: "cc1", code: "CC-001", nameAr: "root" }, repo);
      await createCostCenter({ id: "cc2", code: "CC-002", nameAr: "child", parentId: "cc1" }, repo);
      const all = await repo.list();
      expect(all).toHaveLength(2);
      const tree = buildCostCenterTree(all);
      expect(tree.map((n) => n.id)).toEqual(["cc1"]);
      expect(tree[0]?.children.map((n) => n.id)).toEqual(["cc2"]);
    } finally {
      repo.close();
    }
  });
});
