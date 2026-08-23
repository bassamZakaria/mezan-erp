import { describe, it, expect } from "vitest";
import { createInMemoryDepartmentRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createDepartment, updateDepartment } from "./create-department.js";
import { InvalidDepartmentError } from "./errors.js";

describe("createDepartment", () => {
  it("creates a department with defaults", async () => {
    const repo = createInMemoryDepartmentRepository();
    const dept = await createDepartment({ id: "dept-1", code: "SALES", name: "Sales" }, repo);
    expect(dept).toMatchObject({
      id: "dept-1",
      code: "SALES",
      name: "Sales",
      nameAr: null,
      parentDepartmentId: null,
      managerId: null,
      overtimeEligible: true,
      standardWorkHours: null,
      active: true,
    });
    expect(await repo.findById("dept-1")).toEqual(dept);
  });

  it("rejects an empty code or name", async () => {
    const repo = createInMemoryDepartmentRepository();
    await expect(createDepartment({ id: "d1", code: "", name: "X" }, repo)).rejects.toThrow(InvalidDepartmentError);
    await expect(createDepartment({ id: "d2", code: "X", name: "" }, repo)).rejects.toThrow(InvalidDepartmentError);
  });

  it("rejects a duplicate code", async () => {
    const repo = createInMemoryDepartmentRepository();
    await createDepartment({ id: "d1", code: "SALES", name: "Sales" }, repo);
    await expect(createDepartment({ id: "d2", code: "SALES", name: "Sales 2" }, repo)).rejects.toThrow(InvalidDepartmentError);
  });

  it("rejects a department being its own parent", async () => {
    const repo = createInMemoryDepartmentRepository();
    await expect(createDepartment({ id: "d1", code: "SALES", name: "Sales", parentDepartmentId: "d1" }, repo)).rejects.toThrow(
      InvalidDepartmentError,
    );
  });
});

describe("updateDepartment", () => {
  it("applies a patch and re-validates", async () => {
    const repo = createInMemoryDepartmentRepository();
    const dept = await createDepartment({ id: "d1", code: "SALES", name: "Sales" }, repo);
    const updated = updateDepartment(dept, { name: "المبيعات", managerId: "emp-1", active: false });
    expect(updated.name).toBe("المبيعات");
    expect(updated.managerId).toBe("emp-1");
    expect(updated.active).toBe(false);
    expect(updated.code).toBe("SALES");
  });

  it("rejects an empty name on update", async () => {
    const repo = createInMemoryDepartmentRepository();
    const dept = await createDepartment({ id: "d1", code: "SALES", name: "Sales" }, repo);
    expect(() => updateDepartment(dept, { name: "" })).toThrow(InvalidDepartmentError);
  });
});
