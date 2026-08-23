/**
 * webhooks/ — subscription registry + delivery-attempt log (settings §Webhooks).
 *
 * Scope note: this package records subscriptions and delivery attempts; it
 * does NOT dispatch. A real dispatcher (subscribes to `events/EventBus`,
 * HMAC-signs each payload with `Webhook.secret`, POSTs to `targetUrl`, retries
 * with backoff, calls `recordWebhookDelivery` with the outcome) is future
 * work outside this task's scope.
 */
export { type Webhook, type WebhookRepository, type WebhookDeliveryAttempt, type WebhookDeliveryRepository } from "./webhook.js";
export { registerWebhook, type RegisterWebhookCommand } from "./register-webhook.js";
export { updateWebhook, type UpdateWebhookCommand } from "./update-webhook.js";
export { recordWebhookDelivery, type RecordWebhookDeliveryCommand } from "./record-delivery.js";
export { InvalidWebhookError, WebhookNotFoundError } from "./errors.js";
