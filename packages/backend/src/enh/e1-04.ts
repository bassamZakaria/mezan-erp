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
  createDefaultSettings,
  dayBefore,
  deriveOpenFxBalances,
  duePeriods,
  evaluatePeriodClose,
  findSequenceGapsInWindow,
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
  createSqliteDepreciationRunRepository,
  createSqlitePeriodCloseStore,
  createSqliteRecurringJournalTemplateRepository,
  type PeriodCloseFxLineGroup,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

enum SourceStatus {
  Active = "active",
  Draft = "draft",
  Posted = "posted",
  Reversed = "reversed",
}

enum AssetScope {
  Branch = "branch",
}

const SYSTEM_SOURCE = "system";

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

// A recurring entry that was posted and then reversed is NOT in the books for its period, unlike an FX revaluation whose reversal is the design.
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

function depreciationBranch(asset: Asset): string | null {
  return asset.scope === AssetScope.Branch ? asset.branchId : null;
}

function buildSources(ctx: BackendModuleContext, store: ReturnType<typeof createSqlitePeriodCloseStore>, closers: { close(): void }[]): PeriodCloseSources {
  const { sqlite, stores } = ctx;
  const templates = createSqliteRecurringJournalTemplateRepository(sqlite);
  const assets = createSqliteAssetRepository(sqlite);
  const depreciationRuns = createSqliteDepreciationRunRepository(sqlite);
  closers.push(templates, assets, depreciationRuns);
  const { queries, fxRuns } = store;
  const accountBalances = ledgerBalances(stores.ledger);

  async function foreignCurrencies(window: PeriodCloseWindow): Promise<string[]> {
    const lines = queries.openFxLineGroups(window.endDate).map((group) => asPostedLine(group, window.endDate));
    const open = deriveOpenFxBalances(lines, await stores.accounts.list()).filter((balance) => balance.foreignAmount.scaled !== 0n);
    return [...new Set([...open.map((balance) => balance.currency), ...queries.foreignTreasuryCurrencies(window.endDate)])].sort();
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
        periodEnd: statement.periodEnd,
        finalized: statement.finalized,
      }));
    },

    bankAccountsWithMovement: async (window) =>
      queries.bankAccountsWithMovement(window).map((account) => ({ treasuryAccountId: account.treasuryAccountId, label: account.name })),
    payrollDue: async (window) => queries.payrollDue(window),

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

    // Judged per ASSET: a run is per (period, branch), so "some run exists" says nothing about a branch it did not cover.
    async depreciation(window) {
      const periodKey = window.startDate.slice(0, 7);
      const period = { year: window.year, month: Number(periodKey.slice(5, 7)) };
      const [allAssets, allRuns] = await Promise.all([assets.list(), depreciationRuns.list()]);
      const periodRuns = allRuns.filter((run) => run.period === periodKey);
      const covered = new Set(periodRuns.filter((run) => run.status === SourceStatus.Posted).flatMap((run) => run.lines.map((line) => line.assetId)));
      const hasDraftRun = periodRuns.some((run) => run.status === SourceStatus.Draft);
      const groups = new Map<string | null, { dueAssets: number; uncoveredAssets: number }>();
      for (const asset of allAssets) {
        const due =
          covered.has(asset.id) || (asset.status === SourceStatus.Active && computeMonthlyDepreciation(asset, period).amount.scaled > 0n);
        if (!due) continue;
        const branchId = depreciationBranch(asset);
        const group = groups.get(branchId) ?? { dueAssets: 0, uncoveredAssets: 0 };
        group.dueAssets += 1;
        if (!covered.has(asset.id)) group.uncoveredAssets += 1;
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
      evaluate(period) {
        const window: PeriodCloseWindow = {
          periodId: period.id,
          year: period.year,
          periodNumber: period.periodNumber,
          startDate: period.startDate,
          endDate: period.endDate,
        };
        return evaluatePeriodClose(window, sources, {
          now: new Date().toISOString(),
          onCheckFailure: ({ code, error }) => console.error(`[period-close] check "${code}" could not be evaluated for ${period.id}`, error),
        });
      },
      buildSummary,
      lastClosedBy: async (periodId) => (await store.summaries.list({ periodId }))[0]?.closedBy ?? null,
      singleOperatorMode: async () => ((await ctx.stores.settings.get()) ?? createDefaultSettings()).contractingSingleOperatorMode,
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
