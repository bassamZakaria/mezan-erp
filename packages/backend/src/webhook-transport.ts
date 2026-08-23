/**
 * The two side-effecting halves of the webhook dispatcher that may not live in
 * `packages/domain`: the outbound HTTP send and the HMAC-SHA256 primitive.
 * `WebhookDispatcher` (domain) decides what to send and what to sign; these
 * adapters just perform it.
 */

import { createHmac } from "node:crypto";
import type {
  WebhookHttpRequest,
  WebhookHttpResponse,
  WebhookSignaturePort,
  WebhookTransportPort,
} from "@mezan/domain";

export function createHmacWebhookSigner(): WebhookSignaturePort {
  return {
    sign(secret, signedPayload) {
      return createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
    },
  };
}

/**
 * `fetch`-backed transport. It never throws: a refused connection, DNS
 * failure or timeout comes back as `statusCode: null` plus a message, which
 * the dispatcher records as a failed attempt.
 */
export function createFetchWebhookTransport(): WebhookTransportPort {
  return {
    async send(request: WebhookHttpRequest): Promise<WebhookHttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: "POST",
          headers: { ...request.headers },
          body: request.body,
          redirect: "manual",
          signal: controller.signal,
        });
        // Read the body out so the socket is released back to the agent pool.
        await response.arrayBuffer().catch(() => undefined);
        return {
          statusCode: response.status,
          errorMessage: response.status >= 200 && response.status < 300 ? null : `HTTP ${response.status}`,
        };
      } catch (error) {
        return { statusCode: null, errorMessage: describe(error) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== error.message) return `${error.message}: ${cause.message}`;
    return error.message;
  }
  return String(error);
}
