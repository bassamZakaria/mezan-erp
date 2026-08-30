import { describe, it, expect } from "vitest";
import { createInMemoryDepartmentRepository } from "../hr/test-helpers/in-memory-hr-repositories.js";
import { createDepartment } from "../hr/create-department.js";
import { InMemoryCostCenterRepository } from "./test-helpers/in-memory-cost-center-repository.js";
import { createCostCenter } from "./create-cost-center.js";
import {
  costCenterCodeForDepartment,
  importableDepartments,
  createCostCentersFromDepartments,
} from "./from-departments.js";
import { DuplicateCostCenterCodeError, InvalidParentCostCenterError } from "./errors.js";

describe("costCenterCodeForDepartment", () => {
  it("prefixes with CC- and upper-cases the department code", () => {
    expect(costCenterCodeForDepartment({ code: "sales" })).toBe("CC-SALES");
  });

  it("trims surrounding whitespace before prefixing", () => {
    expect(costCenterCodeForDepartment({ code: "  ops " })).toBe("CC-OPS");
  });
});

async function seedDepartments() {
  const departments = createInMemoryDepartmentRepository();
  const sales = await createDepartment({ id: "dep-sales", code: "SALES", name: "Sales", nameAr: "المبيعات" }, departments);
  const ops = await createDepartment({ id: "dep-ops", code: "OPS", name: "Ops", nameAr: "العمليات" }, departments);
  const inactiveDept = await createDepartment({ id: "dep-old", code: "OLD", name: "Old" }, departments);
  await departments.update({ ...inactiveDept, active: false });
  return { departments, sales, ops, inactiveDept: { ...inactiveDept, active: false } };
}

describe("importableDepartments", () => {
  it("lists every active department with no cost centre yet, sorted by code", async () => {
    const { sales, ops, inactiveDept } = await seedDepartments();
    const result = importableDepartments([sales, ops, inactiveDept], []);
    expect(result.map((r) => r.id)).toEqual(["dep-ops", "dep-sales"]);
    expect(result[0]).toMatchObject({ code: "OPS", suggestedCode: "CC-OPS", codeInUse: false });
  });

  it("excludes an inactive department", async () => {
    const { sales, inactiveDept } = await seedDepartments();
    const result = importableDepartments([sales, inactiveDept], []);
    expect(result.map((r) => r.id)).toEqual(["dep-sales"]);
  });

  it("excludes a department already linked to a cost centre", async () => {
    const { sales, ops } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await createCostCenter(
      { id: "cc-sales", code: "CC-SALES", nameAr: "المبيعات", type: "department", departmentId: "dep-sales" },
      costCenters,
    );
    const result = importableDepartments([sales, ops], await costCenters.list());
    expect(result.map((r) => r.id)).toEqual(["dep-ops"]);
  });

  it("flags codeInUse when the suggested code collides with an unrelated cost centre", async () => {
    const { sales } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc-x", code: "CC-SALES", nameAr: "غير مرتبط" }, costCenters);
    const result = importableDepartments([sales], await costCenters.list());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "dep-sales", codeInUse: true });
  });

  it("returns an empty list when there is nothing importable", () => {
    expect(importableDepartments([], [])).toEqual([]);
  });
});

describe("createCostCentersFromDepartments", () => {
  it("creates one department-type cost centre per active department when no ids are given", async () => {
    const { departments, sales, ops } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    const result = await createCostCentersFromDepartments(
      { idFor: (d) => `cc-${d.id}` },
      { departments, costCenters },
    );

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    const salesCc = await costCenters.findById(`cc-${sales.id}`);
    expect(salesCc).toMatchObject({
      code: "CC-SALES",
      type: "department",
      departmentId: "dep-sales",
      nameAr: "المبيعات",
      status: "active",
    });
    const opsCc = await costCenters.findById(`cc-${ops.id}`);
    expect(opsCc?.departmentId).toBe("dep-ops");
  });

  it("imports only the requested department ids", async () => {
    const { departments } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    const result = await createCostCentersFromDepartments(
      { departmentIds: ["dep-sales"], idFor: (d) => `cc-${d.id}` },
      { departments, costCenters },
    );
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.departmentId).toBe("dep-sales");
  });

  it("skips a department that already has a cost centre instead of duplicating it", async () => {
    const { departments, sales } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await createCostCenter(
      { id: "cc-existing", code: "CC-SALES", nameAr: "المبيعات", type: "department", departmentId: sales.id },
      costCenters,
    );
    const result = await createCostCentersFromDepartments(
      { idFor: (d) => `cc-${d.id}` },
      { departments, costCenters },
    );
    expect(result.skipped).toEqual(["dep-sales"]);
    expect(result.created.map((c) => c.departmentId)).toEqual(["dep-ops"]);
  });

  it("running the import twice does not double the tree", async () => {
    const { departments } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    const first = await createCostCentersFromDepartments({ idFor: (d) => `cc-${d.id}` }, { departments, costCenters });
    expect(first.created).toHaveLength(2);

    const second = await createCostCentersFromDepartments({ idFor: (d) => `cc2-${d.id}` }, { departments, costCenters });
    expect(second.created).toEqual([]);
    expect([...second.skipped].sort()).toEqual(["dep-ops", "dep-sales"]);
    expect(await costCenters.list()).toHaveLength(2);
  });

  it("throws a duplicate-code error when an unrelated cost centre already owns the suggested code", async () => {
    const { departments, sales } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc-clash", code: "CC-SALES", nameAr: "تضارب" }, costCenters);
    await expect(
      createCostCentersFromDepartments(
        { departmentIds: [sales.id], idFor: (d) => `cc-${d.id}` },
        { departments, costCenters },
      ),
    ).rejects.toBeInstanceOf(DuplicateCostCenterCodeError);
  });

  it("throws when the requested parent cost centre does not exist", async () => {
    const { departments } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await expect(
      createCostCentersFromDepartments(
        { parentId: "does-not-exist", idFor: (d) => `cc-${d.id}` },
        { departments, costCenters },
      ),
    ).rejects.toBeInstanceOf(InvalidParentCostCenterError);
  });

  it("nests every created cost centre under the given parent", async () => {
    const { departments } = await seedDepartments();
    const costCenters = new InMemoryCostCenterRepository();
    await createCostCenter({ id: "cc-root", code: "CC-ROOT", nameAr: "جذر" }, costCenters);
    const result = await createCostCentersFromDepartments(
      { parentId: "cc-root", idFor: (d) => `cc-${d.id}` },
      { departments, costCenters },
    );
    expect(result.created.every((c) => c.parentId === "cc-root")).toBe(true);
  });
});
