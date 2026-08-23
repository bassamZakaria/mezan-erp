/**
 * webhooks/ — subscription registry, delivery-attempt log, and the dispatcher
 * that actually sends (settings §Webhooks).
 *
 * `WebhookDispatcher` (dispatcher.ts) subscribes to `events/EventBus`,
 * HMAC-signs each payload with `Webhook.secret`, hands the POST to the
 * injected `WebhookTransportPort`, retries with bounded backoff, and calls
 * `recordWebhookDelivery` with every attempt's outcome. The HTTP send and the
 * HMAC primitive are ports — their implementations live in the composition
 * root, since this package may not do I/O or import `node:*`.
 */
export { type Webhook, type WebhookRepository, type WebhookDeliveryAttempt, type WebhookDeliveryRepository } from "./webhook.js";
export { registerWebhook, type RegisterWebhookCommand } from "./register-webhook.js";
export { updateWebhook, type UpdateWebhookCommand } from "./update-webhook.js";
export { recordWebhookDelivery, type RecordWebhookDeliveryCommand } from "./record-delivery.js";
export { InvalidWebhookError, WebhookNotFoundError } from "./errors.js";
export {
  WebhookDispatcher,
  DEFAULT_WEBHOOK_RETRY_POLICY,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ATTEMPT_HEADER,
  webhookSignedPayload,
  formatWebhookSignature,
  type WebhookHttpRequest,
  type WebhookHttpResponse,
  type WebhookTransportPort,
  type WebhookSignaturePort,
  type WebhookRetryPolicy,
  type WebhookDispatcherDeps,
  type WebhookDispatchErrorContext,
} from "./dispatcher.js";
