import { describe, it, expect } from "vitest";
import { webhookSchema, createWebhookSchema, updateWebhookSchema, createWebhookResultSchema, webhookDeliverySchema } from "./webhooks.js";

describe("webhookSchema", () => {
  const webhook = {
    id: "wh-1",
    name: "POS sync",
    targetUrl: "https://example.com/webhook",
    events: ["sales-invoice.posted"],
    active: true,
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid webhook and preserves every field verbatim", () => {
    const result = webhookSchema.safeParse(webhook);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(webhook);
  });

  it("rejects a webhook missing events", () => {
    const { events, ...rest } = webhook;
    const result = webhookSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("events");
  });

  it("never carries the signing secret — only createWebhookResultSchema does", () => {
    expect(webhook).not.toHaveProperty("secret");
  });

  it("silently strips an unrecognised secret if a caller tried to smuggle one through the list shape", () => {
    const result = webhookSchema.safeParse({ ...webhook, secret: "shh" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("secret");
  });
});

describe("createWebhookSchema", () => {
  const create = { name: "POS sync", targetUrl: "https://example.com/webhook", events: ["sales-invoice.posted"] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createWebhookSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a malformed targetUrl", () => {
    const result = createWebhookSchema.safeParse({ ...create, targetUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty events array — at least one event is required", () => {
    const result = createWebhookSchema.safeParse({ ...create, events: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.events?.[0]).toContain("at least one event");
  });

  it("silently strips a caller-supplied id — identity is server-assigned", () => {
    const result = createWebhookSchema.safeParse({ ...create, id: "wh-caller" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });
});

describe("updateWebhookSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateWebhookSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateWebhookSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });

  it("rejects a malformed targetUrl when supplied", () => {
    const result = updateWebhookSchema.safeParse({ targetUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty events array when supplied", () => {
    const result = updateWebhookSchema.safeParse({ events: [] });
    expect(result.success).toBe(false);
  });
});

describe("createWebhookResultSchema", () => {
  const result = {
    id: "wh-1",
    name: "POS sync",
    targetUrl: "https://example.com/webhook",
    events: ["sales-invoice.posted"],
    active: true,
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
    secret: "whsec_abc123",
  };

  it("accepts a minimal valid result and preserves every field, including the one-time secret", () => {
    const parsed = createWebhookResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects a result missing secret", () => {
    const { secret, ...rest } = result;
    const parsed = createWebhookResultSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toHaveProperty("secret");
  });
});

describe("webhookDeliverySchema", () => {
  const delivery = {
    id: "del-1",
    webhookId: "wh-1",
    eventCode: "sales-invoice.posted",
    attemptedAt: "2026-08-30T10:00:00.000Z",
    statusCode: 200,
    success: true,
    errorMessage: null,
  };

  it("accepts a minimal valid delivery and preserves every field verbatim", () => {
    const result = webhookDeliverySchema.safeParse(delivery);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(delivery);
  });

  it("accepts a failed delivery with a null statusCode and an errorMessage", () => {
    const result = webhookDeliverySchema.safeParse({ ...delivery, statusCode: null, success: false, errorMessage: "connection timed out" });
    expect(result.success).toBe(true);
  });

  it("rejects a delivery missing success", () => {
    const { success, ...rest } = delivery;
    const result = webhookDeliverySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("success");
  });
});
