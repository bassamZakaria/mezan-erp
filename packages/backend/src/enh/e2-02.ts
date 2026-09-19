import type Database from "better-sqlite3";
import { createRecurringJournalRoutes } from "@mezan/api";
import { createRecurringJournalCommitmentSource, routedAccountId, type PartyControlKind, type RecurringJournalCommitmentSource } from "@mezan/domain";
import {
  createSqliteAccountRoutingStore,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
  createSqliteRecurringJournalRunRepository,
  createSqliteRecurringJournalTemplateRepository,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

/**
 * Recurring & template journal automation (ENH-E2-02). Mounted under
 * `/gl/recurring`. Draft-only generation, on the SAME GL posting engine every
 * other module posts through — `ctx.stores.ledger` carries its own
 * connection-bound `numbering` (see `ledger-store.ts`), so this reuses it
 * rather than opening a second one.
 */

const commitmentSourceRegistry = new WeakMap<Database.Database, RecurringJournalCommitmentSource>();

/**
 * Exported for E1-02's cash-forecast area to pick up once it lands on `main`
 * (it is a PARALLEL lane, not merged as of this branch — see
 * `packages/domain/src/recurring-journals/commitment-source.ts`). That area's
 * `mount` would call:
 *
 *   registerCashCommitmentSource(ctx.sqlite, getRecurringJournalCommitmentSource(ctx.sqlite)!)
 *
 * after this area has mounted. Nothing here depends on E1-02's code existing.
 */
export function getRecurringJournalCommitmentSource(sqlite: Database.Database): RecurringJournalCommitmentSource | undefined {
  return commitmentSourceRegistry.get(sqlite);
}

const DEPRECIABLE_ASSET_STATUSES = new Set(["active", "under_maintenance"]);

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const templates = createSqliteRecurringJournalTemplateRepository(ctx.sqlite);
    const runs = createSqliteRecurringJournalRunRepository(ctx.sqlite);
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

    commitmentSourceRegistry.set(
      ctx.sqlite,
      createRecurringJournalCommitmentSource({ templates, runs }),
    );

    ctx.addCloser(templates);
    ctx.addCloser(runs);
    ctx.addCloser(assets);
    ctx.addCloser(depreciationRuns);
  },
};
