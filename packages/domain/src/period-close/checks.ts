import {
  PeriodCloseCheckCode,
  PeriodCloseCheckStatus,
  PeriodCloseDocKind,
  PeriodCloseEntryState,
  PeriodCloseFindingKind,
  PeriodCloseFindingState,
  PeriodCloseFixTarget,
  PeriodCloseTieKey,
  type PeriodCloseCheckDefinition,
  type PeriodCloseCheckResult,
  type PeriodCloseEvaluation,
  type PeriodCloseFinding,
  type PeriodCloseSources,
  type PeriodCloseWindow,
} from "./types.js";

export const PERIOD_CLOSE_DOC_KIND_FIX: Readonly<Record<PeriodCloseDocKind, PeriodCloseFixTarget>> = {
  [PeriodCloseDocKind.JournalEntry]: PeriodCloseFixTarget.Journals,
  [PeriodCloseDocKind.SalesInvoice]: PeriodCloseFixTarget.SalesInvoices,
  [PeriodCloseDocKind.PurchaseInvoice]: PeriodCloseFixTarget.PurchaseInvoices,
  [PeriodCloseDocKind.GoodsReceipt]: PeriodCloseFixTarget.GoodsReceipts,
  [PeriodCloseDocKind.Voucher]: PeriodCloseFixTarget.TreasuryVouchers,
  [PeriodCloseDocKind.SalesReturn]: PeriodCloseFixTarget.SalesReturns,
  [PeriodCloseDocKind.PurchaseReturn]: PeriodCloseFixTarget.PurchaseReturns,
  [PeriodCloseDocKind.LandedCost]: PeriodCloseFixTarget.LandedCosts,
  [PeriodCloseDocKind.StockTransfer]: PeriodCloseFixTarget.StockTransfers,
  [PeriodCloseDocKind.StockAdjustment]: PeriodCloseFixTarget.StockAdjustments,
  [PeriodCloseDocKind.DepreciationRun]: PeriodCloseFixTarget.DepreciationRuns,
  [PeriodCloseDocKind.WritedownRun]: PeriodCloseFixTarget.WritedownRuns,
  [PeriodCloseDocKind.PayrollRun]: PeriodCloseFixTarget.Payroll,
};

export const PERIOD_CLOSE_TIE_FIX: Readonly<Record<PeriodCloseTieKey, PeriodCloseFixTarget>> = {
  [PeriodCloseTieKey.Receivables]: PeriodCloseFixTarget.AgingCustomers,
  [PeriodCloseTieKey.Payables]: PeriodCloseFixTarget.AgingSuppliers,
  [PeriodCloseTieKey.Inventory]: PeriodCloseFixTarget.Reconciliation,
  [PeriodCloseTieKey.TrialBalance]: PeriodCloseFixTarget.TrialBalance,
};

function finding(partial: Pick<PeriodCloseFinding, "kind" | "ref" | "state" | "passed" | "fix"> & Partial<PeriodCloseFinding>): PeriodCloseFinding {
  return {
    label: null,
    count: null,
    amount: null,
    asOfDate: null,
    items: [],
    ...partial,
  };
}

function statusOf(findings: readonly PeriodCloseFinding[], applicable = true): PeriodCloseCheckStatus {
  if (!applicable) return PeriodCloseCheckStatus.NotApplicable;
  if (findings.some((f) => f.state === PeriodCloseFindingState.Unavailable)) return PeriodCloseCheckStatus.Unavailable;
  return findings.every((f) => f.passed) ? PeriodCloseCheckStatus.Pass : PeriodCloseCheckStatus.Fail;
}

function periodMonthKey(window: PeriodCloseWindow): string {
  return window.startDate.slice(0, 7);
}

const draftsCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.Drafts,
  fix: PeriodCloseFixTarget.Journals,
  async evaluate(window, sources) {
    const counts = await sources.draftCounts(window);
    const findings = counts
      .filter((c) => c.count > 0)
      .map((c) =>
        finding({
          kind: PeriodCloseFindingKind.Drafts,
          ref: c.kind,
          state: PeriodCloseFindingState.Draft,
          passed: false,
          fix: PERIOD_CLOSE_DOC_KIND_FIX[c.kind],
          count: c.count,
        }),
      );
    return { status: statusOf(findings), findings };
  },
};

const tiesCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.SubledgerTies,
  fix: PeriodCloseFixTarget.Reconciliation,
  async evaluate(window, sources) {
    const ties = await sources.subledgerTies(window);
    const findings = ties.map((tie) => {
      if (tie.difference === null) {
        return finding({
          kind: PeriodCloseFindingKind.Tie,
          ref: tie.key,
          state: PeriodCloseFindingState.Unavailable,
          passed: false,
          fix: PERIOD_CLOSE_TIE_FIX[tie.key],
          asOfDate: tie.asOfDate,
          label: tie.unavailableReason,
        });
      }
      const tied = tie.difference.scaled === 0n;
      return finding({
        kind: PeriodCloseFindingKind.Tie,
        ref: tie.key,
        state: tied ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.Mismatch,
        passed: tied,
        fix: PERIOD_CLOSE_TIE_FIX[tie.key],
        amount: tie.difference,
        asOfDate: tie.asOfDate,
      });
    });
    return { status: statusOf(findings), findings };
  },
};

const bankCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.BankStatements,
  fix: PeriodCloseFixTarget.BankReconciliation,
  async evaluate(window, sources) {
    const accounts = (await sources.bankAccounts(window)).filter((a) => a.hasActivity || a.finalizedThrough !== null);
    const findings = accounts.map((a) => {
      const through = a.finalizedThrough !== null && a.finalizedThrough >= window.endDate;
      return finding({
        kind: PeriodCloseFindingKind.BankAccount,
        ref: a.treasuryAccountId,
        label: a.label,
        state: through ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.NotFinalized,
        passed: through,
        fix: PeriodCloseFixTarget.BankReconciliation,
        asOfDate: a.finalizedThrough,
      });
    });
    return { status: statusOf(findings, findings.length > 0), findings };
  },
};

const fxCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.FxRevaluation,
  fix: PeriodCloseFixTarget.Revaluation,
  async evaluate(window, sources) {
    const currencies = await sources.foreignCurrencies(window);
    if (currencies.length === 0) return { status: PeriodCloseCheckStatus.NotApplicable, findings: [] };
    const posted = await sources.fxRevaluationPosted(window);
    const findings = [
      finding({
        kind: PeriodCloseFindingKind.ForeignCurrency,
        ref: currencies.join(","),
        state: posted ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.Missing,
        passed: posted,
        fix: PeriodCloseFixTarget.Revaluation,
        items: currencies,
        asOfDate: window.endDate,
      }),
    ];
    return { status: statusOf(findings), findings };
  },
};

const recurringCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.RecurringJournals,
  fix: PeriodCloseFixTarget.RecurringJournals,
  async evaluate(window, sources) {
    const due = await sources.recurringDue(window);
    const findings = due.map((d) => {
      const posted = d.entry === PeriodCloseEntryState.Posted;
      return finding({
        kind: PeriodCloseFindingKind.RecurringTemplate,
        ref: d.templateId,
        label: d.label,
        state: posted ? PeriodCloseFindingState.Ok : d.entry === PeriodCloseEntryState.Draft ? PeriodCloseFindingState.Draft : PeriodCloseFindingState.Missing,
        passed: posted,
        fix: d.entry === PeriodCloseEntryState.Draft ? PeriodCloseFixTarget.Journals : PeriodCloseFixTarget.RecurringJournals,
        items: [d.periodKey],
      });
    });
    return { status: statusOf(findings, findings.length > 0), findings };
  },
};

const depreciationCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.Depreciation,
  fix: PeriodCloseFixTarget.DepreciationRuns,
  async evaluate(window, sources) {
    const state = await sources.depreciation(window);
    if (state.depreciableAssets === 0) return { status: PeriodCloseCheckStatus.NotApplicable, findings: [] };
    const posted = state.run === PeriodCloseEntryState.Posted;
    const findings = [
      finding({
        kind: PeriodCloseFindingKind.DepreciationRun,
        ref: periodMonthKey(window),
        state: posted ? PeriodCloseFindingState.Ok : state.run === PeriodCloseEntryState.Draft ? PeriodCloseFindingState.Draft : PeriodCloseFindingState.Missing,
        passed: posted,
        fix: PeriodCloseFixTarget.DepreciationRuns,
        count: state.depreciableAssets,
      }),
    ];
    return { status: statusOf(findings), findings };
  },
};

const sequenceCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.SequenceGaps,
  fix: null,
  async evaluate(window, sources) {
    const gaps = await sources.sequenceGaps(window);
    const findings = gaps
      .filter((g) => g.missing.length > 0)
      .map((g) =>
        finding({
          kind: PeriodCloseFindingKind.SequenceGap,
          ref: g.source,
          label: g.series,
          state: PeriodCloseFindingState.Missing,
          passed: false,
          fix: PERIOD_CLOSE_DOC_KIND_FIX[g.source],
          count: g.missing.length,
          items: g.missing.slice(0, 20),
        }),
      );
    return { status: statusOf(findings), findings };
  },
};

const etaCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.EtaErrors,
  fix: PeriodCloseFixTarget.Eta,
  async evaluate(window, sources) {
    const errors = await sources.etaErrors(window);
    const findings =
      errors.length === 0
        ? []
        : [
            finding({
              kind: PeriodCloseFindingKind.EtaSubmission,
              ref: "error",
              state: PeriodCloseFindingState.Missing,
              passed: false,
              fix: PeriodCloseFixTarget.Eta,
              count: errors.length,
              items: errors.slice(0, 20).map((e) => e.internalId),
            }),
          ];
    return { status: statusOf(findings), findings };
  },
};

export const PERIOD_CLOSE_CHECKS: readonly PeriodCloseCheckDefinition[] = [
  draftsCheck,
  tiesCheck,
  bankCheck,
  fxCheck,
  recurringCheck,
  depreciationCheck,
  sequenceCheck,
  etaCheck,
];

export function isBlockingCheck(result: Pick<PeriodCloseCheckResult, "status">): boolean {
  return result.status === PeriodCloseCheckStatus.Fail || result.status === PeriodCloseCheckStatus.Unavailable;
}

export async function evaluatePeriodClose(
  window: PeriodCloseWindow,
  sources: PeriodCloseSources,
  now: string,
  checks: readonly PeriodCloseCheckDefinition[] = PERIOD_CLOSE_CHECKS,
): Promise<PeriodCloseEvaluation> {
  const results = await Promise.all(
    checks.map(async (check): Promise<PeriodCloseCheckResult> => {
      try {
        const outcome = await check.evaluate(window, sources);
        return { code: check.code, fix: check.fix, message: null, ...outcome };
      } catch (err) {
        return {
          code: check.code,
          fix: check.fix,
          status: PeriodCloseCheckStatus.Unavailable,
          findings: [],
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return {
    ...window,
    evaluatedAt: now,
    checks: results,
    blocking: results.filter(isBlockingCheck).map((r) => r.code),
  };
}
