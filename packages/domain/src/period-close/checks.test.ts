import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { PERIOD_CLOSE_CHECKS, evaluatePeriodClose } from "./checks.js";
import {
  PeriodCloseCheckCode,
  PeriodCloseCheckStatus,
  PeriodCloseDocKind,
  PeriodCloseEntryState,
  PeriodCloseFindingState,
  PeriodCloseFixTarget,
  type PeriodCloseCheckFailure,
  type PeriodCloseEvaluation,
  type PeriodCloseSources,
  type PeriodCloseWindow,
} from "./types.js";

const JUNE: PeriodCloseWindow = { periodId: "fp-2026-06", year: 2026, periodNumber: 6, startDate: "2026-06-01", endDate: "2026-06-30" };
const NOW = "2026-07-02T08:00:00.000Z";

function cleanSources(over: Partial<PeriodCloseSources> = {}): PeriodCloseSources {
  return {
    draftCounts: async () => [{ kind: PeriodCloseDocKind.JournalEntry, count: 0 }],
    pendingApprovalCounts: async () => [{ kind: PeriodCloseDocKind.Voucher, count: 0 }],
    subledgerTies: async () => [{ key: "ar", label: "ذمم العملاء", controlAccountId: "1105", difference: Money.zero(), asOfDate: "2026-07-02" }],
    trialBalance: async () => ({ debit: Money.fromMajor("900.00"), credit: Money.fromMajor("900.00"), asOfDate: JUNE.endDate }),
    bankStatements: async () => [],
    foreignCurrencies: async () => [],
    fxRevaluationPosted: async () => false,
    recurringDue: async () => [],
    depreciation: async () => ({ depreciableAssets: 0, run: PeriodCloseEntryState.Missing }),
    sequenceGaps: async () => [],
    etaErrors: async () => [],
    ...over,
  };
}

function evaluate(over: Partial<PeriodCloseSources> = {}): Promise<PeriodCloseEvaluation> {
  return evaluatePeriodClose(JUNE, cleanSources(over), { now: NOW });
}

function checkOf(evaluation: PeriodCloseEvaluation, code: PeriodCloseCheckCode) {
  const check = evaluation.checks.find((c) => c.code === code);
  if (!check) throw new Error(`check ${code} missing from the evaluation`);
  return check;
}

describe("evaluatePeriodClose", () => {
  it("clears a period with nothing outstanding, and marks the checks that have nothing to judge as not applicable", async () => {
    const evaluation = await evaluate();
    expect(evaluation.blocking).toEqual([]);
    expect(evaluation.checks.map((c) => c.code)).toEqual(PERIOD_CLOSE_CHECKS.map((c) => c.code));
    expect(checkOf(evaluation, PeriodCloseCheckCode.TrialBalance).status).toBe(PeriodCloseCheckStatus.Pass);
    for (const code of [
      PeriodCloseCheckCode.BankStatements,
      PeriodCloseCheckCode.FxRevaluation,
      PeriodCloseCheckCode.RecurringJournals,
      PeriodCloseCheckCode.Depreciation,
    ]) {
      expect(checkOf(evaluation, code).status).toBe(PeriodCloseCheckStatus.NotApplicable);
    }
    expect(evaluation.evaluatedAt).toBe(NOW);
  });

  it("blocks on a draft dated in the period and points at the screen that holds it", async () => {
    const evaluation = await evaluate({
      draftCounts: async () => [
        { kind: PeriodCloseDocKind.JournalEntry, count: 0 },
        { kind: PeriodCloseDocKind.PurchaseInvoice, count: 3 },
      ],
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.Drafts]);
    const [only, ...rest] = checkOf(evaluation, PeriodCloseCheckCode.Drafts).findings;
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ ref: PeriodCloseDocKind.PurchaseInvoice, count: 3, state: PeriodCloseFindingState.Draft, fix: PeriodCloseFixTarget.PurchaseInvoices });
  });

  it("blocks on a document held for approval, separately from drafts", async () => {
    const evaluation = await evaluate({ pendingApprovalCounts: async () => [{ kind: PeriodCloseDocKind.Voucher, count: 2 }] });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.PendingApprovals]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.PendingApprovals).findings[0]).toMatchObject({ count: 2, fix: PeriodCloseFixTarget.Approvals });
  });

  it("blocks when one sub-ledger is off its control account by a single micro-unit, and states the difference", async () => {
    const evaluation = await evaluate({
      subledgerTies: async () => [
        { key: "inventory", label: "المخزون", controlAccountId: "1200", difference: Money.zero(), asOfDate: "2026-07-02" },
        { key: "ap", label: "ذمم الموردين", controlAccountId: "2100", difference: Money.fromScaled(1n), asOfDate: "2026-07-02" },
      ],
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.SubledgerTies]);
    const [inventory, payables] = checkOf(evaluation, PeriodCloseCheckCode.SubledgerTies).findings;
    expect(inventory?.passed).toBe(true);
    expect(payables).toMatchObject({ passed: false, state: PeriodCloseFindingState.Mismatch });
    expect(payables?.amount?.scaled).toBe(1n);
  });

  it("blocks on an unbalanced trial balance and reports debit minus credit", async () => {
    const evaluation = await evaluate({
      trialBalance: async () => ({ debit: Money.fromMajor("900.00"), credit: Money.fromMajor("899.50"), asOfDate: JUNE.endDate }),
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.TrialBalance]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.TrialBalance).findings[0]?.amount?.toString()).toBe("0.500000");
  });

  it("blocks on a bank statement that is not finalized and passes once every one is", async () => {
    const open = { statementId: "BS-1", label: "البنك الأهلي — 06/2026", periodEnd: JUNE.endDate, finalized: false };
    expect((await evaluate({ bankStatements: async () => [open] })).blocking).toEqual([PeriodCloseCheckCode.BankStatements]);
    const done = await evaluate({ bankStatements: async () => [{ ...open, finalized: true }] });
    expect(checkOf(done, PeriodCloseCheckCode.BankStatements).status).toBe(PeriodCloseCheckStatus.Pass);
  });

  it("asks for an FX revaluation only when a foreign balance is open", async () => {
    const missing = await evaluate({ foreignCurrencies: async () => ["EUR", "USD"] });
    expect(missing.blocking).toEqual([PeriodCloseCheckCode.FxRevaluation]);
    expect(checkOf(missing, PeriodCloseCheckCode.FxRevaluation).findings[0]).toMatchObject({ items: ["EUR", "USD"], state: PeriodCloseFindingState.Missing });
    const run = await evaluate({ foreignCurrencies: async () => ["USD"], fxRevaluationPosted: async () => true });
    expect(run.blocking).toEqual([]);
  });

  it("treats a recurring entry that is generated but still a draft as unfinished, and sends the user to journals rather than templates", async () => {
    const evaluation = await evaluate({
      recurringDue: async () => [
        { templateId: "RJT-1", label: "إيجار", periodKey: "2026-06", entry: PeriodCloseEntryState.Draft },
        { templateId: "RJT-2", label: "اشتراك", periodKey: "2026-06", entry: PeriodCloseEntryState.Missing },
        { templateId: "RJT-3", label: "تأمين", periodKey: "2026-06", entry: PeriodCloseEntryState.Posted },
      ],
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.RecurringJournals]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.RecurringJournals).findings.map((f) => [f.state, f.fix, f.passed])).toEqual([
      [PeriodCloseFindingState.Draft, PeriodCloseFixTarget.Journals, false],
      [PeriodCloseFindingState.Missing, PeriodCloseFixTarget.RecurringJournals, false],
      [PeriodCloseFindingState.Ok, PeriodCloseFixTarget.RecurringJournals, true],
    ]);
  });

  it("requires a posted depreciation run when depreciable assets exist", async () => {
    for (const run of [PeriodCloseEntryState.Missing, PeriodCloseEntryState.Draft]) {
      expect((await evaluate({ depreciation: async () => ({ depreciableAssets: 4, run }) })).blocking).toEqual([PeriodCloseCheckCode.Depreciation]);
    }
    const posted = await evaluate({ depreciation: async () => ({ depreciableAssets: 4, run: PeriodCloseEntryState.Posted }) });
    expect(posted.blocking).toEqual([]);
    expect(checkOf(posted, PeriodCloseCheckCode.Depreciation).findings[0]).toMatchObject({ ref: "2026-06", count: 4 });
  });

  it("blocks on a missing document number and lists at most twenty of them", async () => {
    const missing = Array.from({ length: 25 }, (_, i) => `INV-${String(i + 1).padStart(4, "0")}`);
    const evaluation = await evaluate({ sequenceGaps: async () => [{ source: PeriodCloseDocKind.SalesInvoice, series: "INV-#", missing }] });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.SequenceGaps]);
    const finding = checkOf(evaluation, PeriodCloseCheckCode.SequenceGaps).findings[0];
    expect(finding).toMatchObject({ count: 25, fix: PeriodCloseFixTarget.SalesInvoices });
    expect(finding?.items).toHaveLength(20);
  });

  it("blocks on e-invoice submissions left in error", async () => {
    const evaluation = await evaluate({ etaErrors: async () => [{ internalId: "INV-1" }, { internalId: "INV-2" }] });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.EtaErrors]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.EtaErrors).findings[0]).toMatchObject({ count: 2, items: ["INV-1", "INV-2"] });
  });

  it("a check whose source throws BLOCKS as unavailable, is reported, and does not stop the others", async () => {
    const failures: PeriodCloseCheckFailure[] = [];
    const boom = new Error("database is locked");
    const evaluation = await evaluatePeriodClose(
      JUNE,
      cleanSources({
        trialBalance: async () => {
          throw boom;
        },
        draftCounts: async () => [{ kind: PeriodCloseDocKind.Voucher, count: 1 }],
      }),
      { now: NOW, onCheckFailure: (failure) => failures.push(failure) },
    );
    expect(checkOf(evaluation, PeriodCloseCheckCode.TrialBalance).status).toBe(PeriodCloseCheckStatus.Unavailable);
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.Drafts, PeriodCloseCheckCode.TrialBalance]);
    expect(failures).toEqual([{ code: PeriodCloseCheckCode.TrialBalance, error: boom }]);
  });
});
