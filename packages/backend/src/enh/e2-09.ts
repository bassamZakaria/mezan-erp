import { Hono } from "hono";
import { auditBoundary, connectionTurn, createCollectionsRoutes, tenantTimeZoneMiddleware } from "@mezan/api";
import { createAuthContext, createDefaultSettings } from "@mezan/domain";
import type { ScheduledDunningRunResultDTO } from "@mezan/contracts";
import type { BackendArea, BackendModuleContext, ScheduledCollectionsResult } from "../module-context.js";
import { reportsDeps } from "./e1-02.js";

/**
 * AR collections / dunning (ENH-E2-09), mounted under `/collections`.
 *
 * Moves no money and posts nothing to the ledger: it reads receivables off the
 * same open-item sources the cash forecast uses and records follow-up state of
 * its own. Customer email only ever leaves through the operator-initiated drain.
 */
const SCHEDULER_ACTOR = "system:collections-schedule";
const SCHEDULER_PERMISSIONS = ["sales.collections.run", "sales.collections.send"];
const AUTO_SEND_DISABLED_STATUS = 409;

export const area: BackendArea = {
  mount(ctx: BackendModuleContext) {
    const deps = {
      reports: reportsDeps(ctx),
      customers: ctx.stores.customers,
      allocations: ctx.stores.vouchers.allocations,
      store: ctx.customerMail.store,
      company: async () => {
        const settings = (await ctx.stores.settings.get()) ?? createDefaultSettings();
        return { companyName: settings.companyName, currency: settings.currency };
      },
      drain: ctx.customerMail.drain,
      mailConfigured: ctx.customerMail.configured,
      audit: ctx.audit,
    };
    ctx.app.route("/collections", createCollectionsRoutes(deps, ctx.resolveAuthContext));

    // SECURITY: never mounted on any HTTP path. It exists so the host's timer can run the same
    // scheduled-run handler, as the system actor, in process.
    const scheduler = new Hono();
    scheduler.use("*", connectionTurn(ctx.audit));
    scheduler.use("*", tenantTimeZoneMiddleware(ctx.stores.settings));
    scheduler.use("*", auditBoundary(ctx.audit));
    scheduler.route(
      "/",
      createCollectionsRoutes(deps, () =>
        createAuthContext({ userId: SCHEDULER_ACTOR, permissions: SCHEDULER_PERMISSIONS, branchScope: "*", warehouseScope: "*" }),
      ),
    );

    ctx.collectionsScheduleSlot.run = async (): Promise<ScheduledCollectionsResult | null> => {
      const res = await scheduler.fetch(new Request("http://collections.internal/scheduled-run", { method: "POST" }));
      if (res.status === AUTO_SEND_DISABLED_STATUS) return null;
      if (!res.ok) throw new Error(`scheduled dunning run answered ${res.status}`);
      const result = (await res.json()) as ScheduledDunningRunResultDTO;
      if (result.alreadyRan) return { ran: false, queued: 0, sent: 0 };
      if (result.queued === 0) return { ran: true, queued: 0, sent: 0 };
      // The same drain an operator presses: it sends through the tenant's SMTP outside the
      // connection's turn and then marks the reminders it delivered as sent.
      const drained = await scheduler.fetch(new Request("http://collections.internal/outbox/drain", { method: "POST" }));
      const sent = drained.ok ? ((await drained.json()) as { sent: number }).sent : 0;
      return { ran: true, queued: result.queued, sent };
    };
  },
};
