import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { AccountDTO } from "@mezan/contracts";
import { buildAccountTree, hasChildAccounts, isDescendantOf } from "./account-tree";

function account(id: string, code: string, parentId: string | null): AccountDTO {
  return { id, code, parentId } as AccountDTO;
}

const flat = [
  account("a-1", "1000", null),
  account("a-11", "1100", "a-1"),
  account("a-12", "1200", "a-1"),
  account("a-111", "1110", "a-11"),
  account("a-2", "2000", null),
];

describe("buildAccountTree", () => {
  it("nests children under their parent", () => {
    const tree = buildAccountTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["a-1", "a-2"]);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["a-11", "a-12"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(["a-111"]);
  });

  it("sorts siblings by code, not by insertion order", () => {
    const shuffled = [account("b", "2000", null), account("a", "1000", null), account("c", "1500", null)];
    expect(buildAccountTree(shuffled).map((n) => n.code)).toEqual(["1000", "1500", "2000"]);
  });

  it("promotes an account whose parent is not in the list to the root", () => {
    const orphan = [account("x", "9000", "missing-parent")];
    expect(buildAccountTree(orphan).map((n) => n.id)).toEqual(["x"]);
  });

  it("renders an empty chart as an empty tree, not a crash", () => {
    expect(buildAccountTree([])).toEqual([]);
  });

  it("keeps every account exactly once", () => {
    const seen: string[] = [];
    const walk = (nodes: readonly { id: string; children: readonly never[] }[]) => {
      for (const node of nodes) {
        seen.push(node.id);
        walk(node.children as never[]);
      }
    };
    walk(buildAccountTree(flat) as never[]);
    expect(seen.sort()).toEqual(flat.map((a) => a.id).sort());
  });
});

describe("hasChildAccounts", () => {
  it("is true for a parent and false for a leaf", () => {
    expect(hasChildAccounts(flat, "a-1")).toBe(true);
    expect(hasChildAccounts(flat, "a-111")).toBe(false);
    expect(hasChildAccounts(flat, "a-2")).toBe(false);
  });

  it("is false for an id that is not in the chart", () => {
    expect(hasChildAccounts(flat, "nope")).toBe(false);
  });
});

describe("isDescendantOf", () => {
  it("walks up through every generation", () => {
    expect(isDescendantOf(flat, "a-111", "a-11")).toBe(true);
    expect(isDescendantOf(flat, "a-111", "a-1")).toBe(true);
    expect(isDescendantOf(flat, "a-11", "a-2")).toBe(false);
  });

  it("is false for an account and itself, which is what a re-parent check needs", () => {
    expect(isDescendantOf(flat, "a-1", "a-1")).toBe(false);
  });

  it("terminates on a cycle instead of hanging the screen", () => {
    const cyclic = [account("x", "1", "y"), account("y", "2", "x")];
    expect(isDescendantOf(cyclic, "x", "unrelated")).toBe(false);
  });
});

describe("account tree — fuzz", () => {
  const treeArb = fc.integer({ min: 1, max: 40 }).chain((size) =>
    fc
      .tuple(...Array.from({ length: size }, (_, i) => fc.integer({ min: -1, max: i - 1 })))
      .map((parents) =>
        parents.map((parentIndex, i) =>
          account(`a-${i}`, String(1000 + i), parentIndex >= 0 ? `a-${parentIndex}` : null),
        ),
      ),
  );

  it("fuzz: every account appears exactly once, however deep the chart", () => {
    fc.assert(
      fc.property(treeArb, (accounts) => {
        const seen: string[] = [];
        const walk = (nodes: readonly { id: string; children: readonly unknown[] }[]) => {
          for (const node of nodes) {
            seen.push(node.id);
            walk(node.children as { id: string; children: readonly unknown[] }[]);
          }
        };
        walk(buildAccountTree(accounts) as never);
        expect(seen.sort()).toEqual(accounts.map((a) => a.id).sort());
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a child is always a descendant of its parent, and never the other way round", () => {
    fc.assert(
      fc.property(treeArb, (accounts) => {
        for (const child of accounts) {
          if (!child.parentId) continue;
          expect(isDescendantOf(accounts, child.id, child.parentId)).toBe(true);
          expect(isDescendantOf(accounts, child.parentId, child.id)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: siblings are ordered by code at every level", () => {
    fc.assert(
      fc.property(treeArb, (accounts) => {
        const check = (nodes: readonly { code: string; children: readonly unknown[] }[]) => {
          const codes = nodes.map((n) => n.code);
          expect([...codes].sort((a, b) => a.localeCompare(b))).toEqual(codes);
          for (const node of nodes) check(node.children as { code: string; children: readonly unknown[] }[]);
        };
        check(buildAccountTree(accounts) as never);
      }),
      { numRuns: 300 },
    );
  });
});
