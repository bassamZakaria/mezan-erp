import { createRecurringJournalRoutes, MasterDataKind } from "@mezan/api";
import { DEPRECIABLE_ASSET_STATUSES, createRecurringJournalCommitmentSource, depreciationRunsCoverPeriod, routedAccountId, type PartyControlKind, type CommitmentSource } from "@mezan/domain";
import {
  createSqliteAccountRoutingStore,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
  createSqliteRecurringJournalRunRepository,
  createSqliteRecurringJournalSkipRepository,
  createSqliteRecurringJournalTemplateRepository,
  createSqliteVatFilingStore,
  createAccountRoutingStore,
  createAssetRepository,
  createDepreciationRunRepository,
  createRecurringJournalRunRepository,
  createRecurringJournalSkipRepository,
  createRecurringJournalTemplateRepository,
  createVatFilingStore,
  type SqlDb,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { registerCashCommitmentSource } from "./e1-02.js";

/**
 * Recurring & template journal automation (ENH-E2-02). Mounted under
 * `/gl/recurring`. Draft-only generation, on the SAME GL posting engine every
 * other module posts through — `ctx.stores.ledger` carries its own
 * connection-bound `numbering` (see `ledger-store.ts`), so this reuses it
 * rather than opening a second one.
 */

const commitmentSourceRegistry = new WeakMap<SqlDb, CommitmentSource>();

export function getRecurringJournalCommitmentSource(db: SqlDb): CommitmentSource | undefined {
  return commitmentSourceRegistry.get(db);
}

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const templates = ctx.store((s) => createSqliteRecurringJournalTemplateRepository(s), (d) => createRecurringJournalTemplateRepository(d));
    const runs = ctx.store((s) => createSqliteRecurringJournalRunRepository(s), (d) => createRecurringJournalRunRepository(d));
    const skips = ctx.store((s) => createSqliteRecurringJournalSkipRepository(s), (d) => createRecurringJournalSkipRepository(d));
    const accountRouting = ctx.store((s) => createSqliteAccountRoutingStore(s), (d) => createAccountRoutingStore(d));
    const assets = ctx.store((s) => createSqliteAssetRepository(s), (d) => createAssetRepository(d));
    const depreciationRuns = ctx.store((s) => createSqliteDepreciationRunRepository(s), (d) => createDepreciationRunRepository(d));

    async function resolvePartyControlAccounts(): Promise<ReadonlyMap<string, PartyControlKind>> {
      const routing = await accountRouting.get();
      return new Map<string, PartyControlKind>([
        [routedAccountId(routing, "control.receivable") ?? "1105", "customer"],
        [routedAccountId(routing, "control.payable") ?? "2100", "supplier"],
      ]);
    }

    async function partyExists(kind: PartyControlKind, id: string): Promise<boolean> {
      if (kind === "customer") return (await ctx.stores.customers.findById(id)) !== null;
      return (await ctx.stores.suppliers.findById(id)) !== null;
    }

    ctx.app.route(
      "/gl/recurring",
      createRecurringJournalRoutes(
        {
          masterData: { [MasterDataKind.Branch]: ctx.stores.branches },
          templates,
          runs,
          skips,
          ledger: ctx.stores.ledger,
          accounts: ctx.stores.accounts,
          periods: ctx.stores.fiscalPeriods,
          numbering: ctx.stores.ledger.numbering,
          resolvePartyControlAccounts,
          partyExists,
          audit: ctx.audit,
          vatFilings: ctx.store((s) => createSqliteVatFilingStore(s), (d) => createVatFilingStore(d)),
          dueDepreciation: {
            hasDepreciableAssets: async () => (await assets.list()).some((asset) => DEPRECIABLE_ASSET_STATUSES.has(asset.status)),
            hasRunForPeriod: async (period) => depreciationRunsCoverPeriod(await assets.list(), await depreciationRuns.list(), period),
          },
        },
        ctx.resolveAuthContext,
      ),
    );

    const commitmentSource = createRecurringJournalCommitmentSource({
      templates,
      runs,
      skips,
      cashAccountIds: async () => new Set(await ctx.cashAndBankAccountIds()),
      partyControlAccountIds: async () => new Set((await resolvePartyControlAccounts()).keys()),
    });
    commitmentSourceRegistry.set(ctx.db, commitmentSource);
    registerCashCommitmentSource(ctx.db, commitmentSource);

    ctx.addCloser(templates);
    ctx.addCloser(runs);
    ctx.addCloser(skips);
    ctx.addCloser(assets);
    ctx.addCloser(depreciationRuns);
  },
};
