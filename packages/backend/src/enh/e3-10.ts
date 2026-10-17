import { createSystemHealthRoutes } from "@mezan/api";
import { createSqliteSystemHealthStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

export const area: BackendArea = {
  mount(ctx) {
    const store = createSqliteSystemHealthStore(ctx.sqlite);
    ctx.app.route(
      "/system/health",
      createSystemHealthRoutes(
        {
          outbox: () => store.outbox(),
          eta: (limit) => store.eta(limit),
          database: () => store.database(),
          auditChain: ctx.auditChain,
          jobs: () => ctx.scheduledJobStatus(),
          users: ctx.uow.users,
          mailConfigured: ctx.customerMail.configured,
          resolveLicenseState: ctx.resolveLicenseState,
          cloudTenant: ctx.cloudTenant,
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
