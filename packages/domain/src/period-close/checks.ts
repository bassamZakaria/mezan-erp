import {
  FX_REVALUATION_ALL_CURRENCIES,
  PeriodCloseCheckCode,
  PeriodCloseCheckStatus,
  PeriodCloseDocKind,
  PeriodCloseEntryState,
  PeriodCloseFindingKind,
  PeriodCloseFindingState,
  PeriodCloseFixTarget,
  type PeriodCloseCheckDefinition,
  type PeriodCloseCheckOutcome,
  type PeriodCloseCheckResult,
  type PeriodCloseDocCount,
  type PeriodCloseEvaluation,
  type PeriodCloseFailureReporter,
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

const MAX_LISTED_ITEMS = 20;

type FindingInput = Pick<PeriodCloseFinding, "kind" | "ref" | "state" | "passed" | "fix"> & Partial<PeriodCloseFinding>;

function finding(partial: FindingInput): PeriodCloseFinding {
  return { label: null, count: null, amount: null, asOfDate: null, items: [], ...partial };
}

function outcome(findings: readonly PeriodCloseFinding[], applicable = true): PeriodCloseCheckOutcome {
  if (!applicable) return { status: PeriodCloseCheckStatus.NotApplicable, findings };
  const status = findings.every((f) => f.passed) ? PeriodCloseCheckStatus.Pass : PeriodCloseCheckStatus.Fail;
  return { status, findings };
}

function periodMonthKey(window: PeriodCloseWindow): string {
  return window.startDate.slice(0, 7);
}

const ENTRY_FINDING_STATE: Readonly<Record<PeriodCloseEntryState, PeriodCloseFindingState>> = {
  [PeriodCloseEntryState.Posted]: PeriodCloseFindingState.Ok,
  [PeriodCloseEntryState.Draft]: PeriodCloseFindingState.Draft,
  [PeriodCloseEntryState.Reversed]: PeriodCloseFindingState.Reversed,
  [PeriodCloseEntryState.Missing]: PeriodCloseFindingState.Missing,
};

const GENERAL_BRANCH_REF = "general";
const BANK_ACCOUNT_REF_PREFIX = "account:";

function docCountFindings(
  counts: readonly PeriodCloseDocCount[],
  kind: PeriodCloseFindingKind,
  state: PeriodCloseFindingState,
  fixOf: (docKind: PeriodCloseDocKind) => PeriodCloseFixTarget,
): PeriodCloseFinding[] {
  return counts
    .filter((c) => c.count > 0)
    .map((c) => finding({ kind, ref: c.kind, state, passed: false, fix: fixOf(c.kind), count: c.count }));
}

const draftsCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.Drafts,
  fix: PeriodCloseFixTarget.Journals,
  async evaluate(window, sources) {
    const [counts, payroll] = await Promise.all([sources.draftCounts(window), sources.payrollDue(window)]);
    const findings = docCountFindings(counts, PeriodCloseFindingKind.Drafts, PeriodCloseFindingState.Draft, (k) => PERIOD_CLOSE_DOC_KIND_FIX[k]);
    if (payroll.uncoveredEmployees > 0) {
      findings.push(
        finding({
          kind: PeriodCloseFindingKind.PayrollDue,
          ref: periodMonthKey(window),
          state: payroll.hasUnpostedRun ? PeriodCloseFindingState.Draft : PeriodCloseFindingState.Missing,
          passed: false,
          fix: PeriodCloseFixTarget.Payroll,
          count: payroll.uncoveredEmployees,
          items: [periodMonthKey(window)],
        }),
      );
    }
    return outcome(findings);
  },
};

const pendingApprovalsCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.PendingApprovals,
  fix: PeriodCloseFixTarget.Approvals,
  async evaluate(window, sources) {
    const counts = await sources.pendingApprovalCounts(window);
    return outcome(docCountFindings(counts, PeriodCloseFindingKind.PendingApproval, PeriodCloseFindingState.Pending, () => PeriodCloseFixTarget.Approvals));
  },
};

const tiesCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.SubledgerTies,
  fix: PeriodCloseFixTarget.Reconciliation,
  async evaluate(window, sources) {
    const ties = await sources.subledgerTies(window);
    const findings = ties.map((tie) => {
      const tied = tie.difference.scaled === 0n;
      return finding({
        kind: PeriodCloseFindingKind.Tie,
        ref: tie.key,
        label: tie.label,
        items: [tie.controlAccountId],
        state: tied ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.Mismatch,
        passed: tied,
        fix: PeriodCloseFixTarget.Reconciliation,
        amount: tie.difference,
        asOfDate: tie.asOfDate,
      });
    });
    return outcome(findings, findings.length > 0);
  },
};

const trialBalanceCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.TrialBalance,
  fix: PeriodCloseFixTarget.TrialBalance,
  async evaluate(window, sources) {
    const totals = await sources.trialBalance(window);
    const difference = totals.debit.add(totals.credit.negate());
    const balanced = difference.scaled === 0n;
    return outcome([
      finding({
        kind: PeriodCloseFindingKind.TrialBalance,
        ref: PeriodCloseCheckCode.TrialBalance,
        state: balanced ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.Mismatch,
        passed: balanced,
        fix: PeriodCloseFixTarget.TrialBalance,
        amount: difference,
        asOfDate: totals.asOfDate,
      }),
    ]);
  },
};

const bankCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.BankStatements,
  fix: PeriodCloseFixTarget.BankReconciliation,
  async evaluate(window, sources) {
    const [statements, accounts] = await Promise.all([sources.bankStatements(window), sources.bankAccountsWithMovement(window)]);
    const withStatement = new Set(statements.map((s) => s.treasuryAccountId));
    const findings = statements.map((s) =>
      finding({
        kind: PeriodCloseFindingKind.BankStatement,
        ref: s.statementId,
        label: s.label,
        state: s.finalized ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.NotFinalized,
        passed: s.finalized,
        fix: PeriodCloseFixTarget.BankReconciliation,
        asOfDate: s.periodEnd,
      }),
    );
    for (const account of accounts) {
      if (withStatement.has(account.treasuryAccountId)) continue;
      findings.push(
        finding({
          kind: PeriodCloseFindingKind.BankStatement,
          ref: `${BANK_ACCOUNT_REF_PREFIX}${account.treasuryAccountId}`,
          label: account.label,
          state: PeriodCloseFindingState.Missing,
          passed: false,
          fix: PeriodCloseFixTarget.BankReconciliation,
          asOfDate: window.endDate,
        }),
      );
    }
    return outcome(findings, findings.length > 0);
  },
};

const fxCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.FxRevaluation,
  fix: PeriodCloseFixTarget.Revaluation,
  async evaluate(window, sources) {
    const currencies = await sources.foreignCurrencies(window);
    if (currencies.length === 0) return outcome([], false);
    const revalued = new Set(await sources.fxRevaluedCurrencies(window));
    return outcome(
      currencies.map((currency) => {
        const done = revalued.has(currency) || revalued.has(FX_REVALUATION_ALL_CURRENCIES);
        return finding({
          kind: PeriodCloseFindingKind.ForeignCurrency,
          ref: currency,
          label: currency,
          state: done ? PeriodCloseFindingState.Ok : PeriodCloseFindingState.Missing,
          passed: done,
          fix: PeriodCloseFixTarget.Revaluation,
          asOfDate: window.endDate,
        });
      }),
    );
  },
};

const recurringCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.RecurringJournals,
  fix: PeriodCloseFixTarget.RecurringJournals,
  async evaluate(window, sources) {
    const due = await sources.recurringDue(window);
    const findings = due.map((d) =>
      finding({
        kind: PeriodCloseFindingKind.RecurringTemplate,
        ref: `${d.templateId}:${d.periodKey}`,
        label: d.label,
        state: ENTRY_FINDING_STATE[d.entry],
        passed: d.entry === PeriodCloseEntryState.Posted,
        fix: d.entry === PeriodCloseEntryState.Draft ? PeriodCloseFixTarget.Journals : PeriodCloseFixTarget.RecurringJournals,
        items: [d.periodKey],
      }),
    );
    return outcome(findings, findings.length > 0);
  },
};

const depreciationCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.Depreciation,
  fix: PeriodCloseFixTarget.DepreciationRuns,
  async evaluate(window, sources) {
    const groups = (await sources.depreciation(window)).filter((group) => group.dueAssets > 0);
    const findings = groups.map((group) => {
      const covered = group.uncoveredAssets === 0;
      const open = group.hasDraftRun ? PeriodCloseFindingState.Draft : PeriodCloseFindingState.Missing;
      return finding({
        kind: PeriodCloseFindingKind.DepreciationRun,
        ref: `${periodMonthKey(window)}:${group.branchId ?? GENERAL_BRANCH_REF}`,
        label: group.branchId,
        state: covered ? PeriodCloseFindingState.Ok : open,
        passed: covered,
        fix: PeriodCloseFixTarget.DepreciationRuns,
        count: covered ? group.dueAssets : group.uncoveredAssets,
        items: [periodMonthKey(window)],
      });
    });
    return outcome(findings, findings.length > 0);
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
          ref: `${g.source}:${g.series}`,
          label: g.series,
          state: PeriodCloseFindingState.Missing,
          passed: false,
          fix: PERIOD_CLOSE_DOC_KIND_FIX[g.source],
          count: g.missing.length,
          items: g.missing.slice(0, MAX_LISTED_ITEMS),
        }),
      );
    return outcome(findings);
  },
};

const etaCheck: PeriodCloseCheckDefinition = {
  code: PeriodCloseCheckCode.EtaErrors,
  fix: PeriodCloseFixTarget.Eta,
  async evaluate(window, sources) {
    const errors = await sources.etaErrors(window);
    if (errors.length === 0) return outcome([]);
    return outcome([
      finding({
        kind: PeriodCloseFindingKind.EtaSubmission,
        ref: PeriodCloseCheckCode.EtaErrors,
        state: PeriodCloseFindingState.Missing,
        passed: false,
        fix: PeriodCloseFixTarget.Eta,
        count: errors.length,
        items: errors.slice(0, MAX_LISTED_ITEMS).map((e) => e.internalId),
      }),
    ]);
  },
};

export const PERIOD_CLOSE_CHECKS: readonly PeriodCloseCheckDefinition[] = [
  draftsCheck,
  pendingApprovalsCheck,
  tiesCheck,
  trialBalanceCheck,
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

export interface EvaluatePeriodCloseOptions {
  readonly now: string;
  readonly checks?: readonly PeriodCloseCheckDefinition[];
  readonly onCheckFailure?: PeriodCloseFailureReporter;
}

// A check that cannot be computed must BLOCK the close: reading "could not tell" as "nothing wrong" is the defect this gate exists to remove.
export async function evaluatePeriodClose(
  window: PeriodCloseWindow,
  sources: PeriodCloseSources,
  options: EvaluatePeriodCloseOptions,
): Promise<PeriodCloseEvaluation> {
  const checks = options.checks ?? PERIOD_CLOSE_CHECKS;
  const results = await Promise.all(
    checks.map(async (check): Promise<PeriodCloseCheckResult> => {
      try {
        const result = await check.evaluate(window, sources);
        return { code: check.code, fix: check.fix, ...result };
      } catch (error) {
        options.onCheckFailure?.({ code: check.code, error });
        return { code: check.code, fix: check.fix, status: PeriodCloseCheckStatus.Unavailable, findings: [] };
      }
    }),
  );
  return {
    ...window,
    evaluatedAt: options.now,
    checks: results,
    blocking: results.filter(isBlockingCheck).map((r) => r.code),
  };
}
