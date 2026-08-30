import { describe, it, expect } from "vitest";
import { createInMemoryJobTitleRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createJobTitle, updateJobTitle } from "./create-job-title.js";
import { InvalidJobTitleError } from "./errors.js";

describe("createJobTitle", () => {
  it("creates a job title scoped to a department", async () => {
    const repo = createInMemoryJobTitleRepository();
    const jt = await createJobTitle({ id: "jt-1", departmentId: "dept-1", name: "Sales Officer", nameAr: "مسؤول مبيعات" }, repo);
    expect(jt).toMatchObject({ id: "jt-1", departmentId: "dept-1", name: "Sales Officer", nameAr: "مسؤول مبيعات", active: true });
    expect(await repo.listByDepartmentId("dept-1")).toEqual([jt]);
  });

  it("rejects a missing department or name", async () => {
    const repo = createInMemoryJobTitleRepository();
    await expect(createJobTitle({ id: "jt-1", departmentId: "", name: "X" }, repo)).rejects.toThrow(InvalidJobTitleError);
    await expect(createJobTitle({ id: "jt-2", departmentId: "d1", name: "" }, repo)).rejects.toThrow(InvalidJobTitleError);
  });
});

describe("updateJobTitle", () => {
  it("locks the department but allows name/active edits", async () => {
    const repo = createInMemoryJobTitleRepository();
    const jt = await createJobTitle({ id: "jt-1", departmentId: "dept-1", name: "Sales Officer" }, repo);
    const updated = updateJobTitle(jt, { name: "Senior Sales Officer", active: false });
    expect(updated.name).toBe("Senior Sales Officer");
    expect(updated.active).toBe(false);
    expect(updated.departmentId).toBe("dept-1");
  });

  it("rejects blanking the name on update", async () => {
    const repo = createInMemoryJobTitleRepository();
    const jt = await createJobTitle({ id: "jt-1", departmentId: "dept-1", name: "Sales Officer" }, repo);
    expect(() => updateJobTitle(jt, { name: "" })).toThrow(InvalidJobTitleError);
  });
});
