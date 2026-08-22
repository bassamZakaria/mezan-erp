import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryCostCenterRepository } from "../cost-centers/test-helpers/in-memory-cost-center-repository.js";
import { DuplicateCostCenterCodeError } from "../cost-centers/index.js";
import { InMemoryProjectRepository } from "./test-helpers/in-memory-project-repository.js";
import { createProject } from "./create-project.js";
import { DuplicateProjectCodeError } from "./errors.js";

function makeDeps() {
  return {
    projects: new InMemoryProjectRepository(),
    costCenters: new InMemoryCostCenterRepository(),
  };
}

describe("createProject", () => {
  it("creates a project and auto-creates a linked PRJ-{code} cost center", async () => {
    const deps = makeDeps();
    const project = await createProject(
      { id: "prj1", code: "TOWER-A", nameAr: "برج A", budget: Money.fromMajor("100000") },
      deps,
    );

    expect(project).toMatchObject({
      id: "prj1",
      code: "TOWER-A",
      status: "planned",
    });
    expect(project.costCenterId).toBeTruthy();

    const costCenter = await deps.costCenters.findById(project.costCenterId);
    expect(costCenter).not.toBeNull();
    expect(costCenter?.code).toBe("PRJ-TOWER-A");
    expect(costCenter?.type).toBe("project");

    expect(await deps.projects.findById("prj1")).toEqual(project);
  });

  it("rejects a duplicate project code", async () => {
    const deps = makeDeps();
    await createProject({ id: "prj1", code: "TOWER-A", nameAr: "برج A" }, deps);
    await expect(createProject({ id: "prj2", code: "TOWER-A", nameAr: "نسخة" }, deps)).rejects.toThrow(
      DuplicateProjectCodeError,
    );
  });

  it("lets a duplicate derived cost-center code propagate unchanged", async () => {
    const deps = makeDeps();
    await deps.costCenters.create({
      id: "cc-existing",
      code: "PRJ-TOWER-A",
      nameAr: "موجود",
      nameEn: null,
      type: "project",
      departmentId: null,
      branchId: null,
      parentId: null,
      notes: null,
      status: "active",
    });
    await expect(createProject({ id: "prj1", code: "TOWER-A", nameAr: "برج A" }, deps)).rejects.toThrow(
      DuplicateCostCenterCodeError,
    );
  });

  it("gives two different projects two distinct cost centers", async () => {
    const deps = makeDeps();
    const p1 = await createProject({ id: "prj1", code: "TOWER-A", nameAr: "برج A" }, deps);
    const p2 = await createProject({ id: "prj2", code: "TOWER-B", nameAr: "برج B" }, deps);

    expect(p1.costCenterId).not.toBe(p2.costCenterId);

    const cc1 = await deps.costCenters.findById(p1.costCenterId);
    const cc2 = await deps.costCenters.findById(p2.costCenterId);
    expect(cc1?.code).toBe("PRJ-TOWER-A");
    expect(cc2?.code).toBe("PRJ-TOWER-B");
  });
});
