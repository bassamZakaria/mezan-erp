import { Hono, type Context } from "hono";
import {
  saveNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  setNotificationRuleActive,
  InvalidNotificationRuleError,
  NotificationRuleNotFoundError,
  DOMAIN_EVENT_CATALOG,
  IMPLEMENTED_NOTIFICATION_CHANNELS,
  buildNotificationTriggerCatalog,
  type EventCode,
  type NotificationRule,
  type NotificationRuleRepository,
} from "@mezan/domain";
import { createNotificationRuleSchema, updateNotificationRuleSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serialize(rule: NotificationRule) {
  return {
    id: rule.id,
    name: rule.name,
    eventCode: rule.eventCode,
    condition: rule.condition,
    recipientType: rule.recipientType,
    recipientValue: rule.recipientValue,
    priority: rule.priority,
    channels: rule.channels,
    titleAr: rule.titleAr,
    bodyAr: rule.bodyAr,
    active: rule.active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidNotificationRuleError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof NotificationRuleNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  throw err;
}

/**
 * قواعد الإشعارات routes (docs/archive/catalog/09 §قواعد الإشعارات): list/create/edit/
 * delete/toggle over the 39-event catalog, plus two read-only lookups the
 * builder screen uses — `/events` for the raw "الحدث" combobox, and
 * `/triggers` for the same catalog annotated with what this build can actually
 * deliver (which codes something really publishes, and which channels really
 * send). Every route is permission-gated via `notifications.rule.view` /
 * `.manage`.
 *
 * `emittedEventCodes` comes from the composition root — the only place that
 * knows which document types are bridged onto the event bus — so the honest
 * `emitted` flag can never drift from the wiring.
 */
export function createNotificationRulesRoutes(
  repo: NotificationRuleRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  emittedEventCodes: readonly EventCode[] = [],
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const triggers = buildNotificationTriggerCatalog(emittedEventCodes);

  app.get("/events", gate("notifications.rule.view"), (c) => {
    return c.json(DOMAIN_EVENT_CATALOG);
  });

  app.get("/triggers", gate("notifications.rule.view"), (c) => {
    return c.json({ triggers, implementedChannels: IMPLEMENTED_NOTIFICATION_CHANNELS });
  });

  app.get("/", gate("notifications.rule.view"), async (c) => {
    const activeParam = c.req.query("active");
    const eventCode = c.req.query("eventCode") ?? undefined;
    const filter = {
      active: activeParam === undefined ? undefined : activeParam === "true",
      eventCode,
    };
    const rules = await repo.list(filter);
    return c.json(rules.map(serialize));
  });

  app.get("/:id", gate("notifications.rule.view"), async (c) => {
    const rule = await repo.findById(c.req.param("id"));
    if (!rule) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(rule));
  });

  app.post("/", gate("notifications.rule.manage"), async (c) => {
    const parsed = createNotificationRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const rule = await saveNotificationRule(
        {
          id: parsed.data.id ?? crypto.randomUUID(),
          name: parsed.data.name,
          eventCode: parsed.data.eventCode,
          condition: parsed.data.condition ?? null,
          recipientType: parsed.data.recipientType,
          recipientValue: parsed.data.recipientValue,
          priority: parsed.data.priority,
          channels: parsed.data.channels,
          titleAr: parsed.data.titleAr ?? null,
          bodyAr: parsed.data.bodyAr ?? null,
          active: parsed.data.active,
        },
        repo,
      );
      return c.json(serialize(rule), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/:id", gate("notifications.rule.manage"), async (c) => {
    const parsed = updateNotificationRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const rule = await updateNotificationRule(
        c.req.param("id"),
        {
          name: parsed.data.name,
          eventCode: parsed.data.eventCode,
          condition: parsed.data.condition ?? null,
          recipientType: parsed.data.recipientType,
          recipientValue: parsed.data.recipientValue,
          priority: parsed.data.priority,
          channels: parsed.data.channels,
          titleAr: parsed.data.titleAr ?? null,
          bodyAr: parsed.data.bodyAr ?? null,
          active: parsed.data.active,
        },
        repo,
      );
      return c.json(serialize(rule));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/activate", gate("notifications.rule.manage"), async (c) => {
    try {
      const rule = await setNotificationRuleActive(c.req.param("id"), true, repo);
      return c.json(serialize(rule));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/deactivate", gate("notifications.rule.manage"), async (c) => {
    try {
      const rule = await setNotificationRuleActive(c.req.param("id"), false, repo);
      return c.json(serialize(rule));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("notifications.rule.manage"), async (c) => {
    try {
      await deleteNotificationRule(c.req.param("id"), repo);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
