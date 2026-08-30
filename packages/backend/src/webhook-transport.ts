/**
 * The two side-effecting halves of the webhook dispatcher that may not live in
 * `packages/domain`: the outbound HTTP send and the HMAC-SHA256 primitive.
 * `WebhookDispatcher` (domain) decides what to send and what to sign; these
 * adapters just perform it.
 */

import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
 * Destinations a webhook may not be pointed at.
 *
 * A webhook URL is written by a user and fetched by the machine that holds the
 * books — which, on a desktop install, sits inside the shop's network and can
 * reach things the author cannot: the router's admin page, a NAS, another
 * till, a cloud metadata endpoint. That is server-side request forgery, and
 * the fix is to refuse the destination rather than to trust the author.
 *
 * `redirect: "manual"` below closes the other half: a public URL that answers
 * `302 http://192.168.1.1/` must not be followed.
 */
function isBlockedAddress(address: string): boolean {
  const v = address.toLowerCase();
  if (isIP(v) === 6) {
    const bare = v.startsWith("[") ? v.slice(1, -1) : v;
    if (bare === "::1" || bare === "::") return true;
    // Link-local (fe80::/10), unique-local (fc00::/7), and IPv4-mapped forms.
    if (/^fe[89ab]/.test(bare) || /^f[cd]/.test(bare)) return true;
    const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1] as string);
    // WHATWG `new URL()` REWRITES an IPv4-mapped address into hex form:
    // `[::ffff:127.0.0.1]` arrives here as `::ffff:7f00:1`. Matching only the
    // dotted spelling above therefore let loopback and every private range
    // straight through — the address is the same, only the spelling changed.
    const hex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1] as string, 16);
      const low = parseInt(hex[2] as string, 16);
      return isBlockedAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    return false;
  }
  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 127) return true; // this host / loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export class WebhookDestinationRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebhookDestinationRefusedError";
  }
}

/** Throws unless `rawUrl` is an http(s) address that resolves outside the local network. */
async function assertDeliverableDestination(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookDestinationRefusedError("عنوان غير صالح.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookDestinationRefusedError(`البروتوكول ${url.protocol} غير مسموح به.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0) throw new WebhookDestinationRefusedError("تعذّر تحويل اسم المضيف.");
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebhookDestinationRefusedError("لا يمكن إرسال webhook إلى عنوان داخلي.");
    }
  }
}

/**
 * `fetch`-backed transport. It never throws: a refused connection, DNS
 * failure, timeout or blocked destination comes back as `statusCode: null`
 * plus a message, which the dispatcher records as a failed attempt.
 */
export function createFetchWebhookTransport(): WebhookTransportPort {
  return {
    async send(request: WebhookHttpRequest): Promise<WebhookHttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        await assertDeliverableDestination(request.url);
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
