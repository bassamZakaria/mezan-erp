import { describe, it, expect } from "vitest";
import { COST_CENTER_TYPE_DEFINITIONS, getCostCenterTypeLabel, isLinked, type CostCenterType } from "./cost-center.js";

describe("COST_CENTER_TYPE_DEFINITIONS", () => {
  it("defines the four cost-center types with their Arabic labels", () => {
    expect(COST_CENTER_TYPE_DEFINITIONS).toEqual([
      { code: "general", labelAr: "عام" },
      { code: "department", labelAr: "قسم" },
      { code: "project", labelAr: "مشروع" },
      { code: "branch", labelAr: "فرع" },
    ]);
  });
});

describe("getCostCenterTypeLabel", () => {
  it("returns the Arabic label for each known type", () => {
    expect(getCostCenterTypeLabel("general")).toBe("عام");
    expect(getCostCenterTypeLabel("department")).toBe("قسم");
    expect(getCostCenterTypeLabel("project")).toBe("مشروع");
    expect(getCostCenterTypeLabel("branch")).toBe("فرع");
  });

  it("falls back to the raw code for an unknown type", () => {
    expect(getCostCenterTypeLabel("bogus" as CostCenterType)).toBe("bogus");
  });
});

describe("isLinked", () => {
  it("is false when neither departmentId nor branchId is set", () => {
    expect(isLinked({ departmentId: null, branchId: null })).toBe(false);
  });

  it("is true when linked to a department only", () => {
    expect(isLinked({ departmentId: "dep-1", branchId: null })).toBe(true);
  });

  it("is true when linked to a branch only", () => {
    expect(isLinked({ departmentId: null, branchId: "br-1" })).toBe(true);
  });

  it("is true when linked to both", () => {
    expect(isLinked({ departmentId: "dep-1", branchId: "br-1" })).toBe(true);
  });
});
