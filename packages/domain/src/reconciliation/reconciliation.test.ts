import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { PostedLine } from "../gl/ledger.js";
import { computeBalanceReconciliation, findUnlinkedControlLines } from "./reconciliation.js";

function line(overrides: Partial<PostedLine>): PostedLine {
  return {
    entryId: "e", entryNo: "JE-000001", date: "2026-08-10", source: "system",
    accountId: "1200", branchId: null, costCenterId: null, projectId: null, costCategory: null, currency: null, fxRate: null, memo: null,
    debit: Money.zero(), credit: Money.zero(), ...overrides,
  };
}

describe("computeBalanceReconciliation", () => {
  it("marks a comparison matched when sub-ledger equals GL, and computes the difference otherwise", () => {
    const summary = computeBalanceReconciliation([
      { key: "inventory", label: "المخزون", controlAccountId: "1200", subLedgerBalance: Money.fromMajor("602425.90"), glBalance: Money.fromMajor("602425.90") },
      { key: "treasury", label: "الخزينة", controlAccountId: "1300", subLedgerBalance: Money.fromMajor("338"), glBalance: Money.fromMajor("300") },
    ]);
    expect(summary.rows[0]!.matched).toBe(true);
    expect(summary.rows[0]!.difference.toString()).toBe(Money.fromMajor("0").toString());
    expect(summary.rows[1]!.matched).toBe(false);
    expect(summary.rows[1]!.difference.toString()).toBe(Money.fromMajor("38").toString());
    expect(summary.allMatched).toBe(false);
  });

  it("reports allMatched when every row reconciles", () => {
    const summary = computeBalanceReconciliation([
      { key: "ar", label: "ذمم مدينة", controlAccountId: "1100", subLedgerBalance: Money.fromMajor("100"), glBalance: Money.fromMajor("100") },
    ]);
    expect(summary.allMatched).toBe(true);
  });
});

describe("findUnlinkedControlLines", () => {
  const controls = new Set(["1200", "1300"]);

  it("flags only manual lines that hit a control account, newest first", () => {
    const lines: PostedLine[] = [
      line({ entryId: "a", accountId: "1200", source: "system", date: "2026-08-01" }), // sub-ledger posting → linked
      line({ entryId: "b", accountId: "1200", source: "manual", date: "2026-08-05", entryNo: "JE-000010", debit: Money.fromMajor("50") }),
      line({ entryId: "c", accountId: "4000", source: "manual", date: "2026-08-06" }), // not a control account
      line({ entryId: "d", accountId: "1300", source: "manual", date: "2026-08-07", entryNo: "JE-000012", credit: Money.fromMajor("70") }),
    ];
    const unlinked = findUnlinkedControlLines(lines, controls);
    expect(unlinked.map((u) => u.entryId)).toEqual(["d", "b"]);
    expect(unlinked[0]!.credit.toString()).toBe(Money.fromMajor("70").toString());
  });

  it("returns nothing when all control-account lines are system-generated", () => {
    const lines: PostedLine[] = [line({ accountId: "1200", source: "system" })];
    expect(findUnlinkedControlLines(lines, controls)).toHaveLength(0);
  });
});
