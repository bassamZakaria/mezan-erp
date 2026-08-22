import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryCostCenterRepository } from "../cost-centers/test-helpers/in-memory-cost-center-repository.js";
import { InMemoryProjectRepository } from "./test-helpers/in-memory-project-repository.js";
import { createProject } from "./create-project.js";
import { updateProject } from "./update-project.js";
import { InvalidProjectError } from "./errors.js";
import type { Project } from "./project.js";

async function makeProject(): Promise<Project> {
  const deps = {
    projects: new InMemoryProjectRepository(),
    costCenters: new InMemoryCostCenterRepository(),
  };
  return createProject({ id: "prj1", code: "TOWER-A", nameAr: "برج A", budget: Money.fromMajor("100000") }, deps);
}

describe("updateProject", () => {
  it("updates fields in place", async () => {
    const project = await makeProject();
    const updated = updateProject(project, { status: "active", notes: "ملاحظة" });
    expect(updated.status).toBe("active");
    expect(updated.notes).toBe("ملاحظة");
    expect(updated.code).toBe(project.code);
    expect(updated.costCenterId).toBe(project.costCenterId);
  });

  it("rejects an invalid status", async () => {
    const project = await makeProject();
    expect(() => updateProject(project, { status: "bogus" as unknown as Project["status"] })).toThrow(
      InvalidProjectError,
    );
  });

  it("rejects an empty name", async () => {
    const project = await makeProject();
    expect(() => updateProject(project, { nameAr: "  " })).toThrow(InvalidProjectError);
  });

  it("keeps id/code/costCenterId immutable at the type level", async () => {
    const project = await makeProject();
    const updated = updateProject(project, { managerId: "mgr-1" });
    expect(updated.id).toBe(project.id);
  });
});
