import { describe, it, expect } from "vitest";
import type { Account } from "./account.js";
import {
  buildAccountTree,
  flattenAccountTree,
  assertPostable,
  isPostable,
  isDescendantOf,
  hasChildren,
} from "./hierarchy.js";
import { HeaderAccountNotPostableError } from "./errors.js";

function account(overrides: Partial<Account> & Pick<Account, "id" | "code">): Account {
  return {
    nameAr: overrides.nameAr ?? overrides.code,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

const sample: Account[] = [
  account({ id: "1000", code: "1000", isHeader: true, parentId: null }),
  account({ id: "1300", code: "1300", isHeader: true, parentId: "1000" }),
  account({ id: "1300-1", code: "1300-1", isHeader: false, parentId: "1300" }),
  account({ id: "1310", code: "1310", isHeader: false, parentId: "1300" }),
  account({ id: "1200", code: "1200", isHeader: false, parentId: "1000" }),
  account({ id: "2000", code: "2000", isHeader: true, parentId: null }),
];

describe("buildAccountTree", () => {
  it("nests accounts by parentId, sorted by code at every level", () => {
    const tree = buildAccountTree(sample);
    expect(tree.map((n) => n.code)).toEqual(["1000", "2000"]);
    const assets = tree[0]!;
    expect(assets.children.map((n) => n.code)).toEqual(["1200", "1300"]);
    const cash = assets.children.find((n) => n.code === "1300")!;
    expect(cash.children.map((n) => n.code)).toEqual(["1300-1", "1310"]);
  });

  it("treats an unresolvable parentId as a root instead of dropping the row", () => {
    const orphan = account({ id: "orphan", code: "9999", parentId: "does-not-exist" });
    const tree = buildAccountTree([...sample, orphan]);
    expect(tree.map((n) => n.code)).toContain("9999");
  });

  it("round-trips through flattenAccountTree with correct levels and hasChildren", () => {
    const tree = buildAccountTree(sample);
    const flat = flattenAccountTree(tree);
    const root = flat.find((r) => r.code === "1000")!;
    expect(root.level).toBe(0);
    expect(root.hasChildren).toBe(true);
    const leaf = flat.find((r) => r.code === "1300-1")!;
    expect(leaf.level).toBe(2);
    expect(leaf.hasChildren).toBe(false);
  });
});

describe("assertPostable / isPostable", () => {
  it("allows posting to a detail account", () => {
    expect(() => assertPostable({ id: "1300-1", isHeader: false })).not.toThrow();
    expect(isPostable({ isHeader: false, status: "active" })).toBe(true);
  });

  it("rejects posting to a header account", () => {
    expect(() => assertPostable({ id: "1300", isHeader: true })).toThrow(HeaderAccountNotPostableError);
    expect(isPostable({ isHeader: true, status: "active" })).toBe(false);
  });

  it("an inactive detail account is not postable", () => {
    expect(isPostable({ isHeader: false, status: "inactive" })).toBe(false);
  });
});

describe("isDescendantOf / hasChildren", () => {
  it("detects an ancestor relationship through multiple hops", () => {
    expect(isDescendantOf(sample, "1300-1", "1000")).toBe(true);
    expect(isDescendantOf(sample, "1300-1", "1300")).toBe(true);
    expect(isDescendantOf(sample, "1300-1", "2000")).toBe(false);
  });

  it("hasChildren reflects whether any row points at the given parent", () => {
    expect(hasChildren(sample, "1300")).toBe(true);
    expect(hasChildren(sample, "1300-1")).toBe(false);
  });
});
