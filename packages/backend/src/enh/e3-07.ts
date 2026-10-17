import { createSalesFunnelRoutes } from "@mezan/api";
import { createSqliteOpportunityRepository, createSqlitePipelineStageRepository, createSqliteSalesQuoteStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

/**
 * Sales funnel and rep leaderboard (ENH-E3-07), mounted under `/sales-funnel`.
 * Read-only: nothing is posted and no sequence is consumed.
 */
export const area: BackendArea = {
  mount(ctx) {
    const opportunities = createSqliteOpportunityRepository(ctx.sqlite);
    const quotes = createSqliteSalesQuoteStore(ctx.sqlite);
    ctx.app.route(
      "/sales-funnel",
      createSalesFunnelRoutes(
        {
          opportunities,
          stageHistory: opportunities,
          pipelineStages: createSqlitePipelineStageRepository(ctx.sqlite),
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
