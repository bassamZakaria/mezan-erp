import { describe, it, expect } from "vitest";
import { updateWebhook } from "./update-webhook.js";
import { InvalidWebhookError, WebhookNotFoundError } from "./errors.js";
import type { Webhook, WebhookRepository } from "./webhook.js";

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

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh-1",
    name: "أصلي",
    targetUrl: "https://example.com/hook",
    events: ["SALES_INVOICE_CONFIRMED"],
    secret: "s3cr3t",
    active: true,
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("updateWebhook — happy path", () => {
  it("patches only the given fields, leaving the rest (including the secret) untouched", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    const updated = await updateWebhook("wh-1", { name: "محدث" }, repo);
    expect(updated.name).toBe("محدث");
    expect(updated.secret).toBe("s3cr3t");
    expect(updated.targetUrl).toBe("https://example.com/hook");
  });

  it("can toggle active off and on", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook({ active: true }));
    const updated = await updateWebhook("wh-1", { active: false }, repo);
    expect(updated.active).toBe(false);
  });

  it("deduplicates a patched event list", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    const updated = await updateWebhook("wh-1", { events: ["CHEQUE_BOUNCED", "CHEQUE_BOUNCED"] }, repo);
    expect(updated.events).toEqual(["CHEQUE_BOUNCED"]);
  });

  it("persists the patch through the repository", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await updateWebhook("wh-1", { name: "محدث" }, repo);
    expect((await repo.findById("wh-1"))?.name).toBe("محدث");
  });

  it("toggling active alone does not re-check deliverability of an existing event list", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook({ events: ["TENANT_CREATED"] }));
    const updated = await updateWebhook("wh-1", { active: false }, repo, {
      deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
    });
    expect(updated.active).toBe(false);
    expect(updated.events).toEqual(["TENANT_CREATED"]);
  });
});

describe("updateWebhook — refusals", () => {
  it("throws WebhookNotFoundError for an unknown id", async () => {
    const repo = new FakeWebhookRepository();
    await expect(updateWebhook("missing", { name: "x" }, repo)).rejects.toBeInstanceOf(WebhookNotFoundError);
  });

  it("refuses patching the name to blank", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await expect(updateWebhook("wh-1", { name: "  " }, repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses patching the target URL to a non-http(s) value", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await expect(updateWebhook("wh-1", { targetUrl: "ftp://x" }, repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses patching events to an empty list", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await expect(updateWebhook("wh-1", { events: [] }, repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses patching in an unknown event code", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await expect(updateWebhook("wh-1", { events: ["NOT_A_REAL_EVENT"] }, repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses patching in an event the build cannot deliver, per the supplied policy", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook());
    await expect(
      updateWebhook("wh-1", { events: ["TENANT_CREATED"] }, repo, {
        deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("does not persist a rejected patch", async () => {
    const repo = new FakeWebhookRepository();
    repo.rows.set("wh-1", webhook({ name: "أصلي" }));
    await expect(updateWebhook("wh-1", { name: "" }, repo)).rejects.toThrow();
    expect((await repo.findById("wh-1"))?.name).toBe("أصلي");
  });
});
