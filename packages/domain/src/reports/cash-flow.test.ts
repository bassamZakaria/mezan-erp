import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { cashFlowNetChange, createCashFlowReport } from "./cash-flow.js";
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
    lines: [dr("1100", "100"), cr("3100", "100")],
    ...overrides,
  };
  assertBalanced(entry.lines);
  return entry;
}

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset", naturalBalance: "debit" }),
  account({ id: "1500", code: "1500", nameAr: "معدات", type: "asset", naturalBalance: "debit" }),
  account({ id: "2100", code: "2100", nameAr: "الموردون", type: "liability", naturalBalance: "credit" }),
  account({ id: "2500", code: "2500", nameAr: "قرض طويل الأجل", type: "liability", naturalBalance: "credit" }),
  account({ id: "3100", code: "3100", nameAr: "رأس المال", type: "equity", naturalBalance: "credit" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue", naturalBalance: "credit" }),
  account({ id: "5100", code: "5100", nameAr: "مصروفات", type: "expense", naturalBalance: "debit" }),
];

describe("createCashFlowReport", () => {
  it("reconciles: opening + net change = closing cash, independently checked from cash-account postings", () => {
    const entries = [
      je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "1000"), cr("3100", "1000")] }),
      je({ id: "buy-equip", date: "2026-01-05", lines: [dr("1500", "300"), cr("1100", "300")] }),
      je({ id: "sale", date: "2026-01-10", lines: [dr("1100", "200"), cr("4100", "200")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-01-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Independently: cash postings only — +1000 −300 +200 = 900.
    expect(cashFlowNetChange(outcome.rows)).toBe(900);
    expect(outcome.reconciliation).toMatchObject({ reportTotal: 900, referenceTotal: 900, withinTolerance: true });
  });

  it("splits the change across operating / investing / financing correctly", () => {
    const entries = [
      je({ id: "loan", date: "2026-01-01", lines: [dr("1100", "500"), cr("2500", "500")] }), // financing
      je({ id: "buy-equip", date: "2026-01-02", lines: [dr("1500", "200"), cr("1100", "200")] }), // investing
      je({ id: "sale", date: "2026-01-03", lines: [dr("1100", "150"), cr("4100", "150")] }), // operating (net income)
      je({ id: "pay-supplier", date: "2026-01-04", lines: [dr("2100", "40"), cr("1100", "40")] }), // operating (working capital)
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-01-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const activity = (key: string) => outcome.groups.find((g) => g.key === key)?.totals.amount;
    expect(activity("financing")).toBe(500);
    expect(activity("investing")).toBe(-200);
    expect(activity("operating")).toBe(150 - 40);
    expect(cashFlowNetChange(outcome.rows)).toBe(500 - 200 + 150 - 40);
  });

  it("includes a cash-affecting entry exactly on periodFrom/periodTo and excludes one day outside each bound", () => {
    const entries = [
      je({ id: "before", date: "2026-02-28", lines: [dr("1100", "999"), cr("4100", "999")] }),
      je({ id: "on-from", date: "2026-03-01", lines: [dr("1100", "10"), cr("4100", "10")] }),
      je({ id: "on-to", date: "2026-03-31", lines: [dr("1100", "20"), cr("4100", "20")] }),
      je({ id: "after", date: "2026-04-01", lines: [dr("1100", "888"), cr("4100", "888")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(cashFlowNetChange(outcome.rows)).toBe(30);
  });

  it("renders a zero net change honestly over a period with no activity", () => {
    const definition = createCashFlowReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(cashFlowNetChange(outcome.rows)).toBe(0);
    expect(outcome.reconciliation).toMatchObject({ reportTotal: 0, referenceTotal: 0, withinTolerance: true });
    expect(Number.isNaN(cashFlowNetChange(outcome.rows))).toBe(false);
  });

  it("excludes the year-end close from the current-period flows (it moves nothing through cash)", () => {
    const entries = [
      je({ id: "sale", date: "2026-06-01", lines: [dr("1100", "500"), cr("4100", "500")] }),
      je({
        id: "close",
        date: "2026-12-31",
        sourceDocType: "YEAR_END_CLOSE",
        lines: [dr("4100", "500"), cr("3100", "500")],
      }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-12-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-12-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const netIncomeRow = outcome.rows.find((r) => r.rowId === "_net-income");
    expect(netIncomeRow?.amount).toBe(500);
  });

  it("keeps opening/closing cash consistent across every row in the output", () => {
    const entries = [
      je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "1000"), cr("3100", "1000")] }),
      je({ id: "sale", date: "2026-06-01", lines: [dr("1100", "200"), cr("4100", "200")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-06-01", periodTo: "2026-06-30" });
    const outcome = runReport(definition, { periodFrom: "2026-06-01", periodTo: "2026-06-30", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const openings = new Set(outcome.rows.map((r) => r.openingCash));
    const closings = new Set(outcome.rows.map((r) => r.closingCash));
    expect(openings.size).toBe(1);
    expect(closings.size).toBe(1);
    expect([...openings][0]).toBe(1000);
    expect([...closings][0]).toBe(1200);
  });

  it("orders groups operating, then investing, then financing", () => {
    const entries = [
      je({ id: "financing", date: "2026-01-01", lines: [dr("1100", "10"), cr("2500", "10")] }),
      je({ id: "investing", date: "2026-01-02", lines: [dr("1500", "20"), cr("1100", "20")] }),
      je({ id: "operating", date: "2026-01-03", lines: [dr("1100", "30"), cr("4100", "30")] }),
    ];
    const definition = createCashFlowReport({ periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    const outcome = runReport(definition, { periodFrom: "2026-01-01", periodTo: "2026-01-31", compareTo: "previous" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const order = outcome.rows.map((r) => r.activity);
    expect(order.indexOf("operating")).toBeLessThan(order.indexOf("investing"));
    expect(order.indexOf("investing")).toBeLessThan(order.indexOf("financing"));
  });

  it("rejects a period where periodFrom is after periodTo, via zod, not a throw", () => {
    const definition = createCashFlowReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(
      definition,
      { periodFrom: "2026-04-01", periodTo: "2026-03-01", compareTo: "previous" },
      { accounts, journalEntries: [] } satisfies GlReportContext,
    );
    expect(outcome.ok).toBe(false);
  });
});

/** guards C-10 — net income, the working-capital rows and opening/closing cash all summed as floats. */
describe("createCashFlowReport — exact arithmetic", () => {
  it("sums opening cash and net income exactly across fractional postings", () => {
    const entries = [
      je({ id: "o1", date: "2026-01-01", lines: [dr("1100", "0.10"), cr("3100", "0.10")] }),
      je({ id: "o2", date: "2026-01-02", lines: [dr("1100", "0.20"), cr("3100", "0.20")] }),
      je({ id: "s1", date: "2026-03-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "s2", date: "2026-03-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
      je({ id: "e1", date: "2026-03-03", lines: [dr("5100", "0.10"), cr("1100", "0.10")] }),
    ];
    const params = { periodFrom: "2026-03-01", periodTo: "2026-03-31", compareTo: "previous" as const };
    const outcome = runReport(createCashFlowReport(params), params, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 0.10 + 0.20 = 0.30 opening, and 0.10 + 0.20 − 0.10 = 0.20 of net income.
    expect(outcome.rows[0]?.openingCash).toBe(0.3);
    expect(outcome.rows.find((r) => r.rowId === "_net-income")?.amount).toBe(0.2);
    expect(cashFlowNetChange(outcome.rows)).toBeCloseTo(0.2, 10);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });
});
