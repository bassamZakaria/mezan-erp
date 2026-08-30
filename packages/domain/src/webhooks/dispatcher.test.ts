import { describe, it, expect } from "vitest";
import type { DomainEvent } from "../events/event-bus.js";
import {
  WebhookDispatcher,
  webhookSignedPayload,
  formatWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ATTEMPT_HEADER,
  type WebhookDispatchErrorContext,
  type WebhookHttpRequest,
  type WebhookHttpResponse,
  type WebhookSignaturePort,
  type WebhookTransportPort,
} from "./dispatcher.js";
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

class ScriptedTransport implements WebhookTransportPort {
  readonly calls: WebhookHttpRequest[] = [];
  private readonly script: (WebhookHttpResponse | Error)[];
  constructor(script: (WebhookHttpResponse | Error)[]) {
    this.script = script;
  }
  async send(request: WebhookHttpRequest): Promise<WebhookHttpResponse> {
    this.calls.push(request);
    const next = this.script[this.calls.length - 1] ?? this.script.at(-1)!;
    if (next instanceof Error) throw next;
    return next;
  }
}

function fakeDigest(secret: string, signedPayload: string): string {
  let hash = 0;
  for (const ch of `${secret}::${signedPayload}`) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  return `deadbeef${(hash >>> 0).toString(16)}`;
}

const signature: WebhookSignaturePort = {
  sign: fakeDigest,
};

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh-1",
    name: "test",
    targetUrl: "https://example.com/hook",
    events: ["SALES_INVOICE_CONFIRMED"],
    secret: "topsecret",
    active: true,
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

function domainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    code: "SALES_INVOICE_CONFIRMED",
    occurredAt: "2026-08-22T10:05:00.000Z",
    payload: { invoiceId: "INV-1", amount: 100 },
    ...overrides,
  };
}

let idCounter = 0;
function freshDeps(overrides: Partial<{
  webhooks: WebhookRepository;
  deliveries: WebhookDeliveryRepository;
  transport: WebhookTransportPort;
}> = {}) {
  idCounter = 0;
  const webhooks = overrides.webhooks ?? new FakeWebhookRepository();
  const deliveries = overrides.deliveries ?? new FakeDeliveryRepository();
  return { webhooks, deliveries };
}

describe("WebhookDispatcher.handle — subscriber filtering", () => {
  it("delivers only to active webhooks subscribed to the fired event code", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-active-match", webhook({ id: "wh-active-match", active: true, events: ["SALES_INVOICE_CONFIRMED"] }));
    webhooks.rows.set("wh-inactive", webhook({ id: "wh-inactive", active: false, events: ["SALES_INVOICE_CONFIRMED"] }));
    webhooks.rows.set("wh-other-event", webhook({ id: "wh-other-event", active: true, events: ["CHEQUE_BOUNCED"] }));
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
    });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(1);
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]?.webhookId).toBe("wh-active-match");
  });

  it("does nothing (no transport call, no delivery record) when there are no subscribers", async () => {
    const { webhooks, deliveries } = freshDeps();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({ webhooks, deliveries, transport, signature, generateId: () => `id-${++idCounter}` });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(0);
    expect(deliveries.rows).toHaveLength(0);
  });

  it("fires every matching subscriber independently", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-a", webhook({ id: "wh-a" }));
    webhooks.rows.set("wh-b", webhook({ id: "wh-b" }));
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({ webhooks, deliveries, transport, signature, generateId: () => `id-${++idCounter}` });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(2);
    expect(new Set(deliveries.rows.map((d) => d.webhookId))).toEqual(new Set(["wh-a", "wh-b"]));
  });
});

describe("WebhookDispatcher.handle never rejects", () => {
  it("reports through onError and resolves when webhooks.list() throws", async () => {
    const webhooks: WebhookRepository = {
      list: async () => {
        throw new Error("db unavailable");
      },
      findById: async () => null,
      save: async () => {},
    };
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const errors: unknown[] = [];
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => "id-1",
      onError: (error) => errors.push(error),
    });

    await expect(dispatcher.handle(domainEvent())).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("db unavailable");
  });

  it("reports through onError and still resolves when the transport rejects on every attempt", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport: WebhookTransportPort = {
      send: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
      retry: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1 },
      sleep: async () => {},
    });

    await expect(dispatcher.handle(domainEvent())).resolves.toBeUndefined();
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]?.success).toBe(false);
    expect(deliveries.rows[0]?.statusCode).toBeNull();
    expect(deliveries.rows[0]?.errorMessage).toContain("ECONNREFUSED");
  });

  it("swallows a delivery-recording failure through onError instead of rejecting", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries: WebhookDeliveryRepository = {
      listForWebhook: async () => [],
      record: async () => {
        throw new Error("disk full");
      },
    };
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const errors: WebhookDispatchErrorContext[] = [];
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => "id-1",
      onError: (_error, context) => errors.push(context),
    });

    await expect(dispatcher.handle(domainEvent())).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.webhook?.id).toBe("wh-1");
  });
});

describe("WebhookDispatcher — request shape and no-secret-leak payload", () => {
  it("signs the body but never includes the secret in the body or any header value", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook({ secret: "s3cr3t-do-not-leak" }));
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => "delivery-1",
      now: () => "2026-08-22T10:05:00.000Z",
    });

    await dispatcher.handle(domainEvent());

    const request = transport.calls[0]!;
    expect(request.body).not.toContain("s3cr3t-do-not-leak");
    for (const value of Object.values(request.headers)) {
      expect(value).not.toContain("s3cr3t-do-not-leak");
    }
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body).toEqual({
      id: "delivery-1",
      event: "SALES_INVOICE_CONFIRMED",
      occurredAt: "2026-08-22T10:05:00.000Z",
      webhookId: "wh-1",
      data: { invoiceId: "INV-1", amount: 100 },
    });
  });

  it("stamps the standard headers, including a signature keyed by the webhook's own secret", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook({ secret: "abc" }));
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => "delivery-1",
      now: () => "2026-08-22T10:05:00.000Z",
    });

    await dispatcher.handle(domainEvent());

    const request = transport.calls[0]!;
    expect(request.url).toBe("https://example.com/hook");
    expect(request.headers[WEBHOOK_EVENT_HEADER]).toBe("SALES_INVOICE_CONFIRMED");
    expect(request.headers[WEBHOOK_DELIVERY_HEADER]).toBe("delivery-1");
    expect(request.headers[WEBHOOK_ATTEMPT_HEADER]).toBe("1");
    const expectedTimestamp = String(Math.floor(new Date("2026-08-22T10:05:00.000Z").getTime() / 1000));
    expect(request.headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(expectedTimestamp);
    const expectedDigest = signature.sign("abc", webhookSignedPayload(expectedTimestamp, request.body));
    expect(request.headers[WEBHOOK_SIGNATURE_HEADER]).toBe(formatWebhookSignature(expectedTimestamp, expectedDigest));
  });
});

describe("WebhookDispatcher — retry policy is bounded and every attempt is recorded", () => {
  it("succeeds without retrying when the first attempt returns 2xx", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 201, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
      retry: { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
      sleep: async () => {},
    });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(1);
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]?.success).toBe(true);
  });

  it("retries on a non-2xx response and records every attempt, up to maxAttempts", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([
      { statusCode: 500, errorMessage: null },
      { statusCode: 500, errorMessage: null },
      { statusCode: 500, errorMessage: null },
    ]);
    const sleeps: number[] = [];
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
      retry: { maxAttempts: 3, initialDelayMs: 100, backoffFactor: 2 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(3);
    expect(deliveries.rows).toHaveLength(3);
    expect(deliveries.rows.every((r) => r.success === false)).toBe(true);
    // exponential backoff between attempts 1->2 and 2->3, none after the final attempt
    expect(sleeps).toEqual([100, 200]);
    expect(deliveries.rows.at(-1)?.errorMessage).toContain("giving up");
  });

  it("recovers on a later attempt after earlier failures — stops retrying once it succeeds", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([
      { statusCode: 500, errorMessage: null },
      { statusCode: 200, errorMessage: null },
    ]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
      retry: { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
      sleep: async () => {},
    });

    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(2);
    expect(deliveries.rows).toHaveLength(2);
    expect(deliveries.rows[0]?.success).toBe(false);
    expect(deliveries.rows[1]?.success).toBe(true);
  });

  it("increments the attempt header on every retry, keeping the same delivery id", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([
      { statusCode: 500, errorMessage: null },
      { statusCode: 200, errorMessage: null },
    ]);
    const dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => "delivery-x",
      retry: { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
      sleep: async () => {},
    });

    await dispatcher.handle(domainEvent());

    expect(transport.calls.map((c) => c.headers[WEBHOOK_ATTEMPT_HEADER])).toEqual(["1", "2"]);
    expect(new Set(transport.calls.map((c) => c.headers[WEBHOOK_DELIVERY_HEADER]))).toEqual(new Set(["delivery-x"]));
  });
});

describe("WebhookDispatcher.stop — abandons in-flight retries", () => {
  it("a delivery already in progress stops after stop() is called, without recording the abandoned attempt", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([
      { statusCode: 500, errorMessage: null },
      { statusCode: 500, errorMessage: null },
      { statusCode: 200, errorMessage: null },
    ]);
    let dispatcher!: WebhookDispatcher;
    const sleep = async () => {
      dispatcher.stop();
    };
    dispatcher = new WebhookDispatcher({
      webhooks,
      deliveries,
      transport,
      signature,
      generateId: () => `id-${++idCounter}`,
      retry: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 1 },
      sleep,
    });

    await dispatcher.handle(domainEvent());

    // First attempt fails and is recorded, then the pause between attempts calls
    // stop() — the loop checks `stopped` right after the pause and returns.
    expect(transport.calls).toHaveLength(1);
    expect(deliveries.rows).toHaveLength(1);
  });

  it("handle() called after stop() delivers nothing", async () => {
    const webhooks = new FakeWebhookRepository();
    webhooks.rows.set("wh-1", webhook());
    const deliveries = new FakeDeliveryRepository();
    const transport = new ScriptedTransport([{ statusCode: 200, errorMessage: null }]);
    const dispatcher = new WebhookDispatcher({ webhooks, deliveries, transport, signature, generateId: () => "id-1" });

    dispatcher.stop();
    await dispatcher.handle(domainEvent());

    expect(transport.calls).toHaveLength(0);
    expect(deliveries.rows).toHaveLength(0);
  });
});

describe("webhookSignedPayload / formatWebhookSignature", () => {
  it("signs '<timestamp>.<body>' exactly", () => {
    expect(webhookSignedPayload("1000", '{"a":1}')).toBe('1000.{"a":1}');
  });

  it("formats the header as t=<ts>,v1=<hex>", () => {
    expect(formatWebhookSignature("1000", "deadbeef")).toBe("t=1000,v1=deadbeef");
  });
});
