import { describe, expect, it } from "vitest";
import { runReport } from "./engine.js";
import {
  INPUT_VAT_ACCOUNT_ID,
  OUTPUT_VAT_ACCOUNT_ID,
  financialStatementAccounts,
  financialStatementEntries,
} from "./financial-fixtures.js";
import { type GlReportContext } from "./gl-shared.js";
import { createTrialBalanceReport } from "./trial-balance.js";
import { createIncomeStatementReport, incomeStatementNetIncome } from "./income-statement.js";
import {
  balanceSheetTotalAssets,
  balanceSheetTotalLiabilitiesEquity,
  createBalanceSheetReport,
} from "./balance-sheet.js";
import { cashFlowNetChange, createCashFlowReport } from "./cash-flow.js";
import { createVatReturnReport, vatNetPayable, type VatReturnContext } from "./vat-return.js";
import { createGeneralLedgerReport } from "./general-ledger.js";
import { createAccountLedgerReport } from "./account-ledger.js";

const ctx: GlReportContext = {
  accounts: financialStatementAccounts,
  journalEntries: financialStatementEntries,
};
const FULL_YEAR = { periodFrom: "2026-01-01", periodTo: "2026-12-31" };
const YEAR_END = "2026-12-31";

describe("golden fixture — integrity", () => {
  it("every posted entry balances (debit = credit)", () => {
    for (const entry of financialStatementEntries) {
      const debit = entry.lines.reduce((s, l) => s + Number(l.debit.toString()), 0);
      const credit = entry.lines.reduce((s, l) => s + Number(l.credit.toString()), 0);
      expect(debit).toBeCloseTo(credit, 6);
    }
  });
});

describe("ميزان المراجعة — Trial Balance", () => {
  const report = createTrialBalanceReport(YEAR_END);

  it("nets to zero (Σ debit = Σ credit) as of year end", () => {
    const outcome = runReport(report, { asOfDate: YEAR_END }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.grandTotals).toEqual({ debit: 452400, credit: 452400 });
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
    expect(outcome.reconciliation?.diff).toBe(0);
  });

  it("reports the expected debit-side balances per account", () => {
    const outcome = runReport(report, { asOfDate: YEAR_END }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const byId = new Map(outcome.rows.map((r) => [r.accountId, r]));
    expect(byId.get("1100")).toMatchObject({ debit: 289200, credit: 0 }); // cash
    expect(byId.get("1110")).toMatchObject({ debit: 10000, credit: 0 }); // bank
    expect(byId.get("1200")).toMatchObject({ debit: 41200, credit: 0 }); // AR
    expect(byId.get("2100")).toMatchObject({ debit: 0, credit: 17000 }); // AP
    expect(byId.get("2500")).toMatchObject({ debit: 0, credit: 100000 }); // long-term loan
  });
});

describe("قائمة الدخل — Income Statement", () => {
  const report = createIncomeStatementReport(FULL_YEAR);

  it("computes revenue, COGS, opex and net income for the period", () => {
    const outcome = runReport(report, FULL_YEAR, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const section = (key: string) => outcome.groups.find((g) => g.key === key)?.totals.amount;
    expect(section("revenue")).toBe(130000);
    expect(section("cogs")).toBe(-48000);
    expect(section("opex")).toBe(-15000);
    expect(outcome.grandTotals.amount).toBe(67000); // net income
    expect(incomeStatementNetIncome(outcome.rows)).toBe(67000);
  });

  it("restricts to the period window", () => {
    const q1 = runReport(report, { periodFrom: "2026-01-01", periodTo: "2026-03-31" }, ctx);
    if (!q1.ok) throw new Error("expected success");
    // je-5 sales 80,000 + je-6 COGS 48,000 by end of March; no opex yet.
    expect(q1.groups.find((g) => g.key === "revenue")?.totals.amount).toBe(80000);
    expect(q1.groups.find((g) => g.key === "cogs")?.totals.amount).toBe(-48000);
    expect(q1.grandTotals.amount).toBe(32000);
  });
});

describe("الميزانية العمومية — Balance Sheet", () => {
  const report = createBalanceSheetReport(YEAR_END);

  it("balances: assets = liabilities + equity (incl. retained earnings)", () => {
    const outcome = runReport(report, { asOfDate: YEAR_END }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    expect(balanceSheetTotalAssets(outcome.rows)).toBe(389400);
    expect(balanceSheetTotalLiabilitiesEquity(outcome.rows)).toBe(389400);
    expect(outcome.reconciliation).toMatchObject({
      reportTotal: 389400,
      referenceTotal: 389400,
      diff: 0,
      withinTolerance: true,
    });
  });

  it("folds period net income into equity as retained earnings", () => {
    const outcome = runReport(report, { asOfDate: YEAR_END }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const retained = outcome.rows.find((r) => r.rowId === "_retained-earnings");
    expect(retained?.amount).toBe(67000);
    const equity = outcome.groups.find((g) => g.key === "equity");
    expect(equity?.totals.amount).toBe(267000); // capital 200,000 + retained 67,000
  });

  it("suppresses the grand-total row (A + L + E is not meaningful)", () => {
    expect(report.showGrandTotal).toBe(false);
  });
});

describe("التدفقات النقدية — Cash Flow (indirect)", () => {
  const report = createCashFlowReport(FULL_YEAR);

  it("reconciles: opening + net change = closing cash", () => {
    const outcome = runReport(report, FULL_YEAR, ctx);
    if (!outcome.ok) throw new Error("expected success");
    expect(cashFlowNetChange(outcome.rows)).toBe(299200); // closing 299,200 − opening 0
    expect(outcome.reconciliation).toMatchObject({
      reportTotal: 299200,
      referenceTotal: 299200,
      withinTolerance: true,
    });
  });

  it("splits the change across operating / investing / financing", () => {
    const outcome = runReport(report, FULL_YEAR, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const activity = (key: string) => outcome.groups.find((g) => g.key === key)?.totals.amount;
    expect(activity("operating")).toBe(39200);
    expect(activity("investing")).toBe(-40000);
    expect(activity("financing")).toBe(300000);
    const netIncome = outcome.rows.find((r) => r.rowId === "_net-income");
    expect(netIncome?.amount).toBe(67000);
  });
});

describe("إقرار ضريبة القيمة المضافة — VAT Return", () => {
  const vatCtx: VatReturnContext = {
    ...ctx,
    outputVatAccountId: OUTPUT_VAT_ACCOUNT_ID,
    inputVatAccountId: INPUT_VAT_ACCOUNT_ID,
  };
  const report = createVatReturnReport(FULL_YEAR);

  it("buckets output and input tax by rate and computes net payable", () => {
    const outcome = runReport(report, FULL_YEAR, vatCtx);
    if (!outcome.ok) throw new Error("expected success");
    const row = (id: string) => outcome.rows.find((r) => r.rowId === id);
    expect(row("output-14")).toMatchObject({ rate: 14, base: 110000, tax: 15400 });
    expect(row("output-0")).toMatchObject({ rate: 0, base: 20000, tax: 0 });
    expect(row("input-14")).toMatchObject({ rate: 14, base: 50000, tax: 7000 });
    expect(vatNetPayable(outcome.rows)).toBe(8400); // 15,400 − 7,000
  });
});

describe("دفتر الأستاذ العام — General Ledger", () => {
  const report = createGeneralLedgerReport(FULL_YEAR);

  it("lists every posted line and balances debit = credit", () => {
    const outcome = runReport(report, FULL_YEAR, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const expectedLines = financialStatementEntries.reduce((s, e) => s + e.lines.length, 0);
    expect(outcome.rows).toHaveLength(expectedLines);
    expect(outcome.grandTotals.debit).toBe(outcome.grandTotals.credit);
    expect(outcome.grandTotals.debit).toBe(705400); // gross of every posted line
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("is on-demand", () => {
    expect(report.onDemand).toBe(true);
  });
});

describe("دفتر حساب — Account Ledger", () => {
  const report = createAccountLedgerReport(financialStatementAccounts, {
    accountId: "1100",
    ...FULL_YEAR,
  });

  it("produces a running balance whose close matches the ledger", () => {
    const outcome = runReport(report, { accountId: "1100", ...FULL_YEAR }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    const last = outcome.rows[outcome.rows.length - 1];
    expect(last?.balance).toBe(289200); // cash closing balance
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 0 });
    expect(outcome.reconciliation).toMatchObject({
      reportTotal: 289200,
      referenceTotal: 289200,
      withinTolerance: true,
    });
  });

  it("carries an opening balance from before the period", () => {
    const outcome = runReport(report, { accountId: "1100", periodFrom: "2026-06-01", periodTo: "2026-12-31" }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    // Cash before June: 200,000 (je1) + 20,000 (je7) − 15,000 (je8) = 205,000.
    expect(outcome.rows[0]).toMatchObject({ isOpening: true, balance: 205000 });
    expect(outcome.rows[outcome.rows.length - 1]?.balance).toBe(289200);
  });

  it("rejects an unknown account", () => {
    const outcome = runReport(report, { accountId: "9999", ...FULL_YEAR }, ctx);
    expect(outcome.ok).toBe(false);
  });
});
