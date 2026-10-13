import { describe, expect, it } from "vitest";
import { SodConflictId, detectSodConflicts } from "./sod.js";

describe("who records cash does not reconcile the bank", () => {
  it.each([
    ["treasury.reconciliation.match", ["treasury.reconciliation.match"]],
    ["treasury.reconciliation.post_entry", ["treasury.reconciliation.match", "treasury.reconciliation.post_entry"]],
  ])("flags a role that writes cash vouchers and holds %s", (reconciling, reconcilingRights) => {
    const conflicts = detectSodConflicts(["treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.reconciliation.view", reconciling]);
    expect(conflicts.map((conflict) => conflict.ruleId)).toEqual([SodConflictId.VoucherCreateBankReconcile]);
    expect(conflicts[0]?.matchedA).toEqual(["treasury.cash_voucher.create"]);
    expect(conflicts[0]?.matchedB).toEqual(reconcilingRights);
  });

  it("leaves a cashier who only reads and imports the statement, and an accountant who only reconciles", () => {
    expect(detectSodConflicts(["treasury.cash_voucher.create", "treasury.reconciliation.view", "treasury.reconciliation.import"])).toEqual([]);
    expect(detectSodConflicts(["treasury.cash_voucher.view", "treasury.reconciliation.match", "treasury.reconciliation.post_entry"])).toEqual([]);
  });
});
