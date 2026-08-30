import { describe, it, expect } from "vitest";
import { recordWebhookDelivery } from "./record-delivery.js";
import { WebhookNotFoundError } from "./errors.js";
import type { Webhook, WebhookDeliveryAttempt, WebhookDeliveryRepository, WebhookRepository } from "./webhook.js";

class FakeWebhookRepository implements WebhookRepository {
  readonly rows = new Map<string, Webhook>();
  async list(): Promise<Webhook[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<Webhook | null> {
    return this.rows.get(id) ?? null;
  }
  async save(webhook: Webhook): Promise<void> {
    this.rows.set(webhook.id, webhook);
  }
}

class FakeDeliveryRepository implements WebhookDeliveryRepository {
  readonly rows: WebhookDeliveryAttempt[] = [];
  async listForWebhook(webhookId: string): Promise<WebhookDeliveryAttempt[]> {
    return this.rows.filter((r) => r.webhookId === webhookId);
  }
  async record(attempt: WebhookDeliveryAttempt): Promise<void> {
    this.rows.push(attempt);
  }
}

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh-1",
    name: "test",
    targetUrl: "https://example.com/hook",
    events: ["SALES_INVOICE_CONFIRMED"],
    secret: "s3cr3t",
    active: true,
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("recordWebhookDelivery", () => {
  it("throws WebhookNotFoundError when the webhook does not exist", async () => {
    const webhooks = new FakeWebhookRepository();
    const deliveries = new FakeDeliveryRepository();
    await expect(
      recordWebhookDelivery(
        { id: "d1", webhookId: "missing", eventCode: "SALES_INVOICE_CONFIRMED", statusCode: 200, success: true, errorMessage: null },
        webhooks,
        deliveries,
      ),
    ).rejects.toBeInstanceOf(WebhookNotFoundError);
  });

  it("records a successful attempt with the given attemptedAt", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const attempt = await recordWebhookDelivery(
      {
        id: "d1",
        webhookId: "wh-1",
        eventCode: "SALES_INVOICE_CONFIRMED",
        statusCode: 200,
        success: true,
        errorMessage: null,
        attemptedAt: "2026-08-22T11:00:00.000Z",
      },
      webhooks,
      deliveries,
    );
    expect(attempt.attemptedAt).toBe("2026-08-22T11:00:00.000Z");
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]?.success).toBe(true);
  });

  it("stamps now() when attemptedAt is omitted", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const attempt = await recordWebhookDelivery(
      { id: "d1", webhookId: "wh-1", eventCode: "SALES_INVOICE_CONFIRMED", statusCode: null, success: false, errorMessage: "timeout" },
      webhooks,
      deliveries,
    );
    expect(() => new Date(attempt.attemptedAt).toISOString()).not.toThrow();
  });

  it("records a failed attempt with its error message", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const attempt = await recordWebhookDelivery(
      { id: "d1", webhookId: "wh-1", eventCode: "SALES_INVOICE_CONFIRMED", statusCode: 500, success: false, errorMessage: "attempt 1/3: HTTP 500" },
      webhooks,
      deliveries,
    );
    expect(attempt.success).toBe(false);
    expect(attempt.errorMessage).toBe("attempt 1/3: HTTP 500");
  });
});
