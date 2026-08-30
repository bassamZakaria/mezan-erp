import { describe, expect, it } from "vitest";
import type { CostCenterDTO } from "@mezan/contracts";
import { buildCostCenterTree, isDescendantOf } from "./cost-center-tree";

function costCenter(id: string, code: string, parentId: string | null): CostCenterDTO {
  return { id, code, parentId } as CostCenterDTO;
}

const flat = [
  costCenter("cc-1", "CC-100", null),
  costCenter("cc-11", "CC-110", "cc-1"),
  costCenter("cc-12", "CC-120", "cc-1"),
  costCenter("cc-111", "CC-111", "cc-11"),
  costCenter("cc-2", "CC-200", null),
];

describe("buildCostCenterTree", () => {
  it("nests children under their parent", () => {
    const tree = buildCostCenterTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["cc-1", "cc-2"]);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["cc-11", "cc-12"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(["cc-111"]);
  });

  it("sorts siblings by code", () => {
    const shuffled = [costCenter("b", "CC-300", null), costCenter("a", "CC-100", null)];
    expect(buildCostCenterTree(shuffled).map((n) => n.code)).toEqual(["CC-100", "CC-300"]);
  });

  it("promotes a cost centre whose parent is missing to the root rather than dropping it", () => {
    expect(buildCostCenterTree([costCenter("x", "CC-900", "gone")]).map((n) => n.id)).toEqual(["x"]);
  });

  it("returns an empty tree for no cost centres", () => {
    expect(buildCostCenterTree([])).toEqual([]);
  });

  it("keeps every cost centre exactly once", () => {
    const seen: string[] = [];
    const walk = (nodes: readonly { id: string; children: readonly unknown[] }[]) => {
      for (const node of nodes) {
        seen.push(node.id);
        walk(node.children as { id: string; children: readonly unknown[] }[]);
      }
    };
    walk(buildCostCenterTree(flat) as never);
    expect(seen.sort()).toEqual(flat.map((c) => c.id).sort());
  });
});

describe("isDescendantOf", () => {
  it("walks up through every generation", () => {
    expect(isDescendantOf(flat, "cc-111", "cc-11")).toBe(true);
    expect(isDescendantOf(flat, "cc-111", "cc-1")).toBe(true);
    expect(isDescendantOf(flat, "cc-11", "cc-2")).toBe(false);
  });

  it("is false for a cost centre and itself, which is what a re-parent check needs", () => {
    expect(isDescendantOf(flat, "cc-1", "cc-1")).toBe(false);
  });

  it("terminates on a cycle instead of hanging the screen", () => {
    const cyclic = [costCenter("x", "1", "y"), costCenter("y", "2", "x")];
    expect(isDescendantOf(cyclic, "x", "unrelated")).toBe(false);
  });

  it("is false for an id that is not in the list", () => {
    expect(isDescendantOf(flat, "missing", "cc-1")).toBe(false);
  });
});
