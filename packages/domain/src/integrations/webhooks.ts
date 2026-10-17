import { WEBHOOK_TEST_EVENT, WebhookDeliveryStatusDTO } from "@mezan/contracts";
import { isEventCode } from "../events/catalog.js";
import { EVENT_BRANCH_IDS_KEY, eventBranchIdsOf } from "../notifications/branch-audience.js";

export const MAX_WEBHOOKS = 20;
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
export const WEBHOOK_DELIVERY_BATCH = 10;
export const WEBHOOK_DELIVERY_LEASE_MS = 60_000;
export const WEBHOOK_RESPONSE_EXCERPT_MAX = 300;

export interface WebhookRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffFactor: number;
  readonly maxDelayMs: number;
  readonly timeoutMs: number;
}

export const WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = {
  maxAttempts: 8,
  initialDelayMs: 30_000,
  backoffFactor: 4,
  maxDelayMs: 6 * 60 * 60_000,
  timeoutMs: 10_000,
};

/** Delay before the attempt that follows `attemptsMade` failed tries: 30s, 2m, 8m, 32m, ~2h, then 6h. */
export function webhookRetryDelayMs(attemptsMade: number, policy: WebhookRetryPolicy = WEBHOOK_RETRY_POLICY): number {
  const exponent = Math.max(0, attemptsMade - 1);
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.backoffFactor ** exponent);
}

// CONTRACT (receivers verify this): the signed bytes are `<unix seconds>.<raw body>`, and the
// header reads `t=<unix seconds>,v1=<hex HMAC-SHA256>`. Changing either breaks every receiver.
export function webhookSignedPayload(timestampSeconds: string, body: string): string {
  return `${timestampSeconds}.${body}`;
}

export function formatWebhookSignature(timestampSeconds: string, hexDigest: string): string {
  return `t=${timestampSeconds},v1=${hexDigest}`;
}

export interface WebhookRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly active: boolean;
  readonly signingSecret: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly secretRotatedAt: string;
}

export interface WebhookDeliveryRecord {
  readonly id: string;
  readonly webhookId: string;
  readonly eventCode: string;
  readonly payload: string;
  readonly branchIds: readonly string[];
  readonly status: WebhookDeliveryStatusDTO;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly redeliveryOf: string | null;
}

export function unknownWebhookEvents(codes: readonly string[]): string[] {
  return codes.filter((code) => !isEventCode(code));
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal"]);

/**
 * The checks that need no network: https, no credentials in the address, a host name that is not
 * a private alias. The address the name resolves to is vetted again before every delivery.
 */
export function webhookTargetProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "عنوان الاستقبال غير صالح.";
  }
  if (url.protocol !== "https:") return "يجب أن يبدأ عنوان الاستقبال بـ https://";
  if (url.username !== "" || url.password !== "") return "لا يُقبل اسم مستخدم أو كلمة مرور داخل عنوان الاستقبال.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "" || BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return "لا يمكن إرسال webhook إلى عنوان داخلي.";
  }
  if (host.includes(":")) return "عناوين IPv6 المباشرة غير مسموح بها؛ استخدم اسم مضيف.";
  return null;
}

function publicData(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const { [EVENT_BRANCH_IDS_KEY]: branchIds, ...rest } = payload as Record<string, unknown>;
  return { ...rest, branchIds: Array.isArray(branchIds) ? branchIds : [] };
}

export interface WebhookEnvelopeInput {
  readonly deliveryId: string;
  readonly webhookId: string;
  readonly eventCode: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export interface WebhookEnvelope {
  readonly body: string;
  readonly branchIds: readonly string[];
}

export function webhookEnvelope(input: WebhookEnvelopeInput): WebhookEnvelope {
  return {
    body: JSON.stringify({
      id: input.deliveryId,
      event: input.eventCode,
      occurredAt: input.occurredAt,
      webhookId: input.webhookId,
      data: publicData(input.payload),
    }),
    branchIds: eventBranchIdsOf(input.payload),
  };
}

export function webhookTestEnvelope(input: Omit<WebhookEnvelopeInput, "eventCode" | "payload">): WebhookEnvelope {
  return webhookEnvelope({ ...input, eventCode: WEBHOOK_TEST_EVENT, payload: { message: "Mezan webhook test" } });
}

export function deliveryOutcomeAfterFailure(attemptsMade: number, policy: WebhookRetryPolicy = WEBHOOK_RETRY_POLICY): WebhookDeliveryStatusDTO {
  return attemptsMade >= policy.maxAttempts ? WebhookDeliveryStatusDTO.DeadLetter : WebhookDeliveryStatusDTO.Pending;
}
