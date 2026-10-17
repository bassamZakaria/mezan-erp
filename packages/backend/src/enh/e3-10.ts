import { createClientErrorRoutes, createSystemHealthRoutes } from "@mezan/api";
import { ClientErrorKindDTO, ClientErrorPlatformDTO } from "@mezan/contracts";
import { createSqliteClientErrorStore, createSqliteSystemHealthStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

const PLATFORMS = new Set<string>(Object.values(ClientErrorPlatformDTO));
const KINDS = new Set<string>(Object.values(ClientErrorKindDTO));

export const area: BackendArea = {
  mount(ctx) {
    const store = createSqliteSystemHealthStore(ctx.sqlite);
    const clientErrors = createSqliteClientErrorStore(ctx.sqlite);
    ctx.app.route("/client-errors", createClientErrorRoutes({ sink: clientErrors, resolveAuthContext: ctx.resolveAuthContext }));
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
          clientErrors: (sinceIso, limit) => ({
            lastDay: clientErrors.countSince(sinceIso),
            recent: clientErrors
              .recent(limit)
              .filter((row) => PLATFORMS.has(row.platform) && KINDS.has(row.kind))
              .map((row) => ({ ...row, platform: row.platform as ClientErrorPlatformDTO, kind: row.kind as ClientErrorKindDTO })),
          }),
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
