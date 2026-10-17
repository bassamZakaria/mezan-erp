import { createCollectionsRoutes } from "@mezan/api";
import { createDefaultSettings } from "@mezan/domain";
import { createSqliteCollectionsStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { reportsDeps } from "./e1-02.js";

/**
 * AR collections / dunning (ENH-E2-09), mounted under `/collections`.
 *
 * Moves no money and posts nothing to the ledger: it reads receivables off the
 * same open-item sources the cash forecast uses and records follow-up state of
 * its own. Customer email only ever leaves through the operator-initiated drain.
 */
export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const store = createSqliteCollectionsStore(ctx.sqlite);
    ctx.app.route(
      "/collections",
      createCollectionsRoutes(
        {
          reports: reportsDeps(ctx),
          customers: ctx.stores.customers,
          allocations: ctx.stores.vouchers.allocations,
          store,
          company: async () => {
            const settings = (await ctx.stores.settings.get()) ?? createDefaultSettings();
            return { companyName: settings.companyName, currency: settings.currency };
          },
          drain: ctx.customerMail.drain,
          mailConfigured: ctx.customerMail.configured,
          audit: ctx.audit,
        },
        ctx.resolveAuthContext,
      ),
    );
    ctx.addCloser(store);
  },
};
