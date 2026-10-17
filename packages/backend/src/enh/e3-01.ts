import { createGlanceRoutes } from "@mezan/api";
import { createSqliteAccountRoutingStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";
import { ownerDigestServiceOf } from "./e3-02.js";

/**
 * Remote glance (ENH-E3-01), mounted under `/dashboard/glance`.
 *
 * Read-only: it composes the cockpit and the owner-digest exceptions the caller's
 * own permissions and branch scope allow, plus the receivable and payable control
 * balances and the approvals waiting. It writes nothing.
 */
export const area: BackendArea = {
  mount(ctx) {
    ctx.app.route(
      "/dashboard",
      createGlanceRoutes(
        {
          digest: ownerDigestServiceOf(ctx),
          ledger: ctx.stores.ledger,
          accountRouting: createSqliteAccountRoutingStore(ctx.sqlite),
          branches: ctx.stores.branches,
          approvals: ctx.approvalRequests,
          users: ctx.uow.users,
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
