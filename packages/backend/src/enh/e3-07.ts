import { createSalesFunnelRoutes } from "@mezan/api";
import { createSqliteOpportunityRepository, createSqlitePipelineStageRepository, createSqliteSalesQuoteStore, createOpportunityRepository, createPipelineStageRepository, createSalesQuoteStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

/**
 * Sales funnel and rep leaderboard (ENH-E3-07), mounted under `/sales-funnel`.
 * Read-only: nothing is posted and no sequence is consumed.
 */
export const area: BackendArea = {
  mount(ctx) {
    const opportunities = ctx.store((s) => createSqliteOpportunityRepository(s), (d) => createOpportunityRepository(d));
    const quotes = ctx.store((s) => createSqliteSalesQuoteStore(s), (d) => createSalesQuoteStore(d));
    ctx.app.route(
      "/sales-funnel",
      createSalesFunnelRoutes(
        {
          opportunities,
          stageHistory: opportunities,
          pipelineStages: ctx.store((s) => createSqlitePipelineStageRepository(s), (d) => createPipelineStageRepository(d)),
          quotes,
          salesInvoices: ctx.stores.salesInvoices,
          users: ctx.uow.users,
          settings: ctx.stores.settings,
        },
        ctx.resolveAuthContext,
      ),
    );
    ctx.addCloser(quotes);
  },
};
