import { createIntegrationsRoutes, enqueueWebhookDeliveries, INTEGRATIONS_MOUNT } from "@mezan/api";
import { createSqliteIdempotentRequestStore, createSqliteIntegrationStore, createIdempotentRequestStore, createIntegrationStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { createIntegrationsGateway, currentUserGrant, type Turn } from "../integrations/gateway.js";
import { startWebhookDeliveryWorker } from "../integrations/delivery-worker.js";
import { createPinnedWebhookTransport } from "../integrations/webhook-transport.js";
import { createLogger } from "@mezan/api";

const areaLog = createLogger("integrations");

function turnOf(ctx: BackendModuleContext): Turn {
  return <T>(work: () => Promise<T>): Promise<T> => (ctx.audit.turn ? ctx.audit.turn(work) : work());
}

// DEC-17 / DEC-27: mounted only when the host asked for the integration surface. The desktop
// never does, so its backend carries no `/integrations`, no API-key verifier and no dispatcher.
export const area: BackendArea = {
  mount(ctx) {
    if (!ctx.integrations) return;
    const { tenantCode } = ctx.integrations;
    const now = () => new Date();
    const turn = turnOf(ctx);
    const store = ctx.store((s) => createSqliteIntegrationStore(s, ctx.secrets), (d) => createIntegrationStore(d, ctx.secrets));
    const worker = startWebhookDeliveryWorker({
      store,
      transport: ctx.integrations.transport ?? createPinnedWebhookTransport(),
      turn,
      grantOf: (userId) => currentUserGrant(ctx.uow, userId),
      now,
      onError: (error) => areaLog.error({ err: error }, "webhook delivery failed"),
    });
    ctx.addCloser({ close: () => worker.stop() });

    ctx.eventBus.subscribeAll((event) => {
      ctx.db.afterCommit(() => {
        void turn(async () => enqueueWebhookDeliveries(store, event, now().toISOString()))
          .then((queued) => {
            if (queued > 0) worker.kick();
          })
          .catch((error: unknown) => areaLog.error({ err: error }, `could not queue webhooks for "${event.code}"`));
      });
    });

    ctx.app.route(
      INTEGRATIONS_MOUNT,
      createIntegrationsRoutes(
        {
          store,
          tenantCode,
          audit: ctx.audit,
          userName: async (userId) => (await ctx.uow.users.findById(userId))?.nameAr ?? null,
          onDeliveryQueued: () => worker.kick(),
        },
        ctx.resolveAuthContext,
      ),
    );

    ctx.integrationsSlot.gateway = createIntegrationsGateway({
      tenantCode,
      store,
      idempotency: ctx.store((s) => createSqliteIdempotentRequestStore(s), (d) => createIdempotentRequestStore(d)),
      uow: ctx.uow,
      audit: ctx.audit,
      turn,
      now,
    });
    worker.kick();
  },
};
