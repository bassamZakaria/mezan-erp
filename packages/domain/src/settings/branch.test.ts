import { describe, expect, it } from "vitest";
import { createBranch, updateBranch, InvalidBranchError } from "./branch.js";

describe("createBranch", () => {
  it("creates a main branch with defaults applied", () => {
    const branch = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي", isMain: true });
    expect(branch).toMatchObject({
      id: "b1",
      code: "MAIN",
      name: "الفرع الرئيسي",
      parentBranchId: null,
      isMain: true,
      active: true,
    });
  });

  it("rejects an empty name", () => {
    expect(() => createBranch({ id: "b1", code: "MAIN", name: "" })).toThrow(InvalidBranchError);
  });

  it("rejects a lowercase or overly long code", () => {
    expect(() => createBranch({ id: "b1", code: "main", name: "x" })).toThrow(InvalidBranchError);
    expect(() => createBranch({ id: "b1", code: "A".repeat(21), name: "x" })).toThrow(InvalidBranchError);
  });

  it("rejects a branch that parents itself", () => {
    expect(() => createBranch({ id: "b1", code: "SUB", name: "فرع فرعي", parentBranchId: "b1" })).toThrow(
      InvalidBranchError,
    );
  });
});

describe("updateBranch", () => {
  it("applies a patch and re-validates", () => {
    const branch = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" });
    const updated = updateBranch(branch, { active: false, phone: "0100000000" });
    expect(updated.active).toBe(false);
    expect(updated.phone).toBe("0100000000");
    expect(updated.id).toBe("b1");
  });

  it("rejects an invalid patch", () => {
    const branch = createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" });
    expect(() => updateBranch(branch, { name: "" })).toThrow(InvalidBranchError);
  });
});
