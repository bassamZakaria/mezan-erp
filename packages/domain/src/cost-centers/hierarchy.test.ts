import { describe, it, expect } from "vitest";
import type { CostCenter } from "./cost-center.js";
import { buildCostCenterTree, flattenCostCenterTree, isDescendantOf } from "./hierarchy.js";

function cc(id: string, code: string, parentId: string | null): CostCenter {
  return {
    id,
    code,
    nameAr: code,
    nameEn: null,
    type: "general",
    departmentId: null,
    branchId: null,
    parentId,
    notes: null,
    status: "active",
  };
}

describe("buildCostCenterTree / flattenCostCenterTree", () => {
  it("nests children under their parent, sorted by code", () => {
    const flat = [cc("b", "CC-002", "root"), cc("root", "CC-001", null), cc("a", "CC-003", "root")];
    const tree = buildCostCenterTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe("root");
    expect(tree[0]?.children.map((c) => c.id)).toEqual(["b", "a"]); // CC-002 < CC-003
  });

  it("treats an orphaned parentId as a root instead of dropping the row", () => {
    const flat = [cc("x", "CC-009", "does-not-exist")];
    const tree = buildCostCenterTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });

  it("flattens depth-first with correct level and hasChildren", () => {
    const flat = [cc("root", "CC-001", null), cc("child", "CC-002", "root")];
    const rows = flattenCostCenterTree(buildCostCenterTree(flat));
    expect(rows).toEqual([
      expect.objectContaining({ id: "root", level: 0, hasChildren: true }),
      expect.objectContaining({ id: "child", level: 1, hasChildren: false }),
    ]);
  });
});

describe("isDescendantOf", () => {
  it("detects a direct ancestor", () => {
    const flat = [cc("root", "CC-001", null), cc("child", "CC-002", "root")];
    expect(isDescendantOf(flat, "child", "root")).toBe(true);
    expect(isDescendantOf(flat, "root", "child")).toBe(false);
  });

  it("detects a multi-level ancestor", () => {
    const flat = [cc("a", "CC-001", null), cc("b", "CC-002", "a"), cc("c", "CC-003", "b")];
    expect(isDescendantOf(flat, "c", "a")).toBe(true);
  });

  it("does not loop forever on a pre-existing corrupt cycle", () => {
    const flat = [cc("a", "CC-001", "b"), cc("b", "CC-002", "a")];
    expect(isDescendantOf(flat, "a", "does-not-exist")).toBe(false);
  });
});
