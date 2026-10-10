import { createHash, randomUUID } from "node:crypto";
import { createPeriodCloseRoutes, reconcileControls, registerPeriodCloseGuard, type PeriodCloseGuard, type PeriodCloseRecord } from "@mezan/api";
import {
  Money,
  PeriodCloseEntryState,
  buildTrialBalanceSnapshot,
  canonicalCloseSummary,
  deriveOpenFxBalances,
  duePeriods,
  evaluatePeriodClose,
  findSequenceGapsInWindow,
  journalDateForPeriod,
  type LedgerRepository,
  type PeriodCloseSources,
  type PeriodCloseWindow,
  type UnsignedPeriodCloseSummary,
} from "@mezan/domain";
import {
  createSqliteAssetRepository,
  createSqliteBankReconciliationStore,
  createSqliteDepreciationRunRepository,
  createSqlitePeriodCloseStore,
  createSqliteRecurringJournalRunRepository,
  createSqliteRecurringJournalSkipRepository,
  createSqliteRecurringJournalTemplateRepository,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

const DEPRECIABLE_ASSET_STATUSES: ReadonlySet<string> = new Set(["active", "under_maintenance"]);
const LEDGER_EFFECTIVE_ENTRY_STATUSES: ReadonlySet<string> = new Set(["posted", "reversed"]);
const FINALIZED_STATEMENT_STATUS = "completed";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayBefore(isoDay: string): string {
  const previous = new Date(`${isoDay}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function withinWindow(date: string, window: PeriodCloseWindow): boolean {
  return date >= window.startDate && date <= window.endDate;
}

function entryStateOf(status: string | null): PeriodCloseEntryState {
  if (status === null) return PeriodCloseEntryState.Missing;
  return LEDGER_EFFECTIVE_ENTRY_STATUSES.has(status) ? PeriodCloseEntryState.Posted : PeriodCloseEntryState.Draft;
}

class LedgerAggregatesUnavailableError extends Error {
  constructor(readonly capability: string) {
    super(`The ledger store does not provide "${capability}", which the period-close checks read.`);
    this.name = "LedgerAggregatesUnavailableError";
  }
}

function ledgerReads(ledger: LedgerRepository) {
  const { accountBalances, listLines } = ledger;
  if (!accountBalances) throw new LedgerAggregatesUnavailableError("accountBalances");
  if (!listLines) throw new LedgerAggregatesUnavailableError("listLines");
  return { accountBalances: accountBalances.bind(ledger), listLines: listLines.bind(ledger) };
}

function buildSources(ctx: BackendModuleContext, closers: { close(): void }[]): PeriodCloseSources & { readonly store: ReturnType<typeof createSqlitePeriodCloseStore> } {
  const { sqlite, stores } = ctx;
  const store = createSqlitePeriodCloseStore(sqlite);
  const bankStatements = createSqliteBankReconciliationStore(sqlite);
  const templates = createSqliteRecurringJournalTemplateRepository(sqlite);
  const runs = createSqliteRecurringJournalRunRepository(sqlite);
  const skips = createSqliteRecurringJournalSkipRepository(sqlite);
  const assets = createSqliteAssetRepository(sqlite);
  const depreciationRuns = createSqliteDepreciationRunRepository(sqlite);
  closers.push(store, bankStatements, templates, runs, skips, assets, depreciationRuns);
  const { queries } = store;
  const ledger = ledgerReads(stores.ledger);

  return {
    store,
    draftCounts: async (window) => queries.draftCounts(window),
    pendingApprovalCounts: async (window) => queries.pendingApprovalCounts(window),

    // Live balances, as `/reconciliation` states them: a sub-ledger has no as-of-date replay, so the tie is "now", and says so.
    async subledgerTies() {
      const asOfDate = today();
      const summary = await reconcileControls(stores.ledger, await ctx.reconciliationControls());
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
      for (const net of (await ledger.accountBalances({ toDate: window.endDate })).values()) {
        if (net.scaled > 0n) debit += net.scaled;
        else credit -= net.scaled;
      }
      return { debit: Money.fromScaled(debit), credit: Money.fromScaled(credit), asOfDate: window.endDate };
    },

    async bankStatements(window) {
      const [statements, treasuryAccounts] = await Promise.all([
        bankStatements.statements.list({ fromDate: window.startDate, toDate: window.endDate }),
        stores.treasuryAccounts.list(),
      ]);
      const accountName = new Map(treasuryAccounts.map((account) => [account.id, account.name]));
      return statements
        .filter((statement) => statement.periodStart <= window.endDate && statement.periodEnd >= window.startDate)
        .map((statement) => ({
          statementId: statement.id,
          label: `${accountName.get(statement.treasuryAccountId) ?? statement.treasuryAccountId} — ${statement.statementNumber ?? statement.id}`,
          periodEnd: statement.periodEnd,
          finalized: statement.status === FINALIZED_STATEMENT_STATUS,
        }));
    },

    async foreignCurrencies(window) {
      const [lines, accounts] = await Promise.all([ledger.listLines({ toDate: window.endDate }), stores.accounts.list()]);
      const open = deriveOpenFxBalances(lines, accounts).filter((balance) => balance.foreignAmount.scaled !== 0n);
      return [...new Set(open.map((balance) => balance.currency))].sort();
    },

    fxRevaluationPosted: async (window) => queries.fxRevaluationEntries(window) > 0,

    async recurringDue(window) {
      const due = [];
      for (const template of await templates.list()) {
        for (const periodKey of duePeriods(template, window.endDate)) {
          if (!withinWindow(journalDateForPeriod(template, periodKey), window)) continue;
          if (await skips.findByTemplateAndPeriod(template.id, periodKey)) continue;
          const run = await runs.findByTemplateAndPeriod(template.id, periodKey);
          due.push({
            templateId: template.id,
            label: template.nameAr,
            periodKey,
            entry: run ? entryStateOf(queries.journalEntryStatus(run.journalEntryId)) : PeriodCloseEntryState.Missing,
          });
        }
      }
      return due;
    },

    async depreciation(window) {
      const period = window.startDate.slice(0, 7);
      const [allAssets, allRuns] = await Promise.all([assets.list(), depreciationRuns.list()]);
      const depreciableAssets = allAssets.filter(
        (asset) => DEPRECIABLE_ASSET_STATUSES.has(asset.status) && asset.depreciationStartDate <= window.endDate,
      ).length;
      const periodRuns = allRuns.filter((run) => run.period === period && run.status !== "cancelled");
      const run = periodRuns.some((r) => r.status === "draft")
        ? PeriodCloseEntryState.Draft
        : periodRuns.length > 0
          ? PeriodCloseEntryState.Posted
          : PeriodCloseEntryState.Missing;
      return { depreciableAssets, run };
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
    const sources = buildSources(ctx, closers);
    const { summaries } = sources.store;
    const ledger = ledgerReads(ctx.stores.ledger);

    const guard: PeriodCloseGuard = {
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

      async recordClose({ period, evaluation, closedBy, overrideReason }: PeriodCloseRecord) {
        const [accounts, opening, closing] = await Promise.all([
          ctx.stores.accounts.list(),
          ledger.accountBalances({ toDate: dayBefore(period.startDate) }),
          ledger.accountBalances({ toDate: period.endDate }),
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
        const sha256 = createHash("sha256").update(canonicalCloseSummary(unsigned)).digest("hex");
        await summaries.save({ ...unsigned, sha256 });
      },

      async listSummaries(periodId) {
        return summaries.list({ periodId });
      },
    };

    registerPeriodCloseGuard(ctx.stores.fiscalPeriods, guard);
    ctx.app.route("/period-close", createPeriodCloseRoutes({ periods: ctx.stores.fiscalPeriods, guard }, ctx.resolveAuthContext));
    for (const closer of closers) ctx.addCloser(closer);
  },
};
