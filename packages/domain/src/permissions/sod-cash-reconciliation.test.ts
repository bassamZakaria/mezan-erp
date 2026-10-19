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

describe("who redirects a salary does not export the salary transfer file", () => {
  const editsSalaryAccount = ["hr.employee.view", "hr.employee.edit", "hr.employee.view_salary"];

  it("flags a role that can change an employee's salary account and export the bank file", () => {
    const conflicts = detectSodConflicts([...editsSalaryAccount, "hr.payroll.view", "hr.payroll.bank_file"]);
    expect(conflicts.map((conflict) => conflict.ruleId)).toEqual([SodConflictId.SalaryPaymentEditBankFile]);
    expect(conflicts[0]?.matchedA).toEqual(["hr.employee.edit", "hr.employee.view_salary"]);
    expect(conflicts[0]?.matchedB).toEqual(["hr.payroll.bank_file"]);
  });

  it("needs BOTH halves of the salary-payment route — edit alone or view_salary alone cannot redirect a salary", () => {
    expect(detectSodConflicts(["hr.employee.edit", "hr.payroll.bank_file"])).toEqual([]);
    expect(detectSodConflicts(["hr.employee.view_salary", "hr.payroll.view", "hr.payroll.bank_file"])).toEqual([]);
    expect(detectSodConflicts(editsSalaryAccount)).toEqual([]);
  });
});

describe("who writes the price-floor rules does not approve the sales below them", () => {
  it("flags manage with approve, and neither alone", () => {
    expect(detectSodConflicts(["sales.pricing_guard.manage", "sales.pricing_guard.approve"]).map((conflict) => conflict.ruleId)).toEqual([SodConflictId.PricingGuardManageApprove]);
    expect(detectSodConflicts(["sales.pricing_guard.manage", "workflow.approve"])).toEqual([]);
    expect(detectSodConflicts(["sales.pricing_guard.approve", "workflow.approve"])).toEqual([]);
  });
});
