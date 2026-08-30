import { describe, it, expect } from "vitest";
import { assertBalanced } from "../gl/post.js";
import { netBalancesByAccount, moneyToNumber, isLedgerEffective } from "./gl-shared.js";
import { sampleReportAccounts, sampleReportJournalEntries } from "./sample-gl-data.js";

describe("sampleReportJournalEntries", () => {
  it("every entry is individually balanced, per the real GL posting engine's own check", () => {
    for (const entry of sampleReportJournalEntries) {
      expect(() => assertBalanced(entry.lines)).not.toThrow();
    }
  });

  it("every entry is posted, so the trial-balance/GL reports actually pick it up", () => {
    for (const entry of sampleReportJournalEntries) {
      expect(isLedgerEffective(entry)).toBe(true);
    }
  });

  it("nets to zero across the whole ledger and totals Σdebit = 147,000.00 once every entry is posted, as documented", () => {
    const balances = netBalancesByAccount(sampleReportJournalEntries);
    let totalPositive = 0;
    let netSum = 0n;
    for (const money of balances.values()) {
      netSum += money.scaled;
      const value = moneyToNumber(money);
      if (value > 0) totalPositive += value;
    }
    // Exact, in bigint: a fixture that is off by one micro-unit is a broken
    // fixture, and a float comparison would call it balanced.
    expect(netSum).toBe(0n);
    expect(totalPositive).toBe(147000);
  });

  it("every line's accountId resolves to a real account in the sample chart", () => {
    const ids = new Set(sampleReportAccounts.map((a) => a.id));
    for (const entry of sampleReportJournalEntries) {
      for (const line of entry.lines) {
        expect(ids.has(line.accountId)).toBe(true);
      }
    }
  });
});

describe("sampleReportAccounts", () => {
  it("covers every AccountType at least once", () => {
    const types = new Set(sampleReportAccounts.map((a) => a.type));
    expect(types).toEqual(new Set(["asset", "liability", "equity", "revenue", "expense"]));
  });

  it("has no header accounts (every account here is postable)", () => {
    expect(sampleReportAccounts.every((a) => !a.isHeader)).toBe(true);
  });

  it("has no duplicate account ids", () => {
    const ids = sampleReportAccounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
