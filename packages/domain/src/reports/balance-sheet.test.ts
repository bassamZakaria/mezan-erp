import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "./engine.js";
import { balanceSheetTotalAssets, balanceSheetTotalLiabilitiesEquity, createBalanceSheetReport } from "./balance-sheet.js";
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
  account({ id: "3100", code: "3100", nameAr: "رأس المال", type: "equity", naturalBalance: "credit" }),
  account({ id: "4100", code: "4100", nameAr: "المبيعات", type: "revenue", naturalBalance: "credit" }),
  account({ id: "5100", code: "5100", nameAr: "مصروفات", type: "expense", naturalBalance: "debit" }),
];

describe("createBalanceSheetReport", () => {
  it("balances assets = liabilities + equity, independently summed from the row set", () => {
    const entries = [
      je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "500"), cr("3100", "500")] }),
      je({ id: "loan", date: "2026-01-02", lines: [dr("1500", "200"), cr("2100", "200")] }),
    ];
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const assets = outcome.rows.filter((r) => r.side === "asset").reduce((s, r) => s + r.amount, 0);
    const le = outcome.rows.filter((r) => r.side === "liability-equity").reduce((s, r) => s + r.amount, 0);
    expect(assets).toBe(700);
    expect(le).toBe(700);
    expect(balanceSheetTotalAssets(outcome.rows)).toBe(700);
    expect(balanceSheetTotalLiabilitiesEquity(outcome.rows)).toBe(700);
    expect(outcome.reconciliation).toMatchObject({ reportTotal: 700, referenceTotal: 700, diff: 0, withinTolerance: true });
  });

  it(
    "LIMITATION: retained earnings is a computed plug (Σ revenue − Σ expense to date), never a posted ledger balance — pins current behavior",
    () => {
      const entries = [
        je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "1000"), cr("3100", "1000")] }),
        je({ id: "sale", date: "2026-02-01", lines: [dr("1100", "300"), cr("4100", "300")] }),
        je({ id: "expense", date: "2026-02-02", lines: [dr("5100", "80"), cr("1100", "80")] }),
      ];
      const definition = createBalanceSheetReport("2026-12-31");
      const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // No account named "retained earnings" was ever posted to — the row is
      // synthesised as a residual (revenue − expense), identified by the
      // synthetic rowId "_retained-earnings" rather than a real account.
      const retained = outcome.rows.find((r) => r.rowId === "_retained-earnings");
      expect(retained?.amount).toBe(220); // 300 revenue − 80 expense
      expect(retained?.code).toBe("");
      expect(accounts.some((a) => a.id === retained?.rowId)).toBe(false);
      expect(balanceSheetTotalAssets(outcome.rows)).toBe(balanceSheetTotalLiabilitiesEquity(outcome.rows));
    },
  );

  it("omits the retained-earnings row entirely when net income to date is exactly zero", () => {
    const entries = [je({ id: "capital", date: "2026-01-01", lines: [dr("1100", "500"), cr("3100", "500")] })];
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.some((r) => r.rowId === "_retained-earnings")).toBe(false);
  });

  it("includes a posting exactly on asOfDate and excludes one dated the day after", () => {
    const entries = [
      je({ id: "on-date", date: "2026-06-30", lines: [dr("1100", "40"), cr("3100", "40")] }),
      je({ id: "after", date: "2026-07-01", lines: [dr("1100", "999"), cr("3100", "999")] }),
    ];
    const definition = createBalanceSheetReport("2026-06-30");
    const outcome = runReport(definition, { asOfDate: "2026-06-30" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(balanceSheetTotalAssets(outcome.rows)).toBe(40);
  });

  it("renders no rows and a zero A=L+E reconciliation, honestly, over an empty ledger", () => {
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.reconciliation).toMatchObject({ reportTotal: 0, referenceTotal: 0, diff: 0, withinTolerance: true });
  });

  it("suppresses the grand-total row — A + L + E is not a meaningful figure", () => {
    const definition = createBalanceSheetReport("2026-12-31");
    expect(definition.showGrandTotal).toBe(false);
  });

  it("orders sections cash/current-asset/non-current-asset before liabilities before equity", () => {
    const entries = [
      je({ id: "eq", date: "2026-01-01", lines: [dr("1500", "10"), cr("3100", "10")] }),
      je({ id: "liab", date: "2026-01-02", lines: [dr("1500", "20"), cr("2100", "20")] }),
      je({ id: "cash", date: "2026-01-03", lines: [dr("1100", "5"), cr("2100", "5")] }),
    ];
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sectionOrder = outcome.rows.map((r) => r.sectionKey);
    expect(sectionOrder.indexOf("cash")).toBeLessThan(sectionOrder.indexOf("non-current-asset"));
    expect(sectionOrder.indexOf("non-current-asset")).toBeLessThan(sectionOrder.indexOf("current-liability"));
    expect(sectionOrder.indexOf("current-liability")).toBeLessThan(sectionOrder.indexOf("equity"));
  });

  it("rejects a malformed asOfDate through zod, not a throw", () => {
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "31-12-2026" }, { accounts, journalEntries: [] } satisfies GlReportContext);
    expect(outcome.ok).toBe(false);
  });
});

/**
 * guards C-10 — retained earnings accumulated across every P&L account in
 * IEEE-754. 0.1 + 0.2 is 0.30000000000000004 there, and this is a statutory
 * financial statement.
 */
describe("createBalanceSheetReport — exact arithmetic", () => {
  it("accumulates retained earnings without float drift", () => {
    const entries = [
      je({ id: "s1", date: "2026-02-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "s2", date: "2026-02-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
      je({ id: "s3", date: "2026-02-03", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "e1", date: "2026-02-04", lines: [dr("5100", "0.10"), cr("1100", "0.10")] }),
    ];
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const retained = outcome.rows.find((r) => r.rowId === "_retained-earnings");
    expect(retained).toBeDefined();
    // 0.10 + 0.20 + 0.10 − 0.10 = 0.30, exactly.
    expect(retained!.amount).toBe(0.3);
  });

  it("still ties assets to liabilities + equity on fractional amounts", () => {
    const entries = [
      je({ id: "cap", date: "2026-01-01", lines: [dr("1100", "0.30"), cr("3100", "0.30")] }),
      je({ id: "s1", date: "2026-02-01", lines: [dr("1100", "0.10"), cr("4100", "0.10")] }),
      je({ id: "s2", date: "2026-02-02", lines: [dr("1100", "0.20"), cr("4100", "0.20")] }),
    ];
    const definition = createBalanceSheetReport("2026-12-31");
    const outcome = runReport(definition, { asOfDate: "2026-12-31" }, { accounts, journalEntries: entries });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(balanceSheetTotalAssets(outcome.rows)).toBe(balanceSheetTotalLiabilitiesEquity(outcome.rows));
  });
});
