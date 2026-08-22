import { describe, it, expect } from "vitest";
import { createProject, Money, type CostCenter, type CostCenterRepository } from "@mezan/domain";
import { createSqliteProjectRepository } from "./project-repository.js";

function fakeCostCenters(): CostCenterRepository {
  const byId = new Map<string, CostCenter>();
  return {
    async findById(id: string) {
      return byId.get(id) ?? null;
    },
    async findByCode() {
      return null;
    },
    async list() {
      return Array.from(byId.values());
    },
    async create(cc) {
      byId.set(cc.id, cc);
    },
    async update(cc) {
      byId.set(cc.id, cc);
    },
  };
}

describe("SqliteProjectRepository", () => {
  it("creates and retrieves a project by id and by code", async () => {
    const repo = createSqliteProjectRepository();
    try {
      await createProject(
        { id: "p1", code: "PRJ-001", nameAr: "برج النيل", budget: Money.fromMajor("100000") },
        { projects: repo, costCenters: fakeCostCenters() },
      );
      expect(await repo.findById("p1")).toMatchObject({ code: "PRJ-001", nameAr: "برج النيل" });
      expect(await repo.findByCode("PRJ-001")).toMatchObject({ id: "p1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips the budget Money value to the exact scaled value", async () => {
    const repo = createSqliteProjectRepository();
    try {
      const budget = Money.fromMajor("1250.500001");
      await createProject(
        { id: "p1", code: "PRJ-001", nameAr: "x", budget },
        { projects: repo, costCenters: fakeCostCenters() },
      );
      const reloaded = await repo.findById("p1");
      expect(reloaded?.budget.toScaledNumber()).toBe(budget.toScaledNumber());
      expect(reloaded?.budget.toString()).toBe("1250.500001");
    } finally {
      repo.close();
    }
  });

  it("round-trips null customerId/managerId/startDate/endDate/siteAddress/notes (not the string 'null')", async () => {
    const repo = createSqliteProjectRepository();
    try {
      await createProject(
        { id: "p1", code: "PRJ-001", nameAr: "x" },
        { projects: repo, costCenters: fakeCostCenters() },
      );
      const reloaded = await repo.findById("p1");
      expect(reloaded?.customerId).toBeNull();
      expect(reloaded?.managerId).toBeNull();
      expect(reloaded?.startDate).toBeNull();
      expect(reloaded?.endDate).toBeNull();
      expect(reloaded?.siteAddress).toBeNull();
      expect(reloaded?.notes).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status flip)", async () => {
    const repo = createSqliteProjectRepository();
    try {
      const created = await createProject(
        { id: "p1", code: "PRJ-001", nameAr: "x" },
        { projects: repo, costCenters: fakeCostCenters() },
      );
      await repo.update({ ...created, status: "active" });
      expect((await repo.findById("p1"))?.status).toBe("active");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted project", async () => {
    const repo = createSqliteProjectRepository();
    try {
      const costCenters = fakeCostCenters();
      await createProject({ id: "p1", code: "PRJ-001", nameAr: "أ" }, { projects: repo, costCenters });
      await createProject({ id: "p2", code: "PRJ-002", nameAr: "ب" }, { projects: repo, costCenters });
      const all = await repo.list();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.code).sort()).toEqual(["PRJ-001", "PRJ-002"]);
    } finally {
      repo.close();
    }
  });
});
