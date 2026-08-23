/**
 * Webhook subscriptions (settings §Webhooks) — a tenant-registered HTTP
 * target that a real dispatcher would call on the events it subscribes to
 * (drawn from the SAME unified event catalog `events/catalog.ts` already
 * defines — not a parallel event vocabulary).
 *
 * `secret` is kept in the clear in storage (unlike `ApiKey.keyHash`) because a
 * real dispatcher needs it on every delivery to HMAC-sign the payload so the
 * receiver can verify authenticity — a one-way hash cannot serve that. The API
 * still only ever returns it in the create response, never afterwards.
 */
export interface Webhook {
  readonly id: string;
  readonly name: string;
  readonly targetUrl: string;
  /** Event codes from `events/catalog.ts`'s DOMAIN_EVENT_CATALOG. */
  readonly events: readonly string[];
  readonly secret: string;
  readonly active: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface WebhookRepository {
  list(): Promise<Webhook[]>;
  findById(id: string): Promise<Webhook | null>;
  save(webhook: Webhook): Promise<void>;
}

/** One recorded delivery attempt (a real dispatcher's outcome for one event on one webhook). */
export interface WebhookDeliveryAttempt {
  readonly id: string;
  readonly webhookId: string;
  readonly eventCode: string;
  readonly attemptedAt: string;
  readonly statusCode: number | null;
  readonly success: boolean;
  readonly errorMessage: string | null;
}

export interface WebhookDeliveryRepository {
  listForWebhook(webhookId: string, limit?: number): Promise<WebhookDeliveryAttempt[]>;
  record(attempt: WebhookDeliveryAttempt): Promise<void>;
}
