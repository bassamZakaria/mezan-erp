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
 * Records the outcome of one delivery attempt. This is the write side a real
 * dispatcher would call after POSTing the signed payload to `targetUrl` — no
 * dispatcher exists yet (see webhooks/index.ts doc comment); this only
 * persists the record so the subscription's delivery history is real once one
 * does.
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
