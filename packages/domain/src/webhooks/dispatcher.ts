/**
 * Webhook dispatcher — the piece that turns a subscription into a real
 * outbound call.
 *
 * It subscribes to the domain `EventBus` exactly like the notification-rules
 * engine does (`handle(event)`, wired through `eventBus.subscribeAll` in the
 * composition root), and for every ACTIVE webhook whose event list contains
 * the fired code it builds ONE signed JSON body and hands it to the
 * {@link WebhookTransportPort} — the HTTP send is I/O, so it lives behind a
 * port here and is implemented in the composition root, never in this package.
 *
 * Two invariants this file exists to hold:
 *
 * 1. A broken receiver must never fail the domain flow that emitted the event.
 *    `handle` resolves — it does not reject — for every failure mode below it
 *    (repository read, transport, signing, recording), reporting through
 *    `onError` instead. The caller still fires it detached.
 * 2. Retries are BOUNDED. `maxAttempts` total tries with exponential backoff,
 *    every attempt recorded, then the delivery is abandoned.
 */

import type { DomainEvent } from "../events/event-bus.js";
import { recordWebhookDelivery } from "./record-delivery.js";
import type { Webhook, WebhookDeliveryRepository, WebhookRepository } from "./webhook.js";

export interface WebhookHttpRequest {
  readonly url: string;
  /** The exact bytes the signature was computed over — the transport must not re-serialize. */
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface WebhookHttpResponse {
  /** `null` when no response was received at all (connection refused, DNS, timeout). */
  readonly statusCode: number | null;
  readonly errorMessage: string | null;
}

/** Outbound HTTP port. Implemented in the composition root — the domain does no I/O. */
export interface WebhookTransportPort {
  send(request: WebhookHttpRequest): Promise<WebhookHttpResponse>;
}

/**
 * HMAC-SHA256 signing port. `node:crypto` may not be imported here, so the
 * primitive itself is injected; this package only decides WHAT gets signed.
 */
export interface WebhookSignaturePort {
  /** Lowercase hex HMAC-SHA256 of `signedPayload` keyed by `secret`. */
  sign(secret: string, signedPayload: string): string;
}

export interface WebhookRetryPolicy {
  /** Total tries, including the first — never unbounded. */
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffFactor: number;
  readonly timeoutMs: number;
}

export const DEFAULT_WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffFactor: 4,
  timeoutMs: 10_000,
};

/** Header names a receiver reads to verify a delivery. */
export const WEBHOOK_SIGNATURE_HEADER = "x-mezan-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-mezan-timestamp";
export const WEBHOOK_EVENT_HEADER = "x-mezan-event";
export const WEBHOOK_DELIVERY_HEADER = "x-mezan-delivery";
export const WEBHOOK_ATTEMPT_HEADER = "x-mezan-attempt";

/**
 * The bytes signed for one attempt: `"<unix-seconds>.<raw body>"`. The
 * timestamp is inside the signed material (and echoed in its own header) so a
 * receiver can reject a captured request once it falls outside its tolerance
 * window — a body-only signature would stay valid forever.
 */
export function webhookSignedPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** The `x-mezan-signature` value: `t=<unix-seconds>,v1=<hex>` (versioned so the scheme can rotate). */
export function formatWebhookSignature(timestamp: string, hexDigest: string): string {
  return `t=${timestamp},v1=${hexDigest}`;
}

export interface WebhookDispatchErrorContext {
  readonly event: DomainEvent;
  readonly webhook?: Webhook;
}

export interface WebhookDispatcherDeps {
  readonly webhooks: WebhookRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly transport: WebhookTransportPort;
  readonly signature: WebhookSignaturePort;
  readonly generateId: () => string;
  readonly now?: () => string;
  readonly retry?: Partial<WebhookRetryPolicy>;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Reports a swallowed dispatch failure; without it failures are silent by design. */
  readonly onError?: (error: unknown, context: WebhookDispatchErrorContext) => void;
}

export class WebhookDispatcher {
  private readonly retry: WebhookRetryPolicy;

  private stopped = false;

  constructor(private readonly deps: WebhookDispatcherDeps) {
    this.retry = { ...DEFAULT_WEBHOOK_RETRY_POLICY, ...deps.retry };
  }

  /**
   * Abandons retries that are still waiting. A backoff pause outlives the
   * backend that started it, and the attempt after the store closed threw
   * "The database connection is not open" while trying to record itself —
   * losing the delivery record and printing a stack trace that reads like a
   * failure. Call this before closing the stores.
   */
  stop(): void {
    this.stopped = true;
  }

  /** Never rejects — see this file's doc comment, invariant 1. */
  async handle(event: DomainEvent): Promise<void> {
    let subscribers: readonly Webhook[];
    try {
      subscribers = (await this.deps.webhooks.list()).filter(
        (w) => w.active && w.events.includes(event.code),
      );
    } catch (error) {
      this.report(error, { event });
      return;
    }
    await Promise.all(subscribers.map((webhook) => this.deliver(webhook, event)));
  }

  private async deliver(webhook: Webhook, event: DomainEvent): Promise<void> {
    const deliveryId = this.deps.generateId();
    const body = JSON.stringify({
      id: deliveryId,
      event: event.code,
      occurredAt: event.occurredAt,
      webhookId: webhook.id,
      data: event.payload,
    });

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      if (this.stopped) return;
      const isFinal = attempt === this.retry.maxAttempts;
      let outcome: WebhookHttpResponse;
      try {
        outcome = await this.deps.transport.send(this.buildRequest(webhook, event, deliveryId, body, attempt));
      } catch (error) {
        outcome = { statusCode: null, errorMessage: describeError(error) };
      }

      const success =
        outcome.statusCode !== null && outcome.statusCode >= 200 && outcome.statusCode < 300;
      // A send already in flight when stop() was called lands here with the
      // store gone; recording it would throw on a closed connection.
      if (this.stopped) return;
      await this.record(webhook, event, attempt, isFinal, success, outcome);

      if (success || isFinal) return;
      await this.pause(this.retry.initialDelayMs * this.retry.backoffFactor ** (attempt - 1));
      // Checked AFTER the pause: that is the window in which shutdown happens.
      if (this.stopped) return;
    }
  }

  private buildRequest(
    webhook: Webhook,
    event: DomainEvent,
    deliveryId: string,
    body: string,
    attempt: number,
  ): WebhookHttpRequest {
    const timestamp = String(Math.floor(new Date(this.now()).getTime() / 1000));
    const digest = this.deps.signature.sign(webhook.secret, webhookSignedPayload(timestamp, body));
    return {
      url: webhook.targetUrl,
      body,
      timeoutMs: this.retry.timeoutMs,
      headers: {
        "content-type": "application/json",
        [WEBHOOK_EVENT_HEADER]: event.code,
        [WEBHOOK_DELIVERY_HEADER]: deliveryId,
        [WEBHOOK_ATTEMPT_HEADER]: String(attempt),
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_SIGNATURE_HEADER]: formatWebhookSignature(timestamp, digest),
      },
    };
  }

  private async record(
    webhook: Webhook,
    event: DomainEvent,
    attempt: number,
    isFinal: boolean,
    success: boolean,
    outcome: WebhookHttpResponse,
  ): Promise<void> {
    const detail = outcome.errorMessage ?? (outcome.statusCode === null ? "no response" : `HTTP ${outcome.statusCode}`);
    const suffix = isFinal ? " — giving up" : "";
    try {
      await recordWebhookDelivery(
        {
          id: this.deps.generateId(),
          webhookId: webhook.id,
          eventCode: event.code,
          statusCode: outcome.statusCode,
          success,
          errorMessage: success ? null : `attempt ${attempt}/${this.retry.maxAttempts}: ${detail}${suffix}`,
          attemptedAt: this.now(),
        },
        this.deps.webhooks,
        this.deps.deliveries,
      );
    } catch (error) {
      this.report(error, { event, webhook });
    }
  }

  private pause(ms: number): Promise<void> {
    if (this.deps.sleep) return this.deps.sleep(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private report(error: unknown, context: WebhookDispatchErrorContext): void {
    this.deps.onError?.(error, context);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
