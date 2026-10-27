import { createEvidencePackRoutes } from "@mezan/api";
import { createDefaultSettings, type Money } from "@mezan/domain";
import { createSqliteEvidencePackStore, resolveEvidenceSigningSeed, type AuditChainVerifyPort, createEvidencePackStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

const AUDIT_PREFIX = "/audit";

class LedgerBalancesUnavailableError extends Error {
  constructor() {
    super('The ledger store does not provide "accountBalances", which the evidence pack trial balance reads.');
    this.name = "LedgerBalancesUnavailableError";
  }
}

export class EvidenceSigningSeedUnavailableError extends Error {
  constructor() {
    super("The evidence pack signing key has no source on this database: no database key and no database file.");
    this.name = "EvidenceSigningSeedUnavailableError";
  }
}

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const store = ctx.store((s) => createSqliteEvidencePackStore(s), (d) => createEvidencePackStore(d));
    let seed: string | null = null;
    const signingSeed = (): string => {
      if (seed) return seed;
      if (!ctx.sqlite && !ctx.databaseKey) throw new EvidenceSigningSeedUnavailableError();
      return (seed = resolveEvidenceSigningSeed(ctx.sqlite!, ctx.databaseKey));
    };
    const { accountBalances } = ctx.stores.ledger;
    if (!accountBalances) throw new LedgerBalancesUnavailableError();
    const chain = ctx.audit as Partial<AuditChainVerifyPort>;

    ctx.app.route(
      AUDIT_PREFIX,
      createEvidencePackRoutes(
        {
          store,
          signingSeed,
          companyName: async () => ((await ctx.stores.settings.get()) ?? createDefaultSettings()).companyName,
          uow: ctx.uow,
          audit: ctx.audit,
          auditChain: async () => (typeof chain.verifyChain === "function" ? chain.verifyChain() : null),
          accounts: ctx.stores.accounts,
          accountBalances: (bounds) => accountBalances.call(ctx.stores.ledger, bounds) as Promise<ReadonlyMap<string, Money>>,
          ledger: ctx.stores.ledger,
          reconciliationControls: ctx.reconciliationControls,
          reports: ctx.reports,
          sequenceCounters: () => ctx.stores.sequenceCounters.counterRows(),
          sequenceOverrides: () => ctx.stores.sequenceConfig.getAllOverrides(),
          branchCodes: async () => new Map((await ctx.stores.branches.findAll()).map((branch) => [branch.id, branch.code])),
          fiscalPeriods: () => ctx.stores.fiscalPeriods.list(),
          closeSummaries: async (periodId) => (await ctx.periodCloseGuard.source()?.listSummaries(periodId)) ?? null,
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
