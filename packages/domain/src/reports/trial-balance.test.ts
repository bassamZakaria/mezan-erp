import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { createTrialBalanceReport, type TrialBalanceContext } from "./trial-balance.js";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "1100",
    code: "1100",
    nameAr: "النقدية",
    nameEn: "Cash",
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

function dr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.fromMajor(major), credit: Money.zero() };
}
function cr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.zero(), credit: Money.fromMajor(major) };
}
function je(overrides: Partial<JournalEntry> = {}): JournalEntry {
  const entry: JournalEntry = {
    id: "je-1",
    date: "2026-03-01",
    memo: "قيد",
    status: "posted",
    lines: [dr("1100", "100"), cr("4100", "100")],
    ...overrides,
  };
  assertBalanced(entry.lines);
  return entry;
}

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset", naturalBalance: "debit" }),
  account({ id: "2100", code: "2100", nameAr: "الموردون", type: "liability", naturalBalance: "credit" }),
  account({ id: "3100", code: "3100", nameAr: "رأس المال", type: "equity", naturalBalance: "credit" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue", naturalBalance: "credit" }),
  account({ id: "9000", code: "9000", nameAr: "رئيسي", type: "asset", naturalBalance: "debit", isHeader: true }),
];

describe("createTrialBalanceReport", () => {
  it("reports the debit-normal balance under debit and the credit-normal balance under credit", () => {
    const entries = [
      je({ id: "je-1", date: "2026-01-01", lines: [dr("1100", "200"), cr("3100", "200")] }),
      je({ id: "je-2", date: "2026-01-10", lines: [dr("1100", "50"), cr("2100", "50")] }),
    ];
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const byId = new Map(outcome.rows.map((r) => [r.accountId, r]));
    expect(byId.get("1100")).toMatchObject({ debit: 250, credit: 0 });
    expect(byId.get("2100")).toMatchObject({ debit: 0, credit: 50 });
    expect(byId.get("3100")).toMatchObject({ debit: 0, credit: 200 });
  });

  it("nets to zero: Σdebit = Σcredit, tied independently to the source entries' own totals", () => {
    const entries = [
      je({ id: "je-1", date: "2026-01-01", lines: [dr("1100", "300"), cr("3100", "300")] }),
      je({ id: "je-2", date: "2026-02-01", lines: [dr("1100", "50"), cr("4100", "50")] }),
    ];
    const expectedTotal = entries.reduce((s, e) => s + Number(e.lines[0]!.debit.toString()), 0);
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.grandTotals.debit).toBe(expectedTotal);
    expect(outcome.grandTotals.credit).toBe(expectedTotal);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
    expect(outcome.reconciliation?.diff).toBe(0);
  });

  it("includes an entry dated exactly on asOfDate and excludes one dated the day after", () => {
    const entries = [
      je({ id: "on-date", date: "2026-06-30", lines: [dr("1100", "40"), cr("4100", "40")] }),
      je({ id: "after", date: "2026-07-01", lines: [dr("1100", "999"), cr("4100", "999")] }),
    ];
    const definition = createTrialBalanceReport("2026-06-30");
    const outcome = runReport(definition, { asOfDate: "2026-06-30" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const cash = outcome.rows.find((r) => r.accountId === "1100");
    expect(cash?.debit).toBe(40);
  });

  it("renders every account at zero, honestly, over a ledger with no entries at all", () => {
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.every((r) => r.debit === 0 && r.credit === 0)).toBe(true);
    expect(outcome.grandTotals.debit).toBe(0);
    expect(outcome.grandTotals.credit).toBe(0);
    expect(Number.isNaN(outcome.grandTotals.debit)).toBe(false);
  });

  it("excludes draft and pending entries from the balance", () => {
    const entries = [
      je({ id: "draft", status: "draft", date: "2026-01-01", lines: [dr("1100", "1000"), cr("4100", "1000")] }),
      je({ id: "pending", status: "pending", date: "2026-01-01", lines: [dr("1100", "2000"), cr("4100", "2000")] }),
    ];
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.accountId === "1100")?.debit).toBe(0);
  });

  it("excludes header accounts from the rows entirely", () => {
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.some((r) => r.accountId === "9000")).toBe(false);
  });

  it("groups rows by account type, in Arabic type labels", () => {
    const entries = [
      je({ id: "je-1", date: "2026-01-01", lines: [dr("1100", "10"), cr("3100", "10")] }),
      je({ id: "je-2", date: "2026-01-02", lines: [dr("1100", "5"), cr("2100", "5")] }),
    ];
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const groupKeys = outcome.groups.map((g) => g.key);
    expect(groupKeys).toContain("الأصول");
    expect(groupKeys).toContain("الالتزامات");
    expect(groupKeys).toContain("حقوق الملكية");
  });

  it("rejects a malformed asOfDate through zod validation, not a throw", () => {
    const definition = createTrialBalanceReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "not-a-date" }, { accounts, journalEntries: [] } satisfies TrialBalanceContext);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.length).toBeGreaterThan(0);
  });

  it("is on-demand", () => {
    const definition = createTrialBalanceReport("2026-12-31");
    expect(definition.onDemand).toBe(true);
  });
});
