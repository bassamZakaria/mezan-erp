import { describe, expect, it } from "vitest";
import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import {
  financialStatementAccounts,
  financialStatementEntries,
} from "./financial-fixtures.js";
import { classifyAccount, type GlReportContext } from "./gl-shared.js";
import { createTrialBalanceReport, type TrialBalanceContext } from "./trial-balance.js";
import {
  balanceSheetTotalAssets,
  balanceSheetTotalLiabilitiesEquity,
  createBalanceSheetReport,
} from "./balance-sheet.js";
import { cashFlowNetChange, createCashFlowReport } from "./cash-flow.js";
import { createIncomeStatementReport, incomeStatementNetIncome } from "./income-statement.js";

/**
 * حسابات نظامية — a letter of guarantee's face value is recorded as a
 * self-balancing 9100/9200 pair OFF balance sheet. This suite pins the whole
 * point of the type: posting such a pair changes NO financial statement.
 */

const MEMO_ACCOUNTS: Account[] = [
  { id: "9100", code: "9100", nameAr: "حسابات نظامية مدينة — خطابات ضمان", nameEn: "Memorandum Debit", type: "memorandum", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "9200", code: "9200", nameAr: "حسابات نظامية دائنة — خطابات ضمان", nameEn: "Memorandum Credit", type: "memorandum", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

const MEMO_ENTRY: JournalEntry = {
  id: "je-memo-lg",
  entryNo: "JE-900001",
  date: "2026-03-14",
  memo: "خطاب ضمان حسن تنفيذ — القيمة الاسمية",
  status: "posted",
  source: "system",
  lines: [
    { accountId: "9100", debit: Money.fromMajor("1247000"), credit: Money.zero() },
    { accountId: "9200", debit: Money.zero(), credit: Money.fromMajor("1247000") },
  ],
};

const PERIOD = { periodFrom: "2026-01-01", periodTo: "2026-12-31" };
const YEAR_END = "2026-12-31";

const before: GlReportContext & TrialBalanceContext = {
  accounts: financialStatementAccounts,
  journalEntries: financialStatementEntries,
};
const after: GlReportContext & TrialBalanceContext = {
  accounts: [...financialStatementAccounts, ...MEMO_ACCOUNTS],
  journalEntries: [...financialStatementEntries, MEMO_ENTRY],
};

describe("classifyAccount", () => {
  it("puts a memorandum account in its own section, not under assets or liabilities", () => {
    expect(classifyAccount(MEMO_ACCOUNTS[0]!)).toBe("memorandum");
    expect(classifyAccount(MEMO_ACCOUNTS[1]!)).toBe("memorandum");
  });
});

describe("ميزان المراجعة — a posted 9100/9200 pair", () => {
  const report = createTrialBalanceReport(YEAR_END);

  it("leaves the totals untouched", () => {
    const a = runReport(report, { asOfDate: YEAR_END }, before);
    const b = runReport(report, { asOfDate: YEAR_END }, after);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(a.grandTotals).toEqual({ debit: 452400, credit: 452400 });
    expect(b.grandTotals).toEqual(a.grandTotals);
    expect(b.reconciliation?.diff).toBe(0);
  });

  it("lists no memorandum row at all — the face value is read from the guarantee register", () => {
    const b = runReport(report, { asOfDate: YEAR_END }, after);
    if (!b.ok) throw new Error("expected success");
    expect(b.rows.map((r) => r.accountId)).not.toContain("9100");
    expect(b.rows.map((r) => r.accountId)).not.toContain("9200");
  });
});

describe("الميزانية العمومية — a posted 9100/9200 pair", () => {
  const report = createBalanceSheetReport(YEAR_END);

  it("leaves both sides unchanged and still balancing", () => {
    const a = runReport(report, { asOfDate: YEAR_END }, before);
    const b = runReport(report, { asOfDate: YEAR_END }, after);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(balanceSheetTotalAssets(b.rows)).toBe(balanceSheetTotalAssets(a.rows));
    expect(balanceSheetTotalLiabilitiesEquity(b.rows)).toBe(balanceSheetTotalLiabilitiesEquity(a.rows));
    expect(balanceSheetTotalAssets(b.rows)).toBe(balanceSheetTotalLiabilitiesEquity(b.rows));
    expect(b.rows.map((r) => r.rowId)).not.toContain("9100");
  });
});

describe("قائمة الدخل وقائمة التدفقات النقدية — a posted 9100/9200 pair", () => {
  it("changes neither net income nor the net change in cash", () => {
    const income = createIncomeStatementReport(PERIOD);
    const a = runReport(income, PERIOD, before);
    const b = runReport(income, PERIOD, after);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(incomeStatementNetIncome(b.rows)).toBe(incomeStatementNetIncome(a.rows));

    const cash = createCashFlowReport(PERIOD);
    const c = runReport(cash, PERIOD, before);
    const d = runReport(cash, PERIOD, after);
    if (!c.ok || !d.ok) throw new Error("expected success");
    expect(cashFlowNetChange(d.rows)).toBe(cashFlowNetChange(c.rows));
  });
});
