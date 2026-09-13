import { describe, it, expect } from "vitest";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { STANDARD_COA_TEMPLATE, seedStandardChartOfAccounts } from "./coa-template.js";
import { buildAccountTree } from "./hierarchy.js";

describe("STANDARD_COA_TEMPLATE", () => {
  it("has unique codes and lists every parent before its children", () => {
    const seenIds = new Set<string>();
    for (const row of STANDARD_COA_TEMPLATE) {
      if (row.parentId !== null && row.parentId !== undefined) {
        expect(seenIds.has(row.parentId)).toBe(true);
      }
      expect(seenIds.has(row.id)).toBe(false);
      seenIds.add(row.id);
    }
  });

  it("has exactly the 5 top-level roots documented in the catalog (1000/2000/3000/4000/5000)", () => {
    const roots = STANDARD_COA_TEMPLATE.filter((r) => r.parentId == null);
    expect(roots.map((r) => r.code).sort()).toEqual(["1000", "2000", "3000", "4000", "5000"]);
    expect(roots.every((r) => r.isHeader)).toBe(true);
  });
});

describe("seedStandardChartOfAccounts", () => {
  it("inserts the whole template through the normal createAccount validation", async () => {
    const repo = new InMemoryAccountRepository();
    await seedStandardChartOfAccounts(repo);
    const all = await repo.list();
    expect(all).toHaveLength(STANDARD_COA_TEMPLATE.length);
  });

  it("produces a tree the UI can render (roots -> headers -> postable leaves)", async () => {
    const repo = new InMemoryAccountRepository();
    await seedStandardChartOfAccounts(repo);
    const tree = buildAccountTree(await repo.list());
    expect(tree.map((n) => n.code)).toEqual(["1000", "2000", "3000", "4000", "5000"]);
    const assets = tree[0]!;
    const cash = assets.children.find((n) => n.code === "1300")!;
    expect(cash.children.map((n) => n.code)).toEqual(["1300-1", "1310", "1315", "1320", "1330", "1340"]);
    // Every leaf (no children) must be postable (isHeader: false).
    function assertLeavesPostable(nodes: readonly (typeof tree)[number][]): void {
      for (const node of nodes) {
        if (node.children.length === 0) expect(node.isHeader).toBe(false);
        else assertLeavesPostable(node.children);
      }
    }
    assertLeavesPostable(tree);
  });
});
