import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { PERIOD_CLOSE_CHECKS, evaluatePeriodClose } from "./checks.js";
import {
  FX_REVALUATION_ALL_CURRENCIES,
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
    bankAccountsWithMovement: async () => [],
    payrollDue: async () => ({ dueEmployees: 0, uncoveredEmployees: 0, hasUnpostedRun: false }),
    foreignCurrencies: async () => [],
    fxRevaluedCurrencies: async () => [],
    foreignResidues: async () => [],
    recurringDue: async () => [],
    depreciation: async () => [],
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

describe("evaluatePeriodClose — isolate", () => {
  it("runs every check through the isolation port, and a throwing check stays one unavailable check", async () => {
    let isolated = 0;
    const evaluation = await evaluatePeriodClose(
      JUNE,
      cleanSources({
        trialBalance: async () => {
          throw new Error("statement failed");
        },
      }),
      {
        now: NOW,
        isolate: async (fn) => {
          isolated += 1;
          return fn();
        },
      },
    );
    expect(isolated).toBe(PERIOD_CLOSE_CHECKS.length);
    expect(checkOf(evaluation, PeriodCloseCheckCode.TrialBalance).status).toBe(PeriodCloseCheckStatus.Unavailable);
    expect(checkOf(evaluation, PeriodCloseCheckCode.Drafts).status).toBe(PeriodCloseCheckStatus.Pass);
  });
});

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
    const open = { statementId: "BS-1", treasuryAccountId: "TA-1", label: "البنك الأهلي — 06/2026", periodStart: JUNE.startDate, periodEnd: JUNE.endDate, finalized: false, forced: false, unmatchedLines: 0 };
    expect((await evaluate({ bankStatements: async () => [open] })).blocking).toEqual([PeriodCloseCheckCode.BankStatements]);
    const done = await evaluate({ bankStatements: async () => [{ ...open, finalized: true }] });
    expect(checkOf(done, PeriodCloseCheckCode.BankStatements).status).toBe(PeriodCloseCheckStatus.Pass);
  });

  it("a statement with lines nobody has matched is unreconciled and says how many; with every line matched it is only not finalized", async () => {
    const statement = { statementId: "BS-1", treasuryAccountId: "TA-1", label: "البنك الأهلي — 06/2026", periodStart: JUNE.startDate, periodEnd: JUNE.endDate, finalized: false, forced: false };
    const finding = async (unmatchedLines: number) => checkOf(await evaluate({ bankStatements: async () => [{ ...statement, unmatchedLines }] }), PeriodCloseCheckCode.BankStatements).findings[0];
    expect(await finding(11)).toMatchObject({ state: PeriodCloseFindingState.Unreconciled, count: 11, passed: false });
    expect(await finding(0)).toMatchObject({ state: PeriodCloseFindingState.NotFinalized, count: null, passed: false });
  });

  it("blocks when a bank account moved in the period and has no statement at all", async () => {
    const account = { treasuryAccountId: "TA-1", label: "البنك الأهلي", firstMovementDate: "2026-06-04" };
    const missing = await evaluate({ bankAccountsWithMovement: async () => [account] });
    expect(missing.blocking).toEqual([PeriodCloseCheckCode.BankStatements]);
    expect(checkOf(missing, PeriodCloseCheckCode.BankStatements).findings.map((f) => [f.ref, f.label, f.state])).toEqual([["account:TA-1", "البنك الأهلي", PeriodCloseFindingState.Missing]]);

    const covered = await evaluate({
      bankAccountsWithMovement: async () => [account],
      bankStatements: async () => [{ statementId: "BS-1", treasuryAccountId: "TA-1", label: "البنك الأهلي — 06/2026", periodStart: JUNE.startDate, periodEnd: JUNE.endDate, finalized: true, forced: false, unmatchedLines: 0 }],
    });
    expect(checkOf(covered, PeriodCloseCheckCode.BankStatements).status).toBe(PeriodCloseCheckStatus.Pass);
    expect(checkOf(await evaluate(), PeriodCloseCheckCode.BankStatements).status).toBe(PeriodCloseCheckStatus.NotApplicable);
  });

  describe("a bank account that moved has to be covered to the last day of the month", () => {
    const account = { treasuryAccountId: "TA-1", label: "البنك الأهلي", firstMovementDate: "2026-06-04" };
    const statement = (id: string, periodStart: string, periodEnd: string, over: { finalized?: boolean; forced?: boolean } = {}) => ({
      statementId: id, treasuryAccountId: "TA-1", label: `البنك الأهلي — ${id}`, periodStart, periodEnd, finalized: over.finalized ?? true, forced: over.forced ?? false, unmatchedLines: 0,
    });
    const bank = async (statements: ReturnType<typeof statement>[]) =>
      checkOf(await evaluate({ bankAccountsWithMovement: async () => [account], bankStatements: async () => statements }), PeriodCloseCheckCode.BankStatements);
    const failing = (check: Awaited<ReturnType<typeof bank>>) => check.findings.filter((f) => !f.passed).map((f) => [f.ref, f.state, f.asOfDate]);

    it("a finalized statement for three days does not satisfy the month: the first uncovered day is named", async () => {
      const partial = await bank([statement("BS-1", "2026-06-01", "2026-06-03")]);
      expect(partial.status).toBe(PeriodCloseCheckStatus.Fail);
      expect(failing(partial)).toEqual([["account:TA-1", PeriodCloseFindingState.NotCovered, "2026-06-04"]]);
    });

    it("two finalized statements that meet end to end cover it; a day missing between them does not", async () => {
      expect((await bank([statement("BS-1", "2026-06-01", "2026-06-15"), statement("BS-2", "2026-06-16", "2026-06-30")])).status).toBe(PeriodCloseCheckStatus.Pass);
      const gap = await bank([statement("BS-1", "2026-06-01", "2026-06-15"), statement("BS-2", "2026-06-17", "2026-06-30")]);
      expect(failing(gap)).toEqual([["account:TA-1", PeriodCloseFindingState.NotCovered, "2026-06-16"]]);
    });

    it("coverage is asked from the account's first movement in the month, and a statement running past the month end covers it", async () => {
      expect((await bank([statement("BS-1", "2026-06-04", "2026-07-03")])).status).toBe(PeriodCloseCheckStatus.Pass);
      expect(failing(await bank([statement("BS-1", "2026-06-05", "2026-06-30")]))).toEqual([["account:TA-1", PeriodCloseFindingState.NotCovered, "2026-06-04"]]);
    });

    it("a statement that is not finalized fails once, as itself — the days it spans are not reported a second time as uncovered", async () => {
      const open = await bank([statement("BS-1", "2026-06-01", "2026-06-30", { finalized: false })]);
      expect(failing(open)).toEqual([["BS-1", PeriodCloseFindingState.NotFinalized, "2026-06-30"]]);
      const openAndShort = await bank([statement("BS-1", "2026-06-01", "2026-06-20", { finalized: false })]);
      expect(failing(openAndShort)).toEqual([
        ["BS-1", PeriodCloseFindingState.NotFinalized, "2026-06-20"],
        ["account:TA-1", PeriodCloseFindingState.NotCovered, "2026-06-21"],
      ]);
    });

    it("a statement finalized by force — unmatched lines or a difference left standing — is a failing finding of its own", async () => {
      const forced = await bank([statement("BS-1", "2026-06-01", "2026-06-30", { forced: true })]);
      expect(forced.status).toBe(PeriodCloseCheckStatus.Fail);
      expect(failing(forced)).toEqual([["BS-1", PeriodCloseFindingState.ForcedFinalization, "2026-06-30"]]);
    });
  });

  it("blocks a month whose employees have no posted payroll run, and says whether a run is waiting", async () => {
    const missing = await evaluate({ payrollDue: async () => ({ dueEmployees: 4, uncoveredEmployees: 3, hasUnpostedRun: false }) });
    expect(missing.blocking).toEqual([PeriodCloseCheckCode.Drafts]);
    expect(checkOf(missing, PeriodCloseCheckCode.Drafts).findings.map((f) => [f.kind, f.ref, f.state, f.count, f.fix])).toEqual([
      ["payroll_due", "2026-06", PeriodCloseFindingState.Missing, 3, PeriodCloseFixTarget.Payroll],
    ]);
    const waiting = await evaluate({ payrollDue: async () => ({ dueEmployees: 4, uncoveredEmployees: 4, hasUnpostedRun: true }) });
    expect(checkOf(waiting, PeriodCloseCheckCode.Drafts).findings[0]?.state).toBe(PeriodCloseFindingState.Draft);
    const paid = await evaluate({ payrollDue: async () => ({ dueEmployees: 4, uncoveredEmployees: 0, hasUnpostedRun: false }) });
    expect(checkOf(paid, PeriodCloseCheckCode.Drafts).status).toBe(PeriodCloseCheckStatus.Pass);
  });

  it("asks for an FX revaluation per currency with an open balance, as of the period end", async () => {
    const none = await evaluate({ foreignCurrencies: async () => ["EUR", "USD"] });
    expect(none.blocking).toEqual([PeriodCloseCheckCode.FxRevaluation]);
    expect(checkOf(none, PeriodCloseCheckCode.FxRevaluation).findings.map((f) => [f.ref, f.passed, f.asOfDate])).toEqual([
      ["EUR", false, JUNE.endDate],
      ["USD", false, JUNE.endDate],
    ]);

    const oneOfTwo = await evaluate({ foreignCurrencies: async () => ["EUR", "USD"], fxRevaluedCurrencies: async () => ["USD"] });
    expect(oneOfTwo.blocking).toEqual([PeriodCloseCheckCode.FxRevaluation]);
    expect(checkOf(oneOfTwo, PeriodCloseCheckCode.FxRevaluation).findings.map((f) => f.passed)).toEqual([false, true]);

    const both = await evaluate({ foreignCurrencies: async () => ["EUR", "USD"], fxRevaluedCurrencies: async () => ["EUR", "USD"] });
    expect(both.blocking).toEqual([]);
  });

  it("a revaluation run over every currency satisfies each of them, and no open balance means the check does not apply", async () => {
    const all = await evaluate({ foreignCurrencies: async () => ["EUR", "USD"], fxRevaluedCurrencies: async () => [FX_REVALUATION_ALL_CURRENCIES] });
    expect(all.blocking).toEqual([]);
    const none = await evaluate({ fxRevaluedCurrencies: async () => ["USD"] });
    expect(checkOf(none, PeriodCloseCheckCode.FxRevaluation).status).toBe(PeriodCloseCheckStatus.NotApplicable);
  });

  it("a recurring entry is finished only when POSTED: a draft, a missing one and a reversed one each block", async () => {
    const evaluation = await evaluate({
      recurringDue: async () => [
        { templateId: "RJT-1", label: "إيجار", periodKey: "2026-06", entry: PeriodCloseEntryState.Draft },
        { templateId: "RJT-2", label: "اشتراك", periodKey: "2026-06", entry: PeriodCloseEntryState.Missing },
        { templateId: "RJT-3", label: "تأمين", periodKey: "2026-06", entry: PeriodCloseEntryState.Posted },
        { templateId: "RJT-4", label: "صيانة", periodKey: "2026-06", entry: PeriodCloseEntryState.Reversed },
      ],
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.RecurringJournals]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.RecurringJournals).findings.map((f) => [f.state, f.fix, f.passed])).toEqual([
      [PeriodCloseFindingState.Draft, PeriodCloseFixTarget.Journals, false],
      [PeriodCloseFindingState.Missing, PeriodCloseFixTarget.RecurringJournals, false],
      [PeriodCloseFindingState.Ok, PeriodCloseFixTarget.RecurringJournals, true],
      [PeriodCloseFindingState.Reversed, PeriodCloseFixTarget.RecurringJournals, false],
    ]);
  });

  it("requires every branch's depreciable assets to be covered by a posted run — one branch's run does not clear another", async () => {
    const evaluation = await evaluate({
      depreciation: async () => [
        { branchId: "BR-MAIN", dueAssets: 4, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: [], hasDraftRun: false },
        { branchId: "BR-ALEX", dueAssets: 2, uncoveredAssets: 2, uncoveredAssetCodes: ["AST-1", "AST-2"], doubleChargedAssetCodes: [], hasDraftRun: false },
        { branchId: null, dueAssets: 0, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: [], hasDraftRun: false },
      ],
    });
    expect(evaluation.blocking).toEqual([PeriodCloseCheckCode.Depreciation]);
    expect(checkOf(evaluation, PeriodCloseCheckCode.Depreciation).findings.map((f) => [f.ref, f.passed, f.count, f.state])).toEqual([
      ["2026-06:BR-MAIN", true, 4, PeriodCloseFindingState.Ok],
      ["2026-06:BR-ALEX", false, 2, PeriodCloseFindingState.Missing],
    ]);

    const draft = await evaluate({ depreciation: async () => [{ branchId: null, dueAssets: 3, uncoveredAssets: 3, uncoveredAssetCodes: ["AST-1", "AST-2", "AST-3"], doubleChargedAssetCodes: [], hasDraftRun: true }] });
    expect(checkOf(draft, PeriodCloseCheckCode.Depreciation).findings[0]).toMatchObject({ ref: "2026-06:general", state: PeriodCloseFindingState.Draft, passed: false });

    const covered = await evaluate({ depreciation: async () => [{ branchId: null, dueAssets: 3, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: [], hasDraftRun: false }] });
    expect(covered.blocking).toEqual([]);
    const twice = await evaluate({ depreciation: async () => [{ branchId: "BR-MAIN", dueAssets: 3, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: ["AST-0002"], hasDraftRun: false }] });
    expect(twice.blocking).toEqual([PeriodCloseCheckCode.Depreciation]);
    expect(checkOf(twice, PeriodCloseCheckCode.Depreciation).findings.map((f) => [f.ref, f.passed, f.count, f.state, f.items])).toEqual([
      ["2026-06:BR-MAIN", true, 3, PeriodCloseFindingState.Ok, ["2026-06"]],
      ["2026-06:BR-MAIN:double_charged", false, 1, PeriodCloseFindingState.DoubleCharged, ["2026-06", "AST-0002"]],
    ]);
    const nothingDue = await evaluate({ depreciation: async () => [{ branchId: null, dueAssets: 0, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: [], hasDraftRun: false }] });
    expect(checkOf(nothingDue, PeriodCloseCheckCode.Depreciation).status).toBe(PeriodCloseCheckStatus.NotApplicable);
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
