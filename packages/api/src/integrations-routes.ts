import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  API_KEY_LOOKUP_LENGTH,
  API_SCOPE_DEFINITIONS,
  DOMAIN_EVENT_CATALOG,
  MAX_ACTIVE_API_KEYS,
  MAX_WEBHOOKS,
  PUBLIC_API_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_RETRY_POLICY,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  apiKeyDisplayPrefix,
  apiKeyStatus,
  formatApiKeyToken,
  scopeGrantable,
  scopesBeyondGrant,
  unknownWebhookEvents,
  webhookEnvelope,
  webhookTargetProblem,
  webhookTestEnvelope,
  type ApiKeyRecord,
  type AuditSink,
  type DomainEvent,
  type WebhookDeliveryRecord,
  type WebhookRecord,
} from "@mezan/domain";
import {
  ApiKeyStatusDTO,
  IntegrationRefusal,
  PUBLIC_API_BASE_PATH,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TEST_EVENT,
  WebhookDeliveryStatusDTO,
  createApiKeySchema,
  createWebhookSchema,
  updateWebhookSchema,
  webhookDeliveryQuerySchema,
  type ApiKeyCreatedDTO,
  type ApiKeyDTO,
  type IntegrationsCatalogDTO,
  type WebhookCreatedDTO,
  type WebhookDTO,
  type WebhookDeliveryDTO,
} from "@mezan/contracts";
import type { IntegrationStore, WebhookDeliveryStats } from "@mezan/persistence";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent, recordSecurityAdminEvent } from "./admin-audit.js";

export const INTEGRATIONS_MOUNT = "/integrations";
export const PUBLIC_API_OPENAPI_PATH = `${PUBLIC_API_BASE_PATH}/openapi.json`;

const VIEW = "admin.integrations.view";
const MANAGE = "admin.integrations.manage";
const AUDIT_MODULE = "admin";
const API_SECRET_BYTES = 32;
const WEBHOOK_SECRET_PREFIX = "whsec_";

enum IntegrationAuditAction {
  KeyCreated = "integrations.api_key.created",
  KeyRevoked = "integrations.api_key.revoked",
  WebhookCreated = "integrations.webhook.created",
  WebhookUpdated = "integrations.webhook.updated",
  WebhookSecretRotated = "integrations.webhook.secret_rotated",
  WebhookTested = "integrations.webhook.tested",
  DeliveryRedelivered = "integrations.delivery.redelivered",
}

enum IntegrationEntity {
  ApiKey = "INTEGRATION_API_KEY",
  Webhook = "INTEGRATION_WEBHOOK",
  Delivery = "INTEGRATION_WEBHOOK_DELIVERY",
}

const MESSAGES: Readonly<Record<IntegrationRefusal, { readonly ar: string; readonly en: string }>> = {
  [IntegrationRefusal.ValidationError]: { ar: "البيانات المرسلة غير صالحة.", en: "The submitted data is not valid." },
  [IntegrationRefusal.NotFound]: { ar: "السجل غير موجود.", en: "The record was not found." },
  [IntegrationRefusal.ScopeExceedsGrant]: { ar: "لا يمكن منح مفتاح صلاحية لا تملكها أنت.", en: "A key cannot be granted a permission you do not hold yourself." },
  [IntegrationRefusal.KeyAlreadyRevoked]: { ar: "هذا المفتاح مُلغى بالفعل.", en: "This key is already revoked." },
  [IntegrationRefusal.TooManyKeys]: {
    ar: `بلغت الحد الأقصى للمفاتيح الفعّالة (${MAX_ACTIVE_API_KEYS}). ألغِ مفتاحاً غير مستخدم أولاً.`,
    en: `You have reached the maximum of ${MAX_ACTIVE_API_KEYS} active keys. Revoke an unused key first.`,
  },
  [IntegrationRefusal.TooManyWebhooks]: { ar: `بلغت الحد الأقصى لاشتراكات webhook (${MAX_WEBHOOKS}).`, en: `You have reached the maximum of ${MAX_WEBHOOKS} webhook subscriptions.` },
  [IntegrationRefusal.TargetRefused]: { ar: "عنوان الاستقبال مرفوض.", en: "The receiving address was refused." },
  [IntegrationRefusal.UnknownEvent]: { ar: "حدث غير معروف في قائمة الأحداث.", en: "The event list contains an unknown event." },
  [IntegrationRefusal.DeliveryNotRedeliverable]: { ar: "لا يمكن إعادة إرسال هذا التسليم.", en: "This delivery cannot be sent again." },
  [IntegrationRefusal.WebhookInactive]: { ar: "الاشتراك موقوف؛ فعّله أولاً.", en: "The subscription is paused; turn it on first." },
};

function refuse(c: Context, error: IntegrationRefusal, status: 400 | 403 | 404 | 409 | 422, extra: Record<string, unknown> = {}) {
  return c.json({ error, message: MESSAGES[error].ar, messageEn: MESSAGES[error].en, ...extra }, status);
}

export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IntegrationsRoutesDeps {
  readonly store: IntegrationStore;
  readonly tenantCode: string;
  readonly audit: AuditSink;
  readonly userName: (userId: string) => Promise<string | null>;
  readonly onDeliveryQueued: () => void;
  readonly now?: () => Date;
}

function keyDTO(key: ApiKeyRecord, tenantCode: string, nowIso: string, names: ReadonlyMap<string, string | null>): ApiKeyDTO {
  return {
    id: key.id,
    name: key.name,
    displayPrefix: apiKeyDisplayPrefix(tenantCode, key.lookup),
    scopes: key.scopes,
    status: apiKeyStatus(key, nowIso),
    createdBy: key.createdBy,
    createdByName: names.get(key.createdBy) ?? null,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    revokedBy: key.revokedBy,
  };
}

const NO_STATS: WebhookDeliveryStats = { pending: 0, deadLetters: 0, lastDeliveredAt: null };

function webhookDTO(webhook: WebhookRecord, stats: WebhookDeliveryStats = NO_STATS): WebhookDTO {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
    createdBy: webhook.createdBy,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
    secretRotatedAt: webhook.secretRotatedAt,
    pending: stats.pending,
    deadLetters: stats.deadLetters,
    lastDeliveredAt: stats.lastDeliveredAt,
  };
}

function deliveryDTO(delivery: WebhookDeliveryRecord, webhookName: string | null): WebhookDeliveryDTO {
  return {
    id: delivery.id,
    webhookId: delivery.webhookId,
    webhookName,
    eventCode: delivery.eventCode,
    status: delivery.status,
    attempts: delivery.attempts,
    maxAttempts: WEBHOOK_RETRY_POLICY.maxAttempts,
    nextAttemptAt: delivery.nextAttemptAt,
    lastAttemptAt: delivery.lastAttemptAt,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
    redeliveryOf: delivery.redeliveryOf,
    payload: delivery.payload,
  };
}

function newSigningSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(API_SECRET_BYTES).toString("base64url")}`;
}

/** Queues one delivery per active subscription to `event`. Synchronous: it runs on the bus. */
export async function enqueueWebhookDeliveries(store: IntegrationStore, event: DomainEvent, nowIso: string): Promise<number> {
  const subscribers = await store.webhooks.subscribedTo(event.code);
  for (const webhook of subscribers) {
    const id = randomUUID();
    const envelope = webhookEnvelope({ deliveryId: id, webhookId: webhook.id, eventCode: event.code, occurredAt: event.occurredAt, payload: event.payload });
    await store.deliveries.insert({
      id,
      webhookId: webhook.id,
      eventCode: event.code,
      payload: envelope.body,
      branchIds: envelope.branchIds,
      status: WebhookDeliveryStatusDTO.Pending,
      attempts: 0,
      nextAttemptAt: nowIso,
      lastAttemptAt: null,
      lastStatusCode: null,
      lastError: null,
      createdAt: nowIso,
      deliveredAt: null,
      redeliveryOf: null,
    });
  }
  return subscribers.length;
}

export function createIntegrationsRoutes(deps: IntegrationsRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const nowIso = () => (deps.now ?? (() => new Date()))().toISOString();
  const { store } = deps;

  async function namesOf(userIds: readonly string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds)];
    return new Map(await Promise.all(unique.map(async (id) => [id, await deps.userName(id)] as const)));
  }

  function grantedOf(c: Context): ReadonlySet<string> {
    return getAuthContext(c)?.permissions ?? new Set<string>();
  }

  function actorOf(c: Context): string {
    return getAuthContext(c)?.userId ?? "anonymous";
  }

  app.get("/catalog", gate(VIEW), (c) => {
    const granted = grantedOf(c);
    const body: IntegrationsCatalogDTO = {
      scopes: API_SCOPE_DEFINITIONS.map((d) => ({ scope: d.scope, permissions: d.permissions, grantable: scopeGrantable(d.scope, granted), write: d.write })),
      events: DOMAIN_EVENT_CATALOG.map((e) => ({ code: e.code, category: e.category, labelAr: e.labelAr })),
      apiBasePath: PUBLIC_API_BASE_PATH,
      openApiPath: PUBLIC_API_OPENAPI_PATH,
      signatureHeader: WEBHOOK_SIGNATURE_HEADER,
      maxDeliveryAttempts: WEBHOOK_RETRY_POLICY.maxAttempts,
      signatureToleranceSeconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
      rateLimitPerMinute: PUBLIC_API_RATE_LIMIT_PER_MINUTE,
    };
    return c.json(body);
  });

  app.get("/api-keys", gate(VIEW), async (c) => {
    const at = nowIso();
    const keys = await store.apiKeys.list();
    const names = await namesOf(keys.map((k) => k.createdBy));
    return c.json(keys.map((key) => keyDTO(key, deps.tenantCode, at, names)));
  });

  app.post("/api-keys", gate(MANAGE), async (c) => {
    const parsed = createApiKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return refuse(c, IntegrationRefusal.ValidationError, 400, { details: parsed.error.flatten() });
    const at = nowIso();
    const scopes = [...new Set(parsed.data.scopes)];
    const beyond = scopesBeyondGrant(scopes, grantedOf(c));
    if (beyond.length > 0) return refuse(c, IntegrationRefusal.ScopeExceedsGrant, 403, { scopes: beyond });
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt).toISOString() : null;
    if (expiresAt !== null && expiresAt <= at) return refuse(c, IntegrationRefusal.ValidationError, 400, { field: "expiresAt" });
    if (await store.apiKeys.countUnrevoked(at) >= MAX_ACTIVE_API_KEYS) return refuse(c, IntegrationRefusal.TooManyKeys, 409);

    let lookup = randomBytes(API_KEY_LOOKUP_LENGTH / 2).toString("hex");
    while (await store.apiKeys.findByLookup(lookup)) lookup = randomBytes(API_KEY_LOOKUP_LENGTH / 2).toString("hex");
    const token = formatApiKeyToken({ tenantCode: deps.tenantCode, lookup, secret: randomBytes(API_SECRET_BYTES).toString("base64url") });
    const key: ApiKeyRecord = {
      id: randomUUID(),
      name: parsed.data.name,
      lookup,
      tokenHash: hashApiKeyToken(token),
      scopes,
      createdBy: actorOf(c),
      createdAt: at,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    };
    await store.apiKeys.insert(key);
    await recordSecurityAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.ApiKey,
      entityId: key.id,
      action: IntegrationAuditAction.KeyCreated,
      details: { name: key.name, scopes, expiresAt, displayPrefix: apiKeyDisplayPrefix(deps.tenantCode, lookup) },
    });
    const names = await namesOf([key.createdBy]);
    const body: ApiKeyCreatedDTO = { key: keyDTO(key, deps.tenantCode, at, names), token };
    return c.json(body, 201);
  });

  app.post("/api-keys/:id/revoke", gate(MANAGE), async (c) => {
    const key = await store.apiKeys.findById(c.req.param("id"));
    if (!key) return refuse(c, IntegrationRefusal.NotFound, 404);
    const at = nowIso();
    if (apiKeyStatus(key, at) === ApiKeyStatusDTO.Revoked || !await store.apiKeys.revoke(key.id, at, actorOf(c))) {
      return refuse(c, IntegrationRefusal.KeyAlreadyRevoked, 409);
    }
    await recordSecurityAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.ApiKey,
      entityId: key.id,
      action: IntegrationAuditAction.KeyRevoked,
      details: { name: key.name, displayPrefix: apiKeyDisplayPrefix(deps.tenantCode, key.lookup) },
    });
    const revoked = await store.apiKeys.findById(key.id) ?? key;
    return c.json(keyDTO(revoked, deps.tenantCode, at, await namesOf([revoked.createdBy])));
  });

  app.get("/webhooks", gate(VIEW), async (c) => {
    const stats = await store.webhooks.stats();
    return c.json((await store.webhooks.list()).map((w) => webhookDTO(w, stats.get(w.id))));
  });

  app.post("/webhooks", gate(MANAGE), async (c) => {
    const parsed = createWebhookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return refuse(c, IntegrationRefusal.ValidationError, 400, { details: parsed.error.flatten() });
    const problem = webhookTargetProblem(parsed.data.url);
    if (problem) return c.json({ error: IntegrationRefusal.TargetRefused, message: problem.message, messageEn: problem.messageEn }, 422);
    const events = [...new Set(parsed.data.events)];
    const unknown = unknownWebhookEvents(events);
    if (unknown.length > 0) return refuse(c, IntegrationRefusal.UnknownEvent, 422, { events: unknown });
    if ((await store.webhooks.list()).length >= MAX_WEBHOOKS) return refuse(c, IntegrationRefusal.TooManyWebhooks, 409);
    const at = nowIso();
    const signingSecret = newSigningSecret();
    const webhook: WebhookRecord = {
      id: randomUUID(),
      name: parsed.data.name,
      url: parsed.data.url,
      events,
      active: true,
      signingSecret,
      createdBy: actorOf(c),
      createdAt: at,
      updatedAt: at,
      secretRotatedAt: at,
    };
    await store.webhooks.insert(webhook);
    await recordSecurityAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.Webhook,
      entityId: webhook.id,
      action: IntegrationAuditAction.WebhookCreated,
      details: { name: webhook.name, url: webhook.url, events },
    });
    const body: WebhookCreatedDTO = { webhook: webhookDTO(webhook), signingSecret };
    return c.json(body, 201);
  });

  app.patch("/webhooks/:id", gate(MANAGE), async (c) => {
    const existing = await store.webhooks.findById(c.req.param("id"));
    if (!existing) return refuse(c, IntegrationRefusal.NotFound, 404);
    const parsed = updateWebhookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return refuse(c, IntegrationRefusal.ValidationError, 400, { details: parsed.error.flatten() });
    if (parsed.data.url !== undefined) {
      const problem = webhookTargetProblem(parsed.data.url);
      if (problem) return c.json({ error: IntegrationRefusal.TargetRefused, message: problem.message, messageEn: problem.messageEn }, 422);
    }
    const events = parsed.data.events ? [...new Set(parsed.data.events)] : existing.events;
    const unknown = unknownWebhookEvents(events);
    if (unknown.length > 0) return refuse(c, IntegrationRefusal.UnknownEvent, 422, { events: unknown });
    const updated: WebhookRecord = {
      ...existing,
      name: parsed.data.name ?? existing.name,
      url: parsed.data.url ?? existing.url,
      events,
      active: parsed.data.active ?? existing.active,
      updatedAt: nowIso(),
    };
    await store.webhooks.save(updated);
    await recordSecurityAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.Webhook,
      entityId: updated.id,
      action: IntegrationAuditAction.WebhookUpdated,
      details: {
        before: { name: existing.name, url: existing.url, events: existing.events, active: existing.active },
        after: { name: updated.name, url: updated.url, events: updated.events, active: updated.active },
      },
    });
    if (updated.active && !existing.active) deps.onDeliveryQueued();
    return c.json(webhookDTO(updated, (await store.webhooks.stats()).get(updated.id)));
  });

  app.post("/webhooks/:id/rotate-secret", gate(MANAGE), async (c) => {
    const existing = await store.webhooks.findById(c.req.param("id"));
    if (!existing) return refuse(c, IntegrationRefusal.NotFound, 404);
    const at = nowIso();
    const signingSecret = newSigningSecret();
    const updated: WebhookRecord = { ...existing, signingSecret, secretRotatedAt: at, updatedAt: at };
    await store.webhooks.save(updated);
    await recordSecurityAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.Webhook,
      entityId: updated.id,
      action: IntegrationAuditAction.WebhookSecretRotated,
      details: { name: updated.name },
    });
    const body: WebhookCreatedDTO = { webhook: webhookDTO(updated, (await store.webhooks.stats()).get(updated.id)), signingSecret };
    return c.json(body);
  });

  app.post("/webhooks/:id/test", gate(MANAGE), async (c) => {
    const webhook = await store.webhooks.findById(c.req.param("id"));
    if (!webhook) return refuse(c, IntegrationRefusal.NotFound, 404);
    if (!webhook.active) return refuse(c, IntegrationRefusal.WebhookInactive, 409);
    const at = nowIso();
    const id = randomUUID();
    const envelope = webhookTestEnvelope({ deliveryId: id, webhookId: webhook.id, occurredAt: at });
    const delivery: WebhookDeliveryRecord = {
      id,
      webhookId: webhook.id,
      eventCode: WEBHOOK_TEST_EVENT,
      payload: envelope.body,
      branchIds: [],
      status: WebhookDeliveryStatusDTO.Pending,
      attempts: 0,
      nextAttemptAt: at,
      lastAttemptAt: null,
      lastStatusCode: null,
      lastError: null,
      createdAt: at,
      deliveredAt: null,
      redeliveryOf: null,
    };
    await store.deliveries.insert(delivery);
    await recordAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.Delivery,
      entityId: id,
      action: IntegrationAuditAction.WebhookTested,
      details: { webhookId: webhook.id },
    });
    deps.onDeliveryQueued();
    return c.json(deliveryDTO(delivery, webhook.name), 201);
  });

  app.get("/deliveries", gate(VIEW), async (c) => {
    const parsed = webhookDeliveryQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return refuse(c, IntegrationRefusal.ValidationError, 400, { details: parsed.error.flatten() });
    const names = new Map((await store.webhooks.list()).map((w) => [w.id, w.name]));
    return c.json((await store.deliveries.list(parsed.data)).map((d) => deliveryDTO(d, names.get(d.webhookId) ?? null)));
  });

  app.post("/deliveries/:id/redeliver", gate(MANAGE), async (c) => {
    const original = await store.deliveries.findById(c.req.param("id"));
    if (!original) return refuse(c, IntegrationRefusal.NotFound, 404);
    if (original.status === WebhookDeliveryStatusDTO.Pending) return refuse(c, IntegrationRefusal.DeliveryNotRedeliverable, 409);
    const webhook = await store.webhooks.findById(original.webhookId);
    if (!webhook) return refuse(c, IntegrationRefusal.NotFound, 404);
    if (!webhook.active) return refuse(c, IntegrationRefusal.WebhookInactive, 409);
    const at = nowIso();
    const copy: WebhookDeliveryRecord = {
      ...original,
      id: randomUUID(),
      status: WebhookDeliveryStatusDTO.Pending,
      attempts: 0,
      nextAttemptAt: at,
      lastAttemptAt: null,
      lastStatusCode: null,
      lastError: null,
      createdAt: at,
      deliveredAt: null,
      redeliveryOf: original.id,
    };
    await store.deliveries.insert(copy);
    await recordAdminEvent(deps.audit, c, {
      module: AUDIT_MODULE,
      entityType: IntegrationEntity.Delivery,
      entityId: copy.id,
      action: IntegrationAuditAction.DeliveryRedelivered,
      details: { redeliveryOf: original.id, webhookId: webhook.id, eventCode: original.eventCode },
    });
    deps.onDeliveryQueued();
    return c.json(deliveryDTO(copy, webhook.name), 201);
  });

  return app;
}
