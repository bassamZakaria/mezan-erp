import { describe, expect, it } from "vitest";
import type { BranchDTO } from "@mezan/contracts";
import { branchName } from "./branch-name";

const branches: BranchDTO[] = [
  { id: "B1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "B2", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: "B1", phone: null, email: null, address: null, isMain: false, active: true },
];

describe("branchName", () => {
  it("resolves a known branch id to its real name", () => {
    expect(branchName("B2", branches)).toBe("فرع الإسكندرية");
  });

  it("falls back to the raw id when no branch matches", () => {
    expect(branchName("B-UNKNOWN", branches)).toBe("B-UNKNOWN");
  });

  it("falls back to the raw id for an empty branches list", () => {
    expect(branchName("B1", [])).toBe("B1");
  });
});
