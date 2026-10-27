import {
  WEBHOOK_ATTEMPT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookDeliveryStatusDTO,
} from "@mezan/contracts";
import {
  COMPANY_LEVEL_EVENT_PERMISSION,
  WEBHOOK_DELIVERY_BATCH,
  WEBHOOK_DELIVERY_LEASE_MS,
  WEBHOOK_RESPONSE_EXCERPT_MAX,
  WEBHOOK_RETRY_POLICY,
  WILDCARD_PERMISSION,
  branchGrantCoversEvent,
  deliveryOutcomeAfterFailure,
  formatWebhookSignature,
  webhookRetryDelayMs,
  webhookSignedPayload,
  type WebhookDeliveryRecord,
  type WebhookRecord,
} from "@mezan/domain";
import type { SqliteIntegrationStore } from "@mezan/persistence";
import type { Turn, UserGrant } from "./gateway.js";
import { signWebhookPayload, type WebhookTransport } from "./webhook-transport.js";

const TICK_MS = 15_000;
const MANAGE = "admin.integrations.manage";

enum SkipReason {
  OwnerCannotReceive = "صاحب الاشتراك لم يعد يملك صلاحية إدارة التكامل أو أوقف حسابه.",
  OutsideOwnerBranches = "الحدث يخص فرعاً خارج نطاق صاحب الاشتراك.",
}

export interface WebhookDeliveryWorkerDeps {
  readonly store: SqliteIntegrationStore;
  readonly transport: WebhookTransport;
  readonly turn: Turn;
  readonly grantOf: (userId: string) => Promise<UserGrant | null>;
  readonly now: () => Date;
  readonly onError: (error: unknown) => void;
}

export interface WebhookDeliveryWorker {
  kick(): void;
  runOnce(): Promise<number>;
  stop(): void;
}

function holds(grant: UserGrant, code: string): boolean {
  return grant.permissions.has(WILDCARD_PERMISSION) || grant.permissions.has(code);
}

function truncate(text: string): string {
  return text.length > WEBHOOK_RESPONSE_EXCERPT_MAX ? `${text.slice(0, WEBHOOK_RESPONSE_EXCERPT_MAX)}…` : text;
}

export function startWebhookDeliveryWorker(deps: WebhookDeliveryWorkerDeps): WebhookDeliveryWorker {
  let stopped = false;
  let running: Promise<number> | null = null;
  let again = false;

  async function deliverOne(delivery: WebhookDeliveryRecord, webhook: WebhookRecord): Promise<void> {
    const owner = await deps.grantOf(webhook.createdBy);
    const at = () => deps.now().toISOString();
    if (!owner || !holds(owner, MANAGE)) {
      await deps.turn(async () => await deps.store.deliveries.skipped(delivery.id, at(), SkipReason.OwnerCannotReceive));
      return;
    }
    if (!branchGrantCoversEvent(owner.branchScope, holds(owner, COMPANY_LEVEL_EVENT_PERMISSION), delivery.branchIds)) {
      await deps.turn(async () => await deps.store.deliveries.skipped(delivery.id, at(), SkipReason.OutsideOwnerBranches));
      return;
    }
    const attempt = delivery.attempts + 1;
    const timestamp = String(Math.floor(deps.now().getTime() / 1000));
    const signature = formatWebhookSignature(timestamp, signWebhookPayload(deps.store.webhooks.signingSecretOf(webhook), webhookSignedPayload(timestamp, delivery.payload)));
    const outcome = await deps.transport.send({
      url: webhook.url,
      body: delivery.payload,
      timeoutMs: WEBHOOK_RETRY_POLICY.timeoutMs,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "user-agent": "Mezan-Webhooks/1",
        [WEBHOOK_EVENT_HEADER]: delivery.eventCode,
        [WEBHOOK_DELIVERY_HEADER]: delivery.id,
        [WEBHOOK_ATTEMPT_HEADER]: String(attempt),
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
    });
    const finishedAt = deps.now();
    await deps.turn(async () => {
      if (outcome.statusCode !== null && outcome.statusCode >= 200 && outcome.statusCode < 300) {
        await deps.store.deliveries.delivered(delivery.id, finishedAt.toISOString(), outcome.statusCode);
        return;
      }
      const status = deliveryOutcomeAfterFailure(attempt);
      await deps.store.deliveries.failed(delivery.id, {
        at: finishedAt.toISOString(),
        statusCode: outcome.statusCode,
        error: truncate(outcome.error ?? "فشل غير معروف"),
        status,
        nextAttemptAt: status === WebhookDeliveryStatusDTO.Pending ? new Date(finishedAt.getTime() + webhookRetryDelayMs(attempt)).toISOString() : null,
      });
    });
  }

  async function sweep(): Promise<number> {
    let handled = 0;
    while (!stopped) {
      const now = deps.now();
      const leased = await deps.turn(async () => {
        const due = await deps.store.deliveries.due(now.toISOString(), WEBHOOK_DELIVERY_BATCH);
        const until = new Date(now.getTime() + WEBHOOK_DELIVERY_LEASE_MS).toISOString();
        const mine: { delivery: WebhookDeliveryRecord; webhook: WebhookRecord }[] = [];
        for (const delivery of due) {
          const webhook = await deps.store.webhooks.findById(delivery.webhookId);
          if (webhook && await deps.store.deliveries.lease(delivery.id, delivery.nextAttemptAt, until)) mine.push({ delivery, webhook });
        }
        return mine;
      });
      if (leased.length === 0) break;
      await Promise.all(
        leased.map(({ delivery, webhook }) => deliverOne(delivery, webhook).catch((error: unknown) => deps.onError(error))),
      );
      handled += leased.length;
      if (leased.length < WEBHOOK_DELIVERY_BATCH) break;
    }
    return handled;
  }

  function runOnce(): Promise<number> {
    if (running) {
      again = true;
      return running;
    }
    running = sweep()
      .catch((error: unknown) => {
        deps.onError(error);
        return 0;
      })
      .finally(() => {
        running = null;
        if (again && !stopped) {
          again = false;
          void runOnce();
        }
      });
    return running;
  }

  const timer = setInterval(() => void runOnce(), TICK_MS);
  timer.unref?.();

  return {
    kick() {
      if (!stopped) setImmediate(() => void runOnce());
    },
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
