import { describe, expect, it } from "vitest";
import { SodConflictId, detectSodConflicts } from "./sod.js";

const tripped = (granted: readonly string[]) => detectSodConflicts(granted).map((match) => match.ruleId);

describe("a reversal permission conflicts with making the document, as the permission it replaced did", () => {
  it.each([
    [SodConflictId.StockAdjustmentCreateApprove, ["inventory.adjustment.create", "inventory.adjustment.reverse"]],
    [SodConflictId.HrAdvanceCreateApprove, ["hr.advance.create", "hr.advance.reverse"]],
    [SodConflictId.JournalPostPeriodReopen, ["accounting.journal.post", "accounting.year_end_close.reverse"]],
    [SodConflictId.JournalPostPeriodClose, ["accounting.revaluation.reverse", "accounting.period.close"]],
    [SodConflictId.AdminVsPosting, ["admin.roles.manage", "inventory.adjustment.reverse"]],
    [SodConflictId.AdminVsPosting, ["admin.roles.manage", "accounting.revaluation.reverse"]],
    [SodConflictId.AdminVsPosting, ["admin.users.create", "contracting.consumption.reverse"]],
  ])("%s is tripped by %j", (rule, granted) => {
    expect(tripped(granted)).toContain(rule);
  });

  it("holding a reversal permission alone trips nothing", () => {
    for (const code of ["inventory.adjustment.reverse", "hr.advance.reverse", "accounting.year_end_close.reverse", "accounting.revaluation.reverse", "cheques.reverse"]) {
      expect(tripped([code])).toEqual([]);
    }
  });
});
