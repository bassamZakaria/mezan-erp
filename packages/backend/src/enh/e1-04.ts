import { randomUUID } from "node:crypto";
import {
  createPeriodCloseGuard,
  createPeriodCloseRoutes,
  reconcileControls,
  sealPeriodCloseSummary,
  verifyPeriodCloseSeal,
  type PeriodCloseSummaryInput,
} from "@mezan/api";
import {
  Money,
  PeriodCloseEntryState,
  buildTrialBalanceSnapshot,
  computeMonthlyDepreciation,
  DEPRECIABLE_ASSET_STATUSES,
  createDefaultSettings,
  dayBefore,
  deriveOpenFxBalances,
  duePeriods,
  evaluatePeriodClose,
  findSequenceGapsInWindow,
  inServiceDuring,
  payrollEligibility,
  payrollCapabilities,
  BASE_CURRENCY,
  journalDateForPeriod,
  type Asset,
  type LedgerRepository,
  type PeriodCloseDepreciationGroup,
  type PeriodCloseSources,
  type PeriodCloseSummary,
  type PeriodCloseWindow,
  type PostedLine,
  type UnsignedPeriodCloseSummary,
} from "@mezan/domain";
import {
  createSqliteAssetRepository,
  createSqliteContractRepository,
  createSqliteDepreciationRunRepository,
  createSqlitePeriodCloseStore,
  createSqliteRecurringJournalTemplateRepository,
  type PeriodCloseFxLineGroup,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

enum SourceStatus {
  Active = "active",
  Disposed = "disposed",
  Draft = "draft",
  Posted = "posted",
  Reversed = "reversed",
}

enum AssetScope {
  Branch = "branch",
}

const SYSTEM_SOURCE = "system";
const ASSET_IN_SERVICE: Asset["status"] = "active";

class LedgerAggregatesUnavailableError extends Error {
  constructor(readonly capability: string) {
    super(`The ledger store does not provide "${capability}", which the period-close checks read.`);
    this.name = "LedgerAggregatesUnavailableError";
  }
}

function ledgerBalances(ledger: LedgerRepository) {
  const { accountBalances } = ledger;
  if (!accountBalances) throw new LedgerAggregatesUnavailableError("accountBalances");
  return accountBalances.bind(ledger);
}

function withinWindow(date: string, window: PeriodCloseWindow): boolean {
  return date >= window.startDate && date <= window.endDate;
}

function recurringEntryState(status: string | null | undefined): PeriodCloseEntryState {
  if (status === SourceStatus.Posted) return PeriodCloseEntryState.Posted;
  if (status === SourceStatus.Reversed) return PeriodCloseEntryState.Reversed;
  if (status === SourceStatus.Draft) return PeriodCloseEntryState.Draft;
  return PeriodCloseEntryState.Missing;
}

function pairKey(templateId: string, period: string): string {
  return JSON.stringify([templateId, period]);
}

function asPostedLine(group: PeriodCloseFxLineGroup, date: string): PostedLine {
  return {
    entryId: "",
    entryNo: null,
    date,
    source: SYSTEM_SOURCE,
    accountId: group.accountId,
    costCenterId: null,
    projectId: null,
    costCategory: null,
    branchId: null,
    currency: group.currency,
    fxRate: group.fxRate,
    memo: group.memo,
    debit: group.debit,
    credit: group.credit,
  };
}

const NO_PAYROLL_DUE = { dueEmployees: 0, uncoveredEmployees: 0, hasUnpostedRun: false } as const;

function depreciationBranch(asset: Asset): string | null {
  return asset.scope === AssetScope.Branch ? asset.branchId : null;
}

function buildSources(ctx: BackendModuleContext, store: ReturnType<typeof createSqlitePeriodCloseStore>, closers: { close(): void }[]): PeriodCloseSources {
  const { sqlite, stores } = ctx;
  const templates = createSqliteRecurringJournalTemplateRepository(sqlite);
  const assets = createSqliteAssetRepository(sqlite);
  const depreciationRuns = createSqliteDepreciationRunRepository(sqlite);
  const contracts = createSqliteContractRepository(sqlite);
  closers.push(templates, assets, depreciationRuns, contracts);
  const { queries, fxRuns } = store;
  const accountBalances = ledgerBalances(stores.ledger);

  // A currency is foreign-and-open when a monetary account still holds some of it. A treasury line posted before lines carried a currency is read at the rate of its own day; one whose day has no approved rate cannot be read at all, and its currency stays listed until a rate is entered.
  async function foreignCurrencies(window: PeriodCloseWindow): Promise<string[]> {
    const tagged = queries.openFxLineGroups(window.endDate).map((group) => asPostedLine(group, window.endDate));
    const unreadable = new Set<string>();
    const derived: PostedLine[] = [];
    for (const group of queries.untaggedTreasuryLineGroups(window.endDate)) {
      const fxRate = await ctx.treasuryFx.rateOn(group.currency, group.date);
      if (fxRate) derived.push(asPostedLine({ accountId: group.accountId, currency: group.currency, fxRate, memo: null, debit: group.debit, credit: group.credit }, group.date));
      else if (group.debit.scaled !== group.credit.scaled) unreadable.add(group.currency);
    }
    const open = deriveOpenFxBalances([...tagged, ...derived], await stores.accounts.list()).filter((balance) => balance.foreignAmount.scaled !== 0n);
    return [...new Set([...open.map((balance) => balance.currency), ...unreadable])].sort();
  }

  return {
    draftCounts: async (window) => queries.draftCounts(window),
    pendingApprovalCounts: async (window) => queries.pendingApprovalCounts(window),

    async subledgerTies(window) {
      const asOfDate = window.endDate;
      const summary = await reconcileControls(stores.ledger, await ctx.reconciliationControls(asOfDate), asOfDate);
      return summary.rows.map((row) => ({
        key: row.key,
        label: row.label,
        controlAccountId: row.controlAccountId,
        difference: row.difference,
        asOfDate,
      }));
    },

    async trialBalance(window) {
      let debit = 0n;
      let credit = 0n;
      for (const net of (await accountBalances({ toDate: window.endDate })).values()) {
        if (net.scaled > 0n) debit += net.scaled;
        else credit -= net.scaled;
      }
      return { debit: Money.fromScaled(debit), credit: Money.fromScaled(credit), asOfDate: window.endDate };
    },

    async bankStatements(window) {
      return queries.bankStatementsOverlapping(window).map((statement) => ({
        statementId: statement.statementId,
        treasuryAccountId: statement.treasuryAccountId,
        label: `${statement.treasuryAccountName ?? statement.statementId} — ${statement.statementNumber ?? statement.statementId}`,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        finalized: statement.finalized,
        forced: statement.forced,
      }));
    },

    bankAccountsWithMovement: async (window) =>
      queries.bankAccountsWithMovement(window).map((account) => ({ treasuryAccountId: account.treasuryAccountId, label: account.name, firstMovementDate: account.firstMovementDate })),
    // Who a run for the month would pay — the run's own predicate and bindings, asked of the month — less whoever a posted run has paid.
    async payrollDue(window) {
      const period = { periodStart: window.startDate, periodEnd: window.endDate };
      const capabilities = payrollCapabilities(ctx.payrollBindings, BASE_CURRENCY);
      const { paidEmployeeIds, hasUnpostedRun, partMonthTaxedPayslips } = queries.payrollRuns(window);
      const paid = new Set(paidEmployeeIds);
      let dueEmployees = 0;
      let uncoveredEmployees = 0;
      for (const employee of await stores.employees.list()) {
        if (!inServiceDuring(employee, period)) continue;
        if (!payrollEligibility(employee, await contracts.listByEmployeeId(employee.id), period, capabilities).payable) continue;
        dueEmployees += 1;
        if (!paid.has(employee.id)) uncoveredEmployees += 1;
      }
      return { dueEmployees, uncoveredEmployees, hasUnpostedRun, partMonthTaxedPayslips };
    },

    foreignCurrencies,
    fxRevaluedCurrencies: async (window) => fxRuns.currenciesRevaluedAsOf(window.endDate),

    async recurringDue(window) {
      const runStatus = new Map(queries.recurringRuns().map((run) => [pairKey(run.templateId, run.period), run.entryStatus]));
      const skipped = new Set(queries.recurringSkips().map((skip) => pairKey(skip.templateId, skip.period)));
      const due = [];
      for (const template of await templates.list()) {
        for (const periodKey of duePeriods(template, window.endDate)) {
          if (!withinWindow(journalDateForPeriod(template, periodKey), window)) continue;
          const key = pairKey(template.id, periodKey);
          if (skipped.has(key)) continue;
          due.push({ templateId: template.id, label: template.nameAr, periodKey, entry: recurringEntryState(runStatus.get(key)) });
        }
      }
      return due;
    },

    async depreciation(window) {
      const periodKey = window.startDate.slice(0, 7);
      const period = { year: window.year, month: Number(periodKey.slice(5, 7)) };
      const [allAssets, allRuns] = await Promise.all([assets.list(), depreciationRuns.list()]);
      const periodRuns = allRuns.filter((run) => run.period === periodKey);
      const postedLines = periodRuns.filter((run) => run.status === SourceStatus.Posted).flatMap((run) => run.lines.map((line) => line.assetId));
      const covered = new Set(postedLines);
      const doubleCharged = new Set(postedLines.filter((assetId, index) => postedLines.indexOf(assetId) !== index));
      const hasDraftRun = periodRuns.some((run) => run.status === SourceStatus.Draft);
      const disposedOn = new Map(queries.assetDisposalDates().map((disposal) => [disposal.assetId, disposal.date]));
      const inServiceAtPeriodEnd = (asset: Asset): boolean =>
        DEPRECIABLE_ASSET_STATUSES.has(asset.status) || (asset.status === SourceStatus.Disposed && (disposedOn.get(asset.id) ?? "") > window.endDate);
      const groups = new Map<string | null, { dueAssets: number; uncoveredAssets: number; uncoveredAssetCodes: string[]; doubleChargedAssetCodes: string[] }>();
      for (const asset of allAssets) {
        const due =
          covered.has(asset.id) ||
          (inServiceAtPeriodEnd(asset) && computeMonthlyDepreciation({ ...asset, status: ASSET_IN_SERVICE }, period).amount.scaled > 0n);
        if (!due) continue;
        const branchId = depreciationBranch(asset);
        const group = groups.get(branchId) ?? { dueAssets: 0, uncoveredAssets: 0, uncoveredAssetCodes: [], doubleChargedAssetCodes: [] };
        group.dueAssets += 1;
        if (!covered.has(asset.id)) {
          group.uncoveredAssets += 1;
          group.uncoveredAssetCodes.push(asset.code);
        }
        if (doubleCharged.has(asset.id)) group.doubleChargedAssetCodes.push(asset.code);
        groups.set(branchId, group);
      }
      return [...groups.entries()].map(([branchId, group]): PeriodCloseDepreciationGroup => ({ branchId, ...group, hasDraftRun }));
    },

    async sequenceGaps(window) {
      return queries
        .numberedDocuments(window)
        .flatMap(({ kind, documents }) => findSequenceGapsInWindow(documents, window).map((gap) => ({ source: kind, series: gap.series, missing: gap.missing })));
    },

    etaErrors: async (window) => queries.etaErrorIds(window).map((internalId) => ({ internalId })),
  };
}

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const closers: { close(): void }[] = [];
    const store = createSqlitePeriodCloseStore(ctx.sqlite);
    closers.push(store);
    const sources = buildSources(ctx, store, closers);
    const accountBalances = ledgerBalances(ctx.stores.ledger);
    const { appendSync } = ctx.audit;
    const appendAudit = appendSync ? appendSync.bind(ctx.audit) : null;

    async function buildSummary({ period, evaluation, closedBy, overrideReason }: PeriodCloseSummaryInput): Promise<PeriodCloseSummary> {
      const [accounts, opening, closing] = await Promise.all([
        ctx.stores.accounts.list(),
        accountBalances({ toDate: dayBefore(period.startDate) }),
        accountBalances({ toDate: period.endDate }),
      ]);
      const snapshot = buildTrialBalanceSnapshot(accounts, opening, closing);
      const unsigned: UnsignedPeriodCloseSummary = {
        id: randomUUID(),
        periodId: period.id,
        year: period.year,
        periodNumber: period.periodNumber,
        startDate: period.startDate,
        endDate: period.endDate,
        closedBy,
        closedAt: new Date().toISOString(),
        overrideReason,
        failedChecks: evaluation.blocking,
        checks: evaluation.checks,
        trialBalance: snapshot.rows,
        totals: snapshot.totals,
      };
      return { ...unsigned, sha256: sealPeriodCloseSummary(unsigned) };
    }

    const guard = createPeriodCloseGuard({
      periods: ctx.stores.fiscalPeriods,
      evaluate(period, scope) {
        const window: PeriodCloseWindow = {
          periodId: period.id,
          year: period.year,
          periodNumber: period.periodNumber,
          startDate: period.startDate,
          endDate: period.endDate,
        };
        return evaluatePeriodClose(window, scope.payrollEntitled ? sources : { ...sources, payrollDue: async () => NO_PAYROLL_DUE }, {
          now: new Date().toISOString(),
          onCheckFailure: ({ code, error }) => console.error(`[period-close] check "${code}" could not be evaluated for ${period.id}`, error),
        });
      },
      buildSummary,
      lastClosedBy: async (periodId) => store.queries.lastAuditedCloser(periodId) ?? (await store.summaries.list({ periodId }))[0]?.closedBy ?? null,
      singleOperatorMode: async () => ((await ctx.stores.settings.get()) ?? createDefaultSettings()).periodCloseSingleOperatorMode,
      async listSummaries(periodId) {
        const audited = new Set(store.queries.auditedSeals(periodId));
        return (await store.summaries.list({ periodId })).map((summary) => ({ summary, sealValid: verifyPeriodCloseSeal(summary, audited) }));
      },
      changeToken: store.critical.changeToken,
      commit: appendAudit ? (request) => store.critical.commit({ ...request, appendAudit }) : null,
    });

    ctx.periodCloseGuard.register(guard);
    ctx.app.route("/period-close", createPeriodCloseRoutes({ periods: ctx.stores.fiscalPeriods, guard: ctx.periodCloseGuard.source }, ctx.resolveAuthContext));
    for (const closer of closers) ctx.addCloser(closer);
  },
};
