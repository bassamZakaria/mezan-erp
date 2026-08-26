import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  registerWebhook,
  updateWebhook,
  recordWebhookDelivery,
  InvalidWebhookError,
  WebhookNotFoundError,
  recordSensitiveEvent,
  auditBranchFromScope,
  DOMAIN_EVENT_CATALOG,
  type EventCode,
  type Webhook,
  type WebhookRepository,
  type WebhookDeliveryRepository,
  type AuditSink,
} from "@mezan/domain";
import { createWebhookSchema, updateWebhookSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

function serializeWebhook(webhook: Webhook) {
  return {
    id: webhook.id,
    name: webhook.name,
    targetUrl: webhook.targetUrl,
    events: webhook.events,
    active: webhook.active,
    createdBy: webhook.createdBy,
    createdAt: webhook.createdAt,
  };
}

function webhookErrorResponse(c: Context, err: unknown) {
  if (err instanceof WebhookNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidWebhookError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export interface WebhooksRoutesDeps {
  readonly webhooks: WebhookRepository;
  readonly deliveries: WebhookDeliveryRepository;
  /**
   * The event codes this build really publishes onto the `EventBus`, from the
   * composition root — the same set `/notification-rules/triggers` reports as
   * `emitted`. A subscription on anything else is REFUSED (422), because a
   * webhook that can never fire is a promise the product cannot keep. Omit it
   * and the check is off.
   */
  readonly emittedEventCodes?: readonly EventCode[];
}

/**
 * الويب هوك (settings §Webhooks) — register a target URL + subscribed events,
 * enable/disable, and read recent delivery attempts. The sending itself is
 * `WebhookDispatcher`'s job (wired onto the event bus in the composition
 * root); these routes are the registry plus the read side of its attempt log.
 * Gated with `admin.settings.*` — same rationale as `api-keys-routes.ts`.
 * `secret` (the HMAC signing key) is returned in the clear ONLY on create,
 * exactly like the API key's plaintext value.
 */
export function createWebhooksRoutes(
  deps: WebhooksRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const { webhooks, deliveries } = deps;
  const eventPolicy = { deliverableCodes: deps.emittedEventCodes ?? [] };
  const branchOf = (c: Context): string | null => {
    const ctx = getAuthContext(c);
    return ctx ? auditBranchFromScope(ctx.branchScope) : null;
  };

  /**
   * The events a subscription may actually be bound to — the catalog narrowed
   * to what this build emits, so the settings screen offers nothing that can
   * never fire. `POST /` enforces the same narrowing regardless.
   */
  app.get("/events", gate("admin.settings.view"), (c) => {
    const deliverable = new Set<string>(deps.emittedEventCodes ?? []);
    const events = DOMAIN_EVENT_CATALOG.filter((e) => deliverable.size === 0 || deliverable.has(e.code));
    return c.json({ events, enforced: deliverable.size > 0 });
  });

  app.get("/", gate("admin.settings.view"), async (c) => {
    return c.json((await webhooks.list()).map(serializeWebhook));
  });

  app.get("/:id", gate("admin.settings.view"), async (c) => {
    const webhook = await webhooks.findById(c.req.param("id"));
    if (!webhook) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeWebhook(webhook));
  });

  app.post("/", gate("admin.settings.edit"), async (c) => {
    const parsed = createWebhookSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const actor = getAuthContext(c)?.userId ?? "system";
    const secret = generateSecret();
    try {
      const webhook = await registerWebhook(
        {
          id: crypto.randomUUID(),
          name: parsed.data.name,
          targetUrl: parsed.data.targetUrl,
          events: parsed.data.events,
          secret,
          createdBy: actor,
          createdAt: new Date().toISOString(),
        },
        webhooks,
        eventPolicy,
      );
      if (audit) {
        await recordSensitiveEvent(audit, {
          module: "webhooks",
          entityType: "WEBHOOK",
          entityId: webhook.id,
          action: "REGISTERED",
          actor,
          branchId: branchOf(c),
          severity: "WARNING",
          details: { id: webhook.id, name: webhook.name, targetUrl: webhook.targetUrl, events: webhook.events },
        });
      }
      return c.json({ ...serializeWebhook(webhook), secret }, 201);
    } catch (err) {
      return webhookErrorResponse(c, err);
    }
  });

  app.patch("/:id", gate("admin.settings.edit"), async (c) => {
    const parsed = updateWebhookSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const actor = getAuthContext(c)?.userId ?? "system";
    try {
      const webhook = await updateWebhook(c.req.param("id"), parsed.data, webhooks, eventPolicy);
      if (audit) {
        await recordSensitiveEvent(audit, {
          module: "webhooks",
          entityType: "WEBHOOK",
          entityId: webhook.id,
          action: "UPDATED",
          actor,
          branchId: branchOf(c),
          severity: "INFO",
          details: { id: webhook.id, active: webhook.active },
        });
      }
      return c.json(serializeWebhook(webhook));
    } catch (err) {
      return webhookErrorResponse(c, err);
    }
  });

  app.get("/:id/deliveries", gate("admin.settings.view"), async (c) => {
    const webhook = await webhooks.findById(c.req.param("id"));
    if (!webhook) return c.json({ error: "NOT_FOUND" }, 404);
    const limitParam = Number(c.req.query("limit") ?? "50");
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
    return c.json(await deliveries.listForWebhook(webhook.id, limit));
  });

  /**
   * Out-of-process recorder for a delivery outcome. The in-process dispatcher
   * calls `recordWebhookDelivery` directly; this exists for an edition that
   * runs the sender elsewhere.
   */
  app.post("/:id/deliveries", gate("admin.settings.edit"), async (c) => {
    const body = (await c.req.json()) as {
      eventCode?: string;
      statusCode?: number | null;
      success?: boolean;
      errorMessage?: string | null;
    };
    if (!body.eventCode || typeof body.success !== "boolean") {
      return c.json({ error: "VALIDATION_ERROR", message: "eventCode and success are required" }, 400);
    }
    try {
      const attempt = await recordWebhookDelivery(
        {
          id: crypto.randomUUID(),
          webhookId: c.req.param("id"),
          eventCode: body.eventCode,
          statusCode: body.statusCode ?? null,
          success: body.success,
          errorMessage: body.errorMessage ?? null,
        },
        webhooks,
        deliveries,
      );
      return c.json(attempt, 201);
    } catch (err) {
      return webhookErrorResponse(c, err);
    }
  });

  return app;
}
