import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { createGeneralLedgerReport } from "./general-ledger.js";
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
    entryNo: "JE-000001",
    status: "posted",
    lines: [dr("1100", "100"), cr("4100", "100")],
    ...overrides,
  };
  assertBalanced(entry.lines);
  return entry;
}

const accounts: Account[] = [
  account({ id: "1100", code: "1100", nameAr: "النقدية", type: "asset" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue" }),
];

describe("createGeneralLedgerReport", () => {
  it("lists every posted line (one row per line, not per entry) and balances debit = credit", () => {
    const entries = [
      je({ id: "je-1", entryNo: "JE-000001", date: "2026-03-01", lines: [dr("1100", "100"), cr("4100", "100")] }),
      je({ id: "je-2", entryNo: "JE-000002", date: "2026-03-02", lines: [dr("1100", "50"), cr("4100", "50")] }),
    ];
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const expectedLineCount = entries.reduce((s, e) => s + e.lines.length, 0);
    expect(outcome.rows).toHaveLength(expectedLineCount);
    expect(outcome.grandTotals.debit).toBe(outcome.grandTotals.credit);
    expect(outcome.grandTotals.debit).toBe(150);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("includes a line dated exactly on periodFrom/periodTo and excludes one day outside each bound", () => {
    const entries = [
      je({ id: "before", date: "2026-02-28" }),
      je({ id: "on-from", date: "2026-03-01" }),
      je({ id: "on-to", date: "2026-03-31" }),
      je({ id: "after", date: "2026-04-01" }),
    ];
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 2 in-range entries × 2 lines each.
    expect(outcome.rows).toHaveLength(4);
  });

  it("renders no rows and a zero, non-NaN reconciliation over a period with no activity at all", () => {
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.debit).toBe(0);
    expect(Number.isNaN(outcome.grandTotals.debit)).toBe(false);
  });

  it("excludes draft and pending entries", () => {
    const entries = [je({ id: "draft", status: "draft" }), je({ id: "pending", status: "pending" })];
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("groups rows by account and, within an account, orders lines chronologically", () => {
    const entries = [
      je({ id: "je-2", entryNo: "JE-000002", date: "2026-03-10", lines: [dr("1100", "20"), cr("4100", "20")] }),
      je({ id: "je-1", entryNo: "JE-000001", date: "2026-03-01", lines: [dr("1100", "10"), cr("4100", "10")] }),
    ];
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const cashRows = outcome.rows.filter((r) => r.accountKey === "1100");
    expect(cashRows.map((r) => r.date)).toEqual(["2026-03-01", "2026-03-10"]);
  });

  it("is on-demand", () => {
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    expect(definition.onDemand).toBe(true);
  });

  it("rejects periodFrom after periodTo via zod, not a throw", () => {
    const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    const outcome = runReport(definition, { periodFrom: "2026-04-01", periodTo: "2026-03-01" }, { accounts, journalEntries: [] } satisfies GlReportContext);
    expect(outcome.ok).toBe(false);
  });
});

/**
 * guards C-10 — every figure this report emits is one `Money → number`
 * conversion of the line itself, never the result of float arithmetic. The
 * residual float in the totals lives in the shared KPI layer (kpi.ts
 * `sumRows`), which every one of the 33 reports uses.
 */
describe("createGeneralLedgerReport — exact arithmetic", () => {
  it("emits each line's own exact amount", () => {
    const entries = [
      je({ id: "a", entryNo: "JE-1", date: "2026-03-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "b", entryNo: "JE-2", date: "2026-03-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
    ];
    const params = { periodFrom: "2026-03-01", periodTo: "2026-03-31" };
    const outcome = runReport(createGeneralLedgerReport(params), params, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.debit + r.credit).sort()).toEqual([0.1, 0.1, 0.2, 0.2]);
  });
});

describe("createGeneralLedgerReport — branch scope and filter (D111)", () => {
  const tagged = (branchId: string | null, major: string) => [
    { ...dr("1100", major), branchId },
    { ...cr("4100", major), branchId },
  ];
  const entries = [
    je({ id: "je-main", entryNo: "JE-1", lines: tagged("BR-MAIN", "100") }),
    je({ id: "je-alex", entryNo: "JE-2", lines: tagged("BR-ALEX", "40") }),
    je({ id: "je-none", entryNo: "JE-3", lines: tagged(null, "7") }),
  ];
  const definition = createGeneralLedgerReport({ periodFrom: "2026-03-01", periodTo: "2026-03-31" });
  const debitOf = (params: Record<string, string>, ctx: Partial<GlReportContext> = {}) => {
    const outcome = runReport(definition, { periodFrom: "2026-03-01", periodTo: "2026-03-31", ...params }, { accounts, journalEntries: entries, ...ctx });
    if (!outcome.ok) throw new Error("report refused");
    return outcome.rows.reduce((sum, row) => sum + row.debit, 0);
  };

  it("never hands a scoped caller another branch's lines, whatever branch they ask for", () => {
    expect(debitOf({}, { branchScope: ["BR-ALEX"] })).toBe(47);
    expect(debitOf({ branchId: "BR-MAIN" }, { branchScope: ["BR-ALEX"] })).toBe(0);
  });

  it("narrows to one branch, or to the unattributed bucket, and the three add up to the company", () => {
    const company = debitOf({});
    const parts = debitOf({ branchId: "BR-MAIN" }) + debitOf({ branchId: "BR-ALEX" }) + debitOf({ branchId: "__unattributed__" });
    expect(company).toBe(147);
    expect(parts).toBe(company);
  });
});
