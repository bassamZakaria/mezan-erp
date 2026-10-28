import { createClientErrorRoutes, createSystemHealthRoutes } from "@mezan/api";
import { ClientErrorKindDTO, ClientErrorPlatformDTO } from "@mezan/contracts";
import { createSqliteClientErrorStore, createSqliteSystemHealthStore, createClientErrorStore, createSystemHealthStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

const PLATFORMS = new Set<string>(Object.values(ClientErrorPlatformDTO));
const KINDS = new Set<string>(Object.values(ClientErrorKindDTO));

export const area: BackendArea = {
  mount(ctx) {
    const store = ctx.store((s) => createSqliteSystemHealthStore(s), (d) => createSystemHealthStore(d));
    const clientErrors = ctx.store((s) => createSqliteClientErrorStore(s), (d) => createClientErrorStore(d));
    ctx.app.route("/client-errors", createClientErrorRoutes({ sink: clientErrors, resolveAuthContext: ctx.resolveAuthContext }));
    ctx.app.route(
      "/system/health",
      createSystemHealthRoutes(
        {
          outbox: () => store.outbox(),
          eta: (limit) => store.eta(limit),
          etaCredentials: async () => ({ clientSecretNeedsReentry: (await ctx.stores.eta.config.get()).clientSecretNeedsReentry === true }),
          database: () => store.database(),
          auditChain: ctx.auditChain,
          jobs: () => ctx.scheduledJobStatus(),
          users: ctx.uow.users,
          mailConfigured: ctx.customerMail.configured,
          resolveLicenseState: ctx.resolveLicenseState,
          cloudTenant: ctx.cloudTenant,
          clientErrors: async (sinceIso, limit) => ({
            lastDay: await clientErrors.countSince(sinceIso),
            recent: (await clientErrors.recent(limit))
              .filter((row) => PLATFORMS.has(row.platform) && KINDS.has(row.kind))
              .map((row) => ({ ...row, platform: row.platform as ClientErrorPlatformDTO, kind: row.kind as ClientErrorKindDTO })),
          }),
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};
