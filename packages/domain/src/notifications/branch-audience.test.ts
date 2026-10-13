import { describe, expect, it } from "vitest";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import { branchGrantCoversEvent, eventBranchIdsOf } from "./branch-audience.js";

describe("who an event may be told to", () => {
  it("an unrestricted recipient is told of any branch's event and of a company-level one", () => {
    expect(branchGrantCoversEvent(ALL_SCOPE, false, ["BR-A"])).toBe(true);
    expect(branchGrantCoversEvent(ALL_SCOPE, false, [])).toBe(true);
  });

  it("a restricted recipient is told only when every branch of the document is within the grant", () => {
    expect(branchGrantCoversEvent(["BR-A"], true, ["BR-A"])).toBe(true);
    expect(branchGrantCoversEvent(["BR-A"], true, ["BR-B"])).toBe(false);
    expect(branchGrantCoversEvent(["BR-A"], true, ["BR-A", "BR-B"])).toBe(false);
    expect(branchGrantCoversEvent(["BR-A", "BR-B"], false, ["BR-A", "BR-B"])).toBe(true);
  });

  it("a company-level event reaches a restricted recipient only with the company-level permission", () => {
    expect(branchGrantCoversEvent(["BR-A"], false, [])).toBe(false);
    expect(branchGrantCoversEvent(["BR-A"], true, [])).toBe(true);
  });

  it("an event that states no branches, or states them badly, is read as company-level", () => {
    expect(eventBranchIdsOf({ documentNumber: "INV-1" })).toEqual([]);
    expect(eventBranchIdsOf({ branchIds: "BR-A" })).toEqual([]);
    expect(eventBranchIdsOf({ branchIds: ["BR-A", "", 7, null] })).toEqual(["BR-A"]);
    expect(eventBranchIdsOf(null)).toEqual([]);
  });
});
