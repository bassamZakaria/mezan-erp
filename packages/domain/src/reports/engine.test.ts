import { describe, expect, it } from "vitest";
import { z } from "zod";
import { computeReportGroups, runReport, validateReportParams } from "./engine.js";
import { createTrialBalanceReport, type TrialBalanceContext } from "./trial-balance.js";
import { sampleReportAccounts, sampleReportJournalEntries } from "./sample-gl-data.js";
import type { ReportColumn, ReportDefinition } from "./types.js";

const ctx: TrialBalanceContext = { accounts: sampleReportAccounts, journalEntries: sampleReportJournalEntries };
const trialBalance = createTrialBalanceReport("2026-08-22");

describe("validateReportParams", () => {
  it("accepts params matching the schema", () => {
    const result = validateReportParams(trialBalance, { asOfDate: "2026-08-22" });
    // `branchId` defaults to "" — every branch (DEC-20). It is defaulted rather
    // than required so a caller that predates the dimension still validates.
    expect(result).toEqual({ ok: true, params: { asOfDate: "2026-08-22", branchId: "" } });
  });

  it("rejects params that fail the schema, with a field-scoped message", () => {
    const result = validateReportParams(trialBalance, { asOfDate: "22/08/2026" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation failure");
    expect(result.errors).toEqual([{ field: "asOfDate", message: "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD" }]);
  });

  it("rejects missing required params", () => {
    const result = validateReportParams(trialBalance, {});
    expect(result.ok).toBe(false);
  });
});

describe("computeReportGroups", () => {
  interface Row {
    bucket: string;
    amount: number;
  }
  const columns: ReportColumn<Row>[] = [
    { key: "bucket", header: "Bucket", value: (r) => r.bucket },
    { key: "amount", header: "Amount", value: (r) => r.amount, total: true },
  ];

  it("returns a single unlabeled group when the definition has no `group` spec", () => {
    const rows: Row[] = [{ bucket: "a", amount: 10 }, { bucket: "b", amount: 5 }];
    const { groups, grandTotals } = computeReportGroups({ columns }, rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "_all", label: "", rows });
    expect(grandTotals).toEqual({ amount: 15 });
  });

  it("buckets rows by the group spec and sums totals per bucket + overall", () => {
    const rows: Row[] = [
      { bucket: "a", amount: 10 },
      { bucket: "b", amount: 5 },
      { bucket: "a", amount: 3 },
    ];
    const { groups, grandTotals } = computeReportGroups(
      { columns, group: { key: (r) => r.bucket, label: (r) => `Bucket ${r.bucket}` } },
      rows,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: "a", label: "Bucket a", totals: { amount: 13 } });
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[1]).toMatchObject({ key: "b", label: "Bucket b", totals: { amount: 5 } });
    expect(grandTotals).toEqual({ amount: 18 });
  });

  it("ignores non-numeric column values when summing totals", () => {
    interface TextRow {
      label: string;
    }
    const textColumns: ReportColumn<TextRow>[] = [{ key: "label", header: "Label", value: (r) => r.label, total: true }];
    const { grandTotals } = computeReportGroups({ columns: textColumns }, [{ label: "n/a" }]);
    expect(grandTotals).toEqual({ label: 0 });
  });
});

describe("runReport — trial balance (grouping + totals + reconciliation)", () => {
  it("computes account balances as of a date, grouped by account type, with balanced grand totals", () => {
    const outcome = runReport(trialBalance, { asOfDate: "2026-08-22" }, ctx);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");

    // «غير مخصص» totals alongside مدين/دائن and is zero here: this fixture's
    // lines carry no branch at all, so all of it is unattributed — the column
    // reports the net (debit − credit), which for a balanced ledger is zero.
    expect(outcome.grandTotals).toEqual({ debit: 147000, credit: 147000, unattributed: 0 });
    expect(outcome.reconciliation).toEqual({
      labelAr: "إجمالي المدين = إجمالي الدائن",
      reportTotal: 147000,
      referenceTotal: 147000,
      diff: 0,
      withinTolerance: true,
    });

    const assets = outcome.groups.find((g) => g.key === "الأصول");
    expect(assets?.totals).toEqual({ debit: 130000, credit: 0, unattributed: 130000 }); // Cash 122,000 + AR 5,000 + Inventory 3,000 — none of it branch-tagged
    const cash = outcome.rows.find((r) => r.accountId === "1100");
    expect(cash).toMatchObject({ debit: 122000, credit: 0 });
  });

  it("excludes journal lines dated after the as-of date", () => {
    const outcome = runReport(trialBalance, { asOfDate: "2026-01-01" }, ctx);
    if (!outcome.ok) throw new Error("expected success");
    // Only je-1 (open capital) has posted by 2026-01-01.
    expect(outcome.grandTotals).toEqual({ debit: 100000, credit: 100000, unattributed: 0 });
  });

  it("returns validation errors instead of running the query plan for bad params", () => {
    const outcome = runReport(trialBalance, { asOfDate: "not-a-date" }, ctx);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.errors[0]?.field).toBe("asOfDate");
  });
});

describe("runReport — reconciliation mismatch is surfaced, not swallowed", () => {
  interface Row {
    total: number;
  }
  interface Ctx {
    referenceTotal: number;
  }
  const definition: ReportDefinition<{ q: string }, Row, Ctx> = {
    id: "test.mismatch",
    titleAr: "Test",
    paramsSchema: z.object({ q: z.string() }),
    defaultParams: { q: "" },
    paramFields: [],
    rowKey: () => "only-row",
    columns: [{ key: "total", header: "Total", value: (r) => r.total, total: true }],
    reconciliation: {
      labelAr: "Report vs reference",
      computeReportTotal: (rows) => rows.reduce((s, r) => s + r.total, 0),
      computeReferenceTotal: (_rows, ctx) => ctx.referenceTotal,
      toleranceMoney: 0.5,
    },
    run: () => [{ total: 100 }],
  };

  it("flags a diff outside tolerance", () => {
    const outcome = runReport(definition, { q: "" }, { referenceTotal: 90 });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.reconciliation).toEqual({ labelAr: "Report vs reference", reportTotal: 100, referenceTotal: 90, diff: 10, withinTolerance: false });
  });

  it("treats a diff within tolerance as reconciled", () => {
    const outcome = runReport(definition, { q: "" }, { referenceTotal: 99.6 });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });
});
