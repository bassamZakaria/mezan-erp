import { WebhookNotFoundError } from "./errors.js";
import type { WebhookDeliveryAttempt, WebhookDeliveryRepository, WebhookRepository } from "./webhook.js";

export interface RecordWebhookDeliveryCommand {
  readonly id: string;
  readonly webhookId: string;
  readonly eventCode: string;
  readonly statusCode: number | null;
  readonly success: boolean;
  readonly errorMessage: string | null;
  readonly attemptedAt?: string;
}

/**
 * Records the outcome of one delivery attempt — the write side
 * `WebhookDispatcher` calls after each POST of the signed payload to
 * `targetUrl` (dispatcher.ts), so every retry leaves its own row in the
 * subscription's delivery history.
 */
export async function recordWebhookDelivery(
  cmd: RecordWebhookDeliveryCommand,
  webhooks: WebhookRepository,
  deliveries: WebhookDeliveryRepository,
): Promise<WebhookDeliveryAttempt> {
  const webhook = await webhooks.findById(cmd.webhookId);
  if (!webhook) throw new WebhookNotFoundError(cmd.webhookId);

  const attempt: WebhookDeliveryAttempt = {
    id: cmd.id,
    webhookId: cmd.webhookId,
    eventCode: cmd.eventCode,
    attemptedAt: cmd.attemptedAt ?? new Date().toISOString(),
    statusCode: cmd.statusCode,
    success: cmd.success,
    errorMessage: cmd.errorMessage,
  };
  await deliveries.record(attempt);
  return attempt;
}
