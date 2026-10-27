import { createOwnerDigestRoutes, createOwnerDigestService, type ScheduledDigestResult } from "@mezan/api";
import {
  createSqliteNotificationStore,
  createSqliteOwnerDigestStore,
  createSqlitePricingGuardStores,
  createSqliteVanTripRepository,
  createNotificationStore,
  createOwnerDigestStore,
  createPricingGuardStores,
  createVanTripRepository,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { cockpitDepsOf } from "./e1-01.js";

const OWNER_DIGEST_BOOK_VERSION = "owner-digest";

/**
 * Owner digest (ENH-E3-02), mounted under `/owner-digest`.
 *
 * Moves no money and posts nothing: it reads the cockpit, the audit trail and the
 * exception sources, and writes its own settings, run log and a notification per
 * recipient. Mail leaves only through the notification outbox — on the desktop an
 * operator presses «إرسال الآن»; on the cloud a tenant that switched the schedule
 * on is served by the host timer calling `runOwnerDigest`.
 */
export function ownerDigestServiceOf(ctx: BackendModuleContext, store = ctx.store((s) => createSqliteOwnerDigestStore(s), (d) => createOwnerDigestStore(d))) {
  return createOwnerDigestService({
    cockpit: cockpitDepsOf(ctx, () => OWNER_DIGEST_BOOK_VERSION),
    settings: ctx.stores.settings,
    store,
    users: ctx.uow.users,
    roles: ctx.uow.roles,
    salesInvoices: ctx.stores.salesInvoices,
    audit: ctx.auditQuery,
    pricingOverrides: ctx.store((s) => createSqlitePricingGuardStores(s), (d) => createPricingGuardStores(d)).overrides,
    vanTrips: ctx.store((s) => createSqliteVanTripRepository(s), (d) => createVanTripRepository(d)),
    approvals: ctx.approvalRequests,
    eta: ctx.stores.eta.submissions,
    backup: ctx.backupStatus,
    notifications: ctx.store((s) => createSqliteNotificationStore(s), (d) => createNotificationStore(d)),
    mailConfigured: ctx.notificationOutbox.configured,
    drainOnly: ctx.notificationOutbox.drainOnly,
    scheduleSupported: ctx.cloud,
  });
}

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const store = ctx.store((s) => createSqliteOwnerDigestStore(s), (d) => createOwnerDigestStore(d));
    const service = ownerDigestServiceOf(ctx, store);

    ctx.app.route(
      "/owner-digest",
      createOwnerDigestRoutes(
        {
          service,
          store,
          users: ctx.uow.users,
          audit: ctx.audit,
          mailConfigured: ctx.notificationOutbox.configured,
          scheduleSupported: ctx.cloud,
          drainOnly: ctx.notificationOutbox.drainOnly,
        },
        ctx.resolveAuthContext,
      ),
    );

    ctx.ownerDigestSlot.run = (): Promise<ScheduledDigestResult> => {
      const work = (): Promise<ScheduledDigestResult> => service.runScheduled();
      return ctx.audit.turn ? ctx.audit.turn(work) : work();
    };
  },
};
