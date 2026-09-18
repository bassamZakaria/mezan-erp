import { describe, it, expect } from "vitest";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { LATER_STANDARD_ACCOUNT_IDS, STANDARD_COA_TEMPLATE, addMissingStandardAccounts, seedStandardChartOfAccounts } from "./coa-template.js";
import { createAccount } from "./create-account.js";
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

  it("has 6 top-level roots: the catalog's 5 plus 9000 حسابات نظامية, which is off balance sheet and so cannot hang under any of them", () => {
    const roots = STANDARD_COA_TEMPLATE.filter((r) => r.parentId == null);
    expect(roots.map((r) => r.code).sort()).toEqual(["1000", "2000", "3000", "4000", "5000", "9000"]);
    expect(roots.every((r) => r.isHeader)).toBe(true);
    expect(roots.find((r) => r.code === "9000")?.type).toBe("memorandum");
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
    expect(tree.map((n) => n.code)).toEqual(["1000", "2000", "3000", "4000", "5000", "9000"]);
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

describe("addMissingStandardAccounts (D229)", () => {
  async function chartWithout(ids: readonly string[]): Promise<InMemoryAccountRepository> {
    const repo = new InMemoryAccountRepository();
    for (const command of STANDARD_COA_TEMPLATE) {
      if (!ids.includes(command.id)) await createAccount(command, repo);
    }
    return repo;
  }

  it("adds the exchange-difference accounts to a chart seeded before them, under 4000 and 5000", async () => {
    const repo = await chartWithout(LATER_STANDARD_ACCOUNT_IDS);
    expect(await addMissingStandardAccounts(repo)).toEqual({ added: ["4920", "4940", "5920", "5940"], skipped: [] });
    expect(await repo.findById("4920")).toMatchObject({ nameAr: "أرباح فروق العملة المحققة", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false });
    expect(await repo.findById("5920")).toMatchObject({ nameAr: "خسائر فروق العملة المحققة", type: "expense", naturalBalance: "debit", parentId: "5000" });
    expect(await repo.findById("4940")).toMatchObject({ type: "revenue", parentId: "4000" });
    expect(await repo.findById("5940")).toMatchObject({ type: "expense", parentId: "5000" });
    expect(await repo.list()).toHaveLength(STANDARD_COA_TEMPLATE.length);
  });

  it("is idempotent and leaves 4900/5900 exactly as they were", async () => {
    const repo = await chartWithout(LATER_STANDARD_ACCOUNT_IDS);
    await addMissingStandardAccounts(repo);
    const before = await repo.list();
    expect(await addMissingStandardAccounts(repo)).toEqual({ added: [], skipped: [] });
    expect(await repo.list()).toEqual(before);
    expect(await repo.findById("4900")).toMatchObject({ nameAr: "فائض الصندوق", type: "revenue" });
    expect(await repo.findById("5900")).toMatchObject({ nameAr: "عجز الصندوق", type: "expense" });
  });

  it("does nothing to a freshly seeded chart", async () => {
    const repo = new InMemoryAccountRepository();
    await seedStandardChartOfAccounts(repo);
    expect(await addMissingStandardAccounts(repo)).toEqual({ added: [], skipped: [] });
  });

  it("skips an id the tenant already uses for another kind of account instead of overwriting it", async () => {
    const repo = await chartWithout(LATER_STANDARD_ACCOUNT_IDS);
    await createAccount({ id: "4920", code: "4920", nameAr: "حساب العميل", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false }, repo);
    expect(await addMissingStandardAccounts(repo)).toEqual({ added: ["4940", "5920", "5940"], skipped: ["4920"] });
    expect(await repo.findById("4920")).toMatchObject({ nameAr: "حساب العميل", type: "asset" });
  });
});
