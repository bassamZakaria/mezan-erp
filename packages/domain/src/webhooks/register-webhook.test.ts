import { describe, it, expect } from "vitest";
import { registerWebhook, type RegisterWebhookCommand } from "./register-webhook.js";
import { InvalidWebhookError } from "./errors.js";
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

function cmd(overrides: Partial<RegisterWebhookCommand> = {}): RegisterWebhookCommand {
  return {
    id: "wh-1",
    name: "لوحة المحاسب",
    targetUrl: "https://example.com/hook",
    events: ["SALES_INVOICE_CONFIRMED"],
    secret: "s3cr3t",
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("registerWebhook — happy path", () => {
  it("saves an active webhook with the plaintext secret and returns it", async () => {
    const repo = new FakeWebhookRepository();
    const webhook = await registerWebhook(cmd(), repo);
    expect(webhook.active).toBe(true);
    expect(webhook.secret).toBe("s3cr3t");
    expect((await repo.findById("wh-1"))?.id).toBe("wh-1");
  });

  it("deduplicates repeated event codes", async () => {
    const repo = new FakeWebhookRepository();
    const webhook = await registerWebhook(
      cmd({ events: ["SALES_INVOICE_CONFIRMED", "SALES_INVOICE_CONFIRMED"] }),
      repo,
    );
    expect(webhook.events).toEqual(["SALES_INVOICE_CONFIRMED"]);
  });
});

describe("registerWebhook — validation refusals", () => {
  it("refuses a blank name", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ name: "  " }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses a non-http(s) target URL", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ targetUrl: "ftp://example.com" }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses a malformed target URL", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ targetUrl: "not a url" }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses an empty event list", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ events: [] }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses an unknown event code", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ events: ["NOT_A_REAL_EVENT"] }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("refuses a blank secret", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ secret: " " }), repo)).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("collects every reason at once, not just the first", async () => {
    const repo = new FakeWebhookRepository();
    try {
      await registerWebhook(cmd({ name: "", targetUrl: "bad", events: [], secret: "" }), repo);
      throw new Error("expected registerWebhook to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidWebhookError);
      expect((e as InvalidWebhookError).reasons.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("refuses a subscription to an event the build cannot deliver, per the supplied policy", async () => {
    const repo = new FakeWebhookRepository();
    await expect(
      registerWebhook(cmd({ events: ["TENANT_CREATED"] }), repo, {
        deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookError);
  });

  it("does not persist a webhook that fails validation", async () => {
    const repo = new FakeWebhookRepository();
    await expect(registerWebhook(cmd({ name: "" }), repo)).rejects.toThrow();
    expect(await repo.findById("wh-1")).toBeNull();
  });
});
