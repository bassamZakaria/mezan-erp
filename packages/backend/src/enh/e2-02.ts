import type Database from "better-sqlite3";
import { createRecurringJournalRoutes } from "@mezan/api";
import { createRecurringJournalCommitmentSource, routedAccountId, type PartyControlKind, type CommitmentSource } from "@mezan/domain";
import {
  createSqliteAccountRoutingStore,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
  createSqliteRecurringJournalRunRepository,
  createSqliteRecurringJournalSkipRepository,
  createSqliteRecurringJournalTemplateRepository,
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

const commitmentSourceRegistry = new WeakMap<Database.Database, CommitmentSource>();

export function getRecurringJournalCommitmentSource(sqlite: Database.Database): CommitmentSource | undefined {
  return commitmentSourceRegistry.get(sqlite);
}

const DEPRECIABLE_ASSET_STATUSES = new Set(["active", "under_maintenance"]);

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const templates = createSqliteRecurringJournalTemplateRepository(ctx.sqlite);
    const runs = createSqliteRecurringJournalRunRepository(ctx.sqlite);
    const skips = createSqliteRecurringJournalSkipRepository(ctx.sqlite);
    const accountRouting = createSqliteAccountRoutingStore(ctx.sqlite);
    const assets = createSqliteAssetRepository(ctx.sqlite);
    const depreciationRuns = createSqliteDepreciationRunRepository(ctx.sqlite);

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
          dueDepreciation: {
            hasDepreciableAssets: async () => (await assets.list()).some((asset) => DEPRECIABLE_ASSET_STATUSES.has(asset.status)),
            hasRunForPeriod: async (period) => {
              const run = await depreciationRuns.findByPeriod(period, null);
              return run !== null && run.status !== "cancelled";
            },
          },
        },
        ctx.resolveAuthContext,
      ),
    );

    const commitmentSource = createRecurringJournalCommitmentSource({
      templates,
      runs,
      skips,
      // The GL accounts the treasury posts through — the same set the cash
      // forecast reads its opening balance from (`cash-forecast-routes.ts`
      // `openingCash`), so a commitment and the balance it moves are measured
      // against the same accounts.
      cashAccountIds: async () =>
        new Set(
          (await ctx.stores.treasuryAccounts.list())
            .map((account) => account.glAccountId)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      partyControlAccountIds: async () => new Set((await resolvePartyControlAccounts()).keys()),
    });
    commitmentSourceRegistry.set(ctx.sqlite, commitmentSource);
    registerCashCommitmentSource(ctx.sqlite, commitmentSource);

    ctx.addCloser(templates);
    ctx.addCloser(runs);
    ctx.addCloser(skips);
    ctx.addCloser(assets);
    ctx.addCloser(depreciationRuns);
  },
};
