import { describe, it, expect } from "vitest";
import { createBranch, updateBranch } from "@mezan/domain";
import { createSqliteBranchStore } from "./branch-store.js";

describe("SqliteBranchStore", () => {
  it("returns an empty list and null for an unknown id before any saves", async () => {
    const store = createSqliteBranchStore();
    try {
      expect(await store.findAll()).toEqual([]);
      expect(await store.findById("missing")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("round-trips a saved branch including nullable fields", async () => {
    const store = createSqliteBranchStore();
    try {
      const branch = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي", isMain: true });
      await store.save(branch);
      expect(await store.findById("b1")).toEqual(branch);
    } finally {
      store.close();
    }
  });

  it("lists branches ordered by code and supports a sub-branch parent link", async () => {
    const store = createSqliteBranchStore();
    try {
      const main = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي", isMain: true });
      const sub = createBranch({ id: "b2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "b1" });
      await store.save(main);
      await store.save(sub);
      const all = await store.findAll();
      expect(all.map((b) => b.code)).toEqual(["ALEX", "MAIN"]);
      expect(all.find((b) => b.code === "ALEX")?.parentBranchId).toBe("b1");
    } finally {
      store.close();
    }
  });

  it("upserts on save (same id updates in place)", async () => {
    const store = createSqliteBranchStore();
    try {
      const branch = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" });
      await store.save(branch);
      await store.save(updateBranch(branch, { active: false, phone: "0100000000" }));
      const all = await store.findAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.active).toBe(false);
      expect(all[0]?.phone).toBe("0100000000");
    } finally {
      store.close();
    }
  });
});
