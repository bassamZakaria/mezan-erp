import { describe, expect, it } from "vitest";
import { detectSodConflicts } from "../permissions/sod.js";
import { correctedSeededRolePermissions, SEEDED_ROLE_CODES } from "./seeded-role-corrections.js";

const OLD_CASHIER = ["treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "cheques.view"];
const OLD_MANAGER = ["sales.invoice.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "hr.leave.approve"];
const OLD_FINANCE = ["accounting.journal.view", "accounting.journal.post", "accounting.period.view", "accounting.period.close", "treasury.reconciliation.finalize", "treasury.reconciliation.post_entry"];
const OLD_HR = ["hr.leave.view", "hr.leave.create", "hr.leave.approve"];

describe("seeded role corrections", () => {
  it("the cashier keeps create and loses confirm; the branch manager keeps confirm and loses create", () => {
    const cashier = correctedSeededRolePermissions("TREASURY_CASHIER", OLD_CASHIER)!;
    const manager = correctedSeededRolePermissions("BRANCH_MANAGER", OLD_MANAGER)!;
    expect(cashier).toContain("treasury.cash_voucher.create");
    expect(cashier).not.toContain("treasury.cash_voucher.confirm");
    expect(manager).toContain("treasury.cash_voucher.confirm");
    expect(manager).not.toContain("treasury.cash_voucher.create");
  });

  it.each([
    ["TREASURY_CASHIER", OLD_CASHIER],
    ["BRANCH_MANAGER", OLD_MANAGER],
    ["FINANCE_MANAGER", OLD_FINANCE],
    ["HR_OFFICER", OLD_HR],
  ] as const)("%s in its old shape trips a conflict before and none after", (code, old) => {
    expect(detectSodConflicts(old).length).toBeGreaterThan(0);
    expect(detectSodConflicts(correctedSeededRolePermissions(code, old)!)).toEqual([]);
  });

  it("removes only the conflicting codes and adds dashboard.view — every other grant stays, in order", () => {
    expect(correctedSeededRolePermissions("TREASURY_CASHIER", OLD_CASHIER)).toEqual([
      "treasury.account.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.create",
      "cheques.view",
      "dashboard.view",
    ]);
  });

  it("the accountant gains the posting the finance manager gave up", () => {
    expect(correctedSeededRolePermissions("ACCOUNTANT", ["accounting.journal.view", "accounting.journal.create"])).toEqual([
      "accounting.journal.view",
      "accounting.journal.create",
      "accounting.journal.post",
      "dashboard.view",
    ]);
    expect(correctedSeededRolePermissions("FINANCE_MANAGER", OLD_FINANCE)).not.toContain("accounting.journal.post");
  });

  it("every seeded role gains dashboard.view once", () => {
    for (const code of SEEDED_ROLE_CODES) {
      const once = correctedSeededRolePermissions(code, ["sales.invoice.view"])!;
      expect(once.filter((permission) => permission === "dashboard.view")).toHaveLength(1);
      expect(correctedSeededRolePermissions(code, once)).toBeNull();
    }
  });

  it("a custom role is never touched, whatever it holds", () => {
    expect(correctedSeededRolePermissions("MY_CASHIER", OLD_CASHIER)).toBeNull();
    expect(correctedSeededRolePermissions("treasury_cashier", OLD_CASHIER)).toBeNull();
  });

  it("the wildcard administrator is never touched", () => {
    expect(correctedSeededRolePermissions("SYSTEM_ADMIN", ["*"])).toBeNull();
    expect(correctedSeededRolePermissions("TREASURY_CASHIER", ["*"])).toBeNull();
  });

  it("a right that succeeded a revoked one leaves with it, and one that succeeds a granted right arrives with it", () => {
    const successors = new Map([
      ["accounting.journal.post", ["accounting.revaluation.reverse"]],
      ["accounting.period.reopen", ["accounting.year_end_close.reverse"]],
    ]);
    const finance = correctedSeededRolePermissions("FINANCE_MANAGER", [...OLD_FINANCE, "accounting.period.reopen", "accounting.revaluation.reverse", "accounting.year_end_close.reverse"], successors)!;
    expect(finance).not.toContain("accounting.revaluation.reverse");
    expect(finance).toContain("accounting.year_end_close.reverse");
    expect(detectSodConflicts(finance)).toEqual([]);
    expect(correctedSeededRolePermissions("ACCOUNTANT", ["accounting.journal.view", "accounting.journal.create"], successors)).toContain("accounting.revaluation.reverse");
  });
});
