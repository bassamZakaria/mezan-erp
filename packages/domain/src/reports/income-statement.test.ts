import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { YEAR_END_CLOSE_DOC_TYPE } from "../journal.js";
import { runReport } from "./engine.js";
import { createIncomeStatementReport, incomeStatementNetIncome } from "./income-statement.js";
import type { GlReportContext } from "./gl-shared.js";

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
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue", naturalBalance: "credit" }),
  account({ id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", type: "expense", naturalBalance: "debit" }),
  account({ id: "5200", code: "5200", nameAr: "مصروفات تشغيلية", type: "expense", naturalBalance: "debit" }),
  account({ id: "3200", code: "3200", nameAr: "ملخص الدخل", type: "equity", naturalBalance: "credit" }),
  account({ id: "3100", code: "3100", nameAr: "رأس المال", type: "equity", naturalBalance: "credit" }),
];

describe("createIncomeStatementReport", () => {
  it("computes revenue, COGS, opex and net income for the period, independently tied to the postings", () => {
    const entries = [
      je({ id: "je-rev", date: "2026-03-05", lines: [dr("1100", "1000"), cr("4100", "1000")] }),
      je({ id: "je-cogs", date: "2026-03-06", lines: [dr("5100", "400"), cr("1100", "400")] }),
      je({ id: "je-opex", date: "2026-03-07", lines: [dr("5200", "150"), cr("1100", "150")] }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const revenue = outcome.groups.find((g) => g.key === "revenue")?.totals.amount;
    const cogs = outcome.groups.find((g) => g.key === "cogs")?.totals.amount;
    const opex = outcome.groups.find((g) => g.key === "opex")?.totals.amount;
    expect(revenue).toBe(1000);
    expect(cogs).toBe(-400);
    expect(opex).toBe(-150);
    // Independent check: 1000 revenue − 400 COGS − 150 opex = 450, computed here, not copied.
    expect(outcome.grandTotals.amount).toBe(1000 - 400 - 150);
    expect(incomeStatementNetIncome(outcome.rows)).toBe(outcome.grandTotals.amount);
  });

  it("includes a revenue entry dated exactly on periodFrom and one dated exactly on periodTo", () => {
    const entries = [
      je({ id: "on-from", date: "2026-03-01", lines: [dr("1100", "10"), cr("4100", "10")] }),
      je({ id: "on-to", date: "2026-03-31", lines: [dr("1100", "20"), cr("4100", "20")] }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.groups.find((g) => g.key === "revenue")?.totals.amount).toBe(30);
  });

  it("excludes a revenue entry one day before periodFrom and one day after periodTo", () => {
    const entries = [
      je({ id: "before", date: "2026-02-28", lines: [dr("1100", "999"), cr("4100", "999")] }),
      je({ id: "in-range", date: "2026-03-15", lines: [dr("1100", "40"), cr("4100", "40")] }),
      je({ id: "after", date: "2026-04-01", lines: [dr("1100", "888"), cr("4100", "888")] }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.groups.find((g) => g.key === "revenue")?.totals.amount).toBe(40);
  });

  it("renders zero honestly over a period with no activity at all", () => {
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.amount).toBe(0);
    expect(Number.isNaN(outcome.grandTotals.amount)).toBe(false);
  });

  it("excludes the year-end closing entry from the current period so annual net income is not silently zeroed", () => {
    const entries = [
      je({ id: "rev", date: "2026-06-01", lines: [dr("1100", "500"), cr("4100", "500")] }),
      je({
        id: "close",
        date: "2026-12-31",
        sourceDocType: YEAR_END_CLOSE_DOC_TYPE,
        lines: [dr("4100", "500"), cr("3200", "500")],
      }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-01-01", periodTo: "2026-12-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-12-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.groups.find((g) => g.key === "revenue")?.totals.amount).toBe(500);
  });

  it("computes priorAmount and variance against the previous equal-length window", () => {
    const entries = [
      je({ id: "prior", date: "2026-01-15", lines: [dr("1100", "100"), cr("4100", "100")] }),
      je({ id: "current", date: "2026-02-15", lines: [dr("1100", "150"), cr("4100", "150")] }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-02-01", periodTo: "2026-02-28" });
    const outcome = runReport(definition, { periodFrom: "2026-02-01", periodTo: "2026-02-28", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows.find((r) => r.accountId === "4100");
    expect(row?.amount).toBe(150);
    expect(row?.priorAmount).toBe(100);
    expect(row?.variance).toBe(50);
  });

  it("orders sections revenue, then COGS, then opex, and rows by account code within a section", () => {
    const entries = [
      je({ id: "opex", date: "2026-03-01", lines: [dr("5200", "10"), cr("1100", "10")] }),
      je({ id: "cogs", date: "2026-03-01", lines: [dr("5100", "20"), cr("1100", "20")] }),
      je({ id: "rev", date: "2026-03-01", lines: [dr("1100", "30"), cr("4100", "30")] }),
    ];
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.sectionKey)).toEqual(["revenue", "cogs", "opex"]);
  });

  it("rejects a period where periodFrom is after periodTo, via zod, not a throw", () => {
    const definition = createIncomeStatementReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(
      definition,
      { periodFrom: "2026-04-01", periodTo: "2026-03-01", compareTo: "previous" },
      { accounts, journalEntries: [] } satisfies GlReportContext,
    );
    expect(outcome.ok).toBe(false);
  });
});

/** guards C-10 — the amount, the comparative and the variance were all float arithmetic. */
describe("createIncomeStatementReport — exact arithmetic", () => {
  it("computes a fractional variance exactly", () => {
    const entries = [
      je({ id: "p1", date: "2026-02-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "c1", date: "2026-03-01", lines: [dr("1100", "0.30"), cr("4100", "0.30")] }),
    ];
    const params = { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" as const };
    const outcome = runReport(createIncomeStatementReport(params), params, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const revenue = outcome.rows.find((r) => r.accountId === "4100");
    expect(revenue).toMatchObject({ amount: 0.3, priorAmount: 0.1 });
    // 0.30 − 0.10 = 0.20, exactly — not 0.19999999999999998.
    expect(revenue!.variance).toBe(0.2);
  });

  it("nets income exactly over many small revenue and expense postings", () => {
    const entries = [
      je({ id: "s1", date: "2026-03-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "s2", date: "2026-03-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
      je({ id: "e1", date: "2026-03-03", lines: [dr("5100", "0.10"), cr("1100", "0.10")] }),
      je({ id: "e2", date: "2026-03-04", lines: [dr("5200", "0.10"), cr("1100", "0.10")] }),
    ];
    const params = { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" as const };
    const outcome = runReport(createIncomeStatementReport(params), params, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.find((r) => r.accountId === "4100")?.amount).toBe(0.3);
    expect(incomeStatementNetIncome(outcome.rows)).toBeCloseTo(0.1, 10);
  });
});
