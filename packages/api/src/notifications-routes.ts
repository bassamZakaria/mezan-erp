import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  computeInvoiceTotals,
  createInAppDelivery,
  createNotificationDirectory,
  createNotificationRule,
  deleteNotificationRule,
  implementedChannels,
  InvalidNotificationRuleError,
  NOTIFICATION_TRIGGERS,
  NotificationRuleNotFoundError,
  subscribeNotificationEngine,
  updateNotificationRule,
  type DomainEvent,
  type EventBus,
  type Notification,
  type NotificationChannel,
  type NotificationDeliveryPort,
  type NotificationPayloadEnricher,
  type NotificationRepository,
  type NotificationRule,
  type NotificationRuleRepository,
  type RoleRepository,
  type SalesInvoiceRepository,
  type UserRepository,
} from "@mezan/domain";
import {
  createNotificationRuleSchema,
  updateNotificationRuleSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/**
 * قواعد الإشعارات + the shell's notification bell (docs/catalog/09,
 * `/notifications/rules`), mounted under `/notifications`:
 *   GET    /rules            list rules                  (notifications.rule.view)
 *   POST   /rules            create a rule               (notifications.rule.manage)
 *   PATCH  /rules/:id        edit / enable / disable      (notifications.rule.manage)
 *   DELETE /rules/:id        delete a rule               (notifications.rule.manage)
 *   GET    /triggers         trigger catalog + channels   (notifications.rule.view)
 *   GET    /me               MY inbox                    (any authenticated user)
 *   POST   /me/:id/read      mark one read               (any authenticated user)
 *   POST   /me/read-all      mark all read               (any authenticated user)
 *
 * `/me*` is deliberately NOT permission-gated: the resource is the caller's own
 * inbox, scoped by their user id, and every user has a bell. The two
 * `notifications.rule.*` codes in the permission catalog govern the RULES
 * admin surface, which is what they are named for.
 */
export interface NotificationRoutesDeps {
  readonly rules: NotificationRuleRepository;
  readonly notifications: NotificationRepository;
  readonly users: UserRepository;
  readonly roles: RoleRepository;
  /** The in-process bus the engine subscribes to. */
  readonly bus: EventBus;
  /** Optional payload enricher (e.g. `createSalesInvoiceEventEnricher`). */
  readonly enricher?: NotificationPayloadEnricher;
  readonly idGen?: () => string;
  readonly now?: () => string;
  readonly onError?: (error: unknown, event: DomainEvent) => void;
  readonly resolveAuthContext?: AuthContextResolver;
}

function serializeRule(rule: NotificationRule) {
  return {
    id: rule.id,
    name: rule.name,
    eventCode: rule.eventCode,
    condition: rule.condition,
    recipientType: rule.recipientType,
    recipientValue: rule.recipientValue,
    priority: rule.priority,
    channels: [...rule.channels],
    titleTemplate: rule.titleTemplate,
    bodyTemplate: rule.bodyTemplate,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
  };
}

function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    ruleId: notification.ruleId,
    eventCode: notification.eventCode,
    channel: notification.channel,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    reference: notification.reference,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof NotificationRuleNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidNotificationRuleError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Enriches `SALES_INVOICE_*` events with the confirmed invoice's total and
 * customer, so a rule can condition on `amount` and a template can render
 * `{{amount}}` / `{{customerName}}`. The raw document event carries only the
 * document's identity — this is the adapter that reads the real invoice back.
 */
export function createSalesInvoiceEventEnricher(
  repo: SalesInvoiceRepository,
): NotificationPayloadEnricher {
  return {
    async enrich(event: DomainEvent) {
      if (!event.code.startsWith("SALES_INVOICE_")) return {};
      const payload = event.payload as { docId?: string } | null;
      const docId = payload?.docId;
      if (typeof docId !== "string") return {};
      const invoice = await repo.findById(docId);
      if (!invoice) return {};
      const totals = computeInvoiceTotals(invoice.lines, invoice.discount, {
        taxExempt: invoice.customerTaxExempt,
      });
      return {
        amount: Number(totals.grandTotal.toString()),
        currency: invoice.currency,
        customerId: invoice.customerId,
        customerName: invoice.customerNameAr,
        status: invoice.status,
      };
    },
  };
}

export function createNotificationsRoutes(
  deps: NotificationRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());

  const delivery: Partial<Record<NotificationChannel, NotificationDeliveryPort>> = {
    in_app: createInAppDelivery(deps.notifications),
  };

  // Composition: the engine is attached to the bus here, once, when the router
  // is built — the routes below only read/write what it produced.
  subscribeNotificationEngine(deps.bus, {
    rules: deps.rules,
    directory: createNotificationDirectory(deps.users, deps.roles),
    delivery,
    enricher: deps.enricher,
    idGen,
    now,
    onError: deps.onError,
  });

  async function requireUserId(c: Context): Promise<string | null> {
    const ctx = await resolveAuthContext(c);
    const userId = ctx.userId;
    return userId && userId !== "anonymous" ? userId : null;
  }

  app.get("/triggers", gate("notifications.rule.view"), (c) =>
    c.json({
      triggers: NOTIFICATION_TRIGGERS.map((t) => ({
        code: t.code,
        category: t.category,
        labelAr: t.labelAr,
        emitted: t.emitted,
        conditionFields: [...t.conditionFields],
      })),
      implementedChannels: [...implementedChannels(delivery)],
    }),
  );

  app.get("/rules", gate("notifications.rule.view"), async (c) =>
    c.json((await deps.rules.list()).map(serializeRule)),
  );

  app.get("/rules/:id", gate("notifications.rule.view"), async (c) => {
    const rule = await deps.rules.findById(c.req.param("id"));
    if (!rule) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeRule(rule));
  });

  app.post("/rules", gate("notifications.rule.manage"), async (c) => {
    const parsed = createNotificationRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const rule = await createNotificationRule(
        { ...parsed.data, id: parsed.data.id ?? idGen(), createdAt: now() },
        deps.rules,
      );
      return c.json(serializeRule(rule), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/rules/:id", gate("notifications.rule.manage"), async (c) => {
    const parsed = updateNotificationRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const rule = await updateNotificationRule(c.req.param("id"), parsed.data, deps.rules);
      return c.json(serializeRule(rule));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/rules/:id", gate("notifications.rule.manage"), async (c) => {
    try {
      await deleteNotificationRule(c.req.param("id"), deps.rules);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/me", async (c) => {
    const userId = await requireUserId(c);
    if (!userId) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const unreadOnly = c.req.query("unreadOnly") === "true";
    const limitParam = Number(c.req.query("limit"));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
    const [notifications, unreadCount] = await Promise.all([
      deps.notifications.listForUser(userId, { unreadOnly, limit }),
      deps.notifications.countUnread(userId),
    ]);
    return c.json({ notifications: notifications.map(serializeNotification), unreadCount });
  });

  app.post("/me/read-all", async (c) => {
    const userId = await requireUserId(c);
    if (!userId) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const updated = await deps.notifications.markAllRead(userId, now());
    return c.json({ updated, unreadCount: await deps.notifications.countUnread(userId) });
  });

  app.post("/me/:id/read", async (c) => {
    const userId = await requireUserId(c);
    if (!userId) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const notification = await deps.notifications.markRead(userId, c.req.param("id"), now());
    if (!notification) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeNotification(notification));
  });

  return app;
}
