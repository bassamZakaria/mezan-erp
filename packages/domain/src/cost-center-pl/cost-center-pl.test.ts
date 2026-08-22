import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { CostCenter } from "../cost-centers/cost-center.js";
import type { PostedLine } from "../gl/ledger.js";
import { computeCostCenterPnL } from "./cost-center-pl.js";

function account(id: string, type: Account["type"]): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type,
    naturalBalance: type === "revenue" || type === "liability" || type === "equity" ? "credit" : "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  };
}

function cc(id: string, code: string, nameAr: string): CostCenter {
  return { id, code, nameAr, nameEn: null, type: "general", departmentId: null, branchId: null, parentId: null, notes: null, status: "active" };
}

function line(accountId: string, costCenterId: string | null, debit: string, credit: string): PostedLine {
  return {
    entryId: "e",
    entryNo: null,
    date: "2026-08-10",
    source: "manual",
    accountId,
    costCenterId,
    currency: null,
    fxRate: null,
    memo: null,
    debit: Money.fromMajor(debit),
    credit: Money.fromMajor(credit),
  };
}

const accounts = [account("4000", "revenue"), account("5000", "expense"), account("1000", "asset")];
const costCenters = [cc("cc-a", "CC-A", "قسم أ"), cc("cc-b", "CC-B", "قسم ب")];

describe("computeCostCenterPnL", () => {
  it("groups revenue and expense by cost center and computes profit per center", () => {
    const lines: PostedLine[] = [
      // CC-A: revenue 1000, expense 300 → profit 700
      line("4000", "cc-a", "0", "1000"),
      line("5000", "cc-a", "300", "0"),
      // CC-B: revenue 500, expense 800 → profit -300
      line("4000", "cc-b", "0", "500"),
      line("5000", "cc-b", "800", "0"),
    ];
    const report = computeCostCenterPnL(lines, accounts, costCenters);
    expect(report.rows).toHaveLength(2);
    const a = report.rows.find((r) => r.costCenterId === "cc-a")!;
    expect(a.revenue.toString()).toBe(Money.fromMajor("1000").toString());
    expect(a.expense.toString()).toBe(Money.fromMajor("300").toString());
    expect(a.profit.toString()).toBe(Money.fromMajor("700").toString());
    const b = report.rows.find((r) => r.costCenterId === "cc-b")!;
    expect(b.profit.toString()).toBe(Money.fromMajor("-300").toString());
  });

  it("puts lines with no cost center into an unassigned bucket ordered last", () => {
    const lines: PostedLine[] = [
      line("4000", null, "0", "200"),
      line("4000", "cc-a", "0", "100"),
    ];
    const report = computeCostCenterPnL(lines, accounts, costCenters);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[report.rows.length - 1]!.costCenterId).toBeNull();
    expect(report.rows[report.rows.length - 1]!.name).toBe("غير مخصص");
  });

  it("ignores balance-sheet lines and reconciles totals to net revenue − expense", () => {
    const lines: PostedLine[] = [
      line("4000", "cc-a", "0", "1000"),
      line("1000", "cc-a", "1000", "0"), // asset — must be ignored
      line("5000", "cc-b", "400", "0"),
    ];
    const report = computeCostCenterPnL(lines, accounts, costCenters);
    expect(report.totals.revenue.toString()).toBe(Money.fromMajor("1000").toString());
    expect(report.totals.expense.toString()).toBe(Money.fromMajor("400").toString());
    expect(report.totals.profit.toString()).toBe(Money.fromMajor("600").toString());
  });
});
