import { describe, it, expect } from "vitest";
import { assertBalanced } from "../gl/post.js";
import { isLedgerEffective, moneyToNumber, netBalancesByAccount } from "./gl-shared.js";
import {
  INPUT_VAT_ACCOUNT_ID,
  OUTPUT_VAT_ACCOUNT_ID,
  financialStatementAccounts,
  financialStatementEntries,
} from "./financial-fixtures.js";

describe("financialStatementEntries", () => {
  it("every entry is individually balanced, per the real GL posting engine's own check", () => {
    for (const entry of financialStatementEntries) {
      expect(() => assertBalanced(entry.lines)).not.toThrow();
    }
  });

  it("every entry is posted, so every financial-statement report actually picks it up", () => {
    for (const entry of financialStatementEntries) {
      expect(isLedgerEffective(entry)).toBe(true);
    }
  });

  it("every line's accountId resolves to a real account in the fixture chart", () => {
    const ids = new Set(financialStatementAccounts.map((a) => a.id));
    for (const entry of financialStatementEntries) {
      for (const line of entry.lines) {
        expect(ids.has(line.accountId)).toBe(true);
      }
    }
  });

  it("the trial balance nets to zero and totals Σdebit = 452,400 as of year end, as documented", () => {
    const balances = netBalancesByAccount(financialStatementEntries, { to: "2026-12-31" });
    let netSum = 0n;
    let totalPositive = 0;
    for (const money of balances.values()) {
      netSum += money.scaled;
      const value = moneyToNumber(money);
      if (value > 0) totalPositive += value;
    }
    // Exact, in bigint: a fixture that is off by one micro-unit is a broken
    // fixture, and a float comparison would call it balanced.
    expect(netSum).toBe(0n);
    expect(totalPositive).toBe(452400);
  });

  it("has entries dated across more than one calendar month, so period-boundary report tests are meaningful", () => {
    const months = new Set(financialStatementEntries.map((e) => e.date.slice(0, 7)));
    expect(months.size).toBeGreaterThan(1);
  });
});

describe("financialStatementAccounts", () => {
  it("covers every AccountType at least once", () => {
    const types = new Set(financialStatementAccounts.map((a) => a.type));
    expect(types).toEqual(new Set(["asset", "liability", "equity", "revenue", "expense"]));
  });

  it("has no header accounts (every account here is postable)", () => {
    expect(financialStatementAccounts.every((a) => !a.isHeader)).toBe(true);
  });

  it("has no duplicate account ids", () => {
    const ids = financialStatementAccounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the declared VAT account ids are real accounts of the expected asset/liability type", () => {
    const byId = new Map(financialStatementAccounts.map((a) => [a.id, a]));
    expect(byId.get(OUTPUT_VAT_ACCOUNT_ID)?.type).toBe("liability");
    expect(byId.get(INPUT_VAT_ACCOUNT_ID)?.type).toBe("asset");
  });
});
