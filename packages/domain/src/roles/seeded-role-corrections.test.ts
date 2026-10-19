import { describe, expect, it } from "vitest";
import { detectSodConflicts } from "../permissions/sod.js";
import { correctedSeededRolePermissions, SEEDED_ROLE_CODES, SeededRoleCode, SeededRoleSplit, seededRoleDutyChange, seededRoleDutyNotice } from "./seeded-role-corrections.js";

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

  it("the storekeeper who held only the reading of goods receipts gains what receiving goods takes, and nothing is taken from him", () => {
    const stored = ["inventory.stock.view", "inventory.transfer.view", "inventory.transfer.create", "inventory.count.view", "inventory.count.create", "inventory.item.view", "purchases.receipt.view", "dashboard.view"];

    const corrected = correctedSeededRolePermissions(SeededRoleCode.WarehouseKeeper, stored, undefined, SeededRoleSplit.GoodsReceiving);

    expect(corrected).toEqual([...stored, "purchases.receipt.create", "purchases.receipt.confirm", "purchases.supplier.view", "purchases.order.view"]);
    expect(correctedSeededRolePermissions(SeededRoleCode.WarehouseKeeper, corrected!, undefined, SeededRoleSplit.GoodsReceiving)).toBeNull();
    expect(seededRoleDutyChange({ code: SeededRoleCode.WarehouseKeeper, name: "أمين مخزن", permissions: stored }, undefined, SeededRoleSplit.GoodsReceiving)?.revoked).toEqual([]);
    expect(correctedSeededRolePermissions(SeededRoleCode.SalesRep, stored, undefined, SeededRoleSplit.GoodsReceiving)).toBeNull();
  });

  it("the notice of a grant says a role was completed, and does not call it a separation of duties", () => {
    const change = seededRoleDutyChange({ code: SeededRoleCode.WarehouseKeeper, name: "أمين مخزن", permissions: ["purchases.receipt.view"] }, undefined, SeededRoleSplit.GoodsReceiving)!;

    const grant = seededRoleDutyNotice([change], SeededRoleSplit.GoodsReceiving);
    const separation = seededRoleDutyNotice([change], SeededRoleSplit.Duties);

    expect(grant.title).not.toContain("بين المهام");
    expect(grant.body).not.toContain("بين المهام");
    expect(grant.title).toContain("استكمل");
    expect(grant.body).toContain("purchases.receipt.create");
    expect(separation.title).toContain("بين المهام");
  });

  it("moves price-floor rule writing from the branch manager to the finance manager, and leaves the branch manager approving", () => {
    const oldBranch = ["sales.invoice.view", "sales.pricing_guard.view", "sales.pricing_guard.manage", "workflow.view", "workflow.approve", "workflow.reject"];
    const oldFinance = ["sales.invoice.view", "sales.pricing_guard.view", "workflow.approve"];

    const branch = correctedSeededRolePermissions(SeededRoleCode.BranchManager, oldBranch, undefined, SeededRoleSplit.PriceFloor);
    const finance = correctedSeededRolePermissions(SeededRoleCode.FinanceManager, oldFinance, undefined, SeededRoleSplit.PriceFloor);

    expect(branch).toEqual(["sales.invoice.view", "sales.pricing_guard.view", "workflow.view", "workflow.approve", "workflow.reject", "sales.pricing_guard.approve"]);
    expect(finance).toEqual([...oldFinance, "sales.pricing_guard.manage"]);
    expect(detectSodConflicts([...branch!, "sales.pricing_guard.manage"]).map((match) => match.ruleId)).toEqual(["pricing_guard_manage_approve"]);
    expect(detectSodConflicts(branch!)).toEqual([]);
    expect(detectSodConflicts(finance!)).toEqual([]);
  });

  it("the price-floor move touches no role that never held the price-floor screen", () => {
    expect(correctedSeededRolePermissions(SeededRoleCode.BranchManager, OLD_MANAGER, undefined, SeededRoleSplit.PriceFloor)).toBeNull();
    expect(correctedSeededRolePermissions(SeededRoleCode.FinanceManager, OLD_FINANCE, undefined, SeededRoleSplit.PriceFloor)).toBeNull();
  });
});
