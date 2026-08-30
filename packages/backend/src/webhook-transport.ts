/**
 * The two side-effecting halves of the webhook dispatcher that may not live in
 * `packages/domain`: the outbound HTTP send and the HMAC-SHA256 primitive.
 * `WebhookDispatcher` (domain) decides what to send and what to sign; these
 * adapters just perform it.
 */

import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
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
 */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
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

/**
 * True for any address a webhook may not reach.
 *
 * IPv6 IS PARSED, NOT PATTERN-MATCHED. The previous version tested spellings
 * with regexes, and an address has many: `::ffff:127.0.0.1`, `::ffff:7f00:1`
 * and `0:0:0:0:0:ffff:7f00:1` are the same loopback, and each regex added
 * caught one more of them. Expanding the literal to its sixteen bytes ends the
 * game — there is one canonical form and the checks run against that.
 */
function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] as string;
  const kind = isIP(bare);
  if (kind === 4) return isBlockedIpv4(bare);
  if (kind !== 6) return true; // not an address at all: refuse rather than guess
  const bytes = ipv6Bytes(bare);
  if (!bytes) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d), in every
  // spelling, are IPv4 addresses and are judged as such.
  const firstTenZero = bytes.slice(0, 10).every((b) => b === 0);
  if (firstTenZero && ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))) {
    // `::` and `::1` land here as 0.0.0.0 / 0.0.0.1, both of which
    // `isBlockedIpv4` already refuses on `a === 0`.
    return isBlockedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  const first = bytes[0] as number;
  const second = bytes[1] as number;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (first === 0xff) return true; // ff00::/8 multicast
  return false;
}

/** Expands any legal IPv6 text form to its 16 bytes, or null when it is not one. */
function ipv6Bytes(text: string): number[] | null {
  if (isIP(text) !== 6) return null;
  let head = text;
  let tailV4: number[] = [];
  const lastColon = head.lastIndexOf(":");
  const maybeV4 = head.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (isIP(maybeV4) !== 4) return null;
    tailV4 = maybeV4.split(".").map(Number);
    head = head.slice(0, lastColon + 1) + "0:0";
  }
  const [left, right] = head.includes("::") ? head.split("::") : [head, null];
  const leftGroups = left && left.length > 0 ? left.split(":") : [];
  const rightGroups = right && right.length > 0 ? right.split(":") : [];
  const total = 8 - (tailV4.length ? 1 : 0);
  const fill = total - leftGroups.length - rightGroups.length;
  if (right === null && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...leftGroups, ...Array<string>(fill).fill("0"), ...rightGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  bytes.push(...tailV4);
  return bytes.length === 16 ? bytes : null;
}

export class WebhookDestinationRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebhookDestinationRefusedError";
  }
}

interface PinnedDestination {
  readonly url: URL;
  /** The exact address the socket will connect to — resolved ONCE, then reused. */
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Resolves and vets the destination, and returns the ADDRESS the connection
 * must use.
 *
 * Returning the address is the point. Vetting `lookup()`'s answer and then
 * handing the NAME to `fetch` resolved it a second time, independently — so an
 * author who controls their own authoritative DNS answered the check with a
 * public address and the connection with an internal one. That is classic DNS
 * rebinding, and no amount of address filtering closes it while the two
 * resolutions are separate.
 *
 * A raw IPv6 literal host is refused outright rather than parsed and allowed.
 * A shop's webhook receiver is not addressed by a bracketed IPv6 literal, and
 * every bug this check has ever had was a spelling this file failed to expect.
 */
async function resolveDeliverableDestination(rawUrl: string): Promise<PinnedDestination> {
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
  if (isIP(host) === 6) {
    throw new WebhookDestinationRefusedError("عناوين IPv6 المباشرة غير مسموح بها؛ استخدم اسم مضيف.");
  }
  if (isIP(host) === 4) {
    if (isBlockedAddress(host)) {
      throw new WebhookDestinationRefusedError("لا يمكن إرسال webhook إلى عنوان داخلي.");
    }
    return { url, address: host, family: 4 };
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) throw new WebhookDestinationRefusedError("تعذّر تحويل اسم المضيف.");
  // EVERY answer is checked, not just the one that will be used: a name that
  // resolves to one public and one private address is a rebinding attempt with
  // the work already done.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebhookDestinationRefusedError("لا يمكن إرسال webhook إلى عنوان داخلي.");
    }
  }
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/**
 * Node-http transport with the destination address PINNED.
 *
 * `fetch` was the obvious choice and the wrong one: there is no way to tell it
 * which address to connect to, so the vetted resolution and the connected
 * resolution were always two different events. `http.request` takes a `lookup`,
 * so the socket goes to the address that was checked and nowhere else, while
 * the TLS handshake still uses the real hostname for SNI and certificate
 * validation.
 *
 * It never throws: a refused connection, DNS failure, timeout or blocked
 * destination comes back as `statusCode: null` plus a message, which the
 * dispatcher records as a failed attempt. Redirects are never followed — a
 * public URL that answers `302 http://192.168.1.1/` is the same attack from
 * the other end.
 */
export function createFetchWebhookTransport(): WebhookTransportPort {
  return {
    async send(request: WebhookHttpRequest): Promise<WebhookHttpResponse> {
      const startedAt = Date.now();
      let pinned: PinnedDestination;
      try {
        // The timeout budget starts HERE and the request gets what is left of
        // it. The timer used to be armed before the DNS lookup, which ignores
        // an AbortSignal entirely, so a stalling resolver hung the dispatcher
        // straight past `timeoutMs`.
        pinned = await withDeadline(resolveDeliverableDestination(request.url), request.timeoutMs);
      } catch (error) {
        return { statusCode: null, errorMessage: describe(error) };
      }
      const remaining = Math.max(1, request.timeoutMs - (Date.now() - startedAt));
      try {
        const status = await sendPinned(request, pinned, remaining);
        return {
          statusCode: status,
          errorMessage: status >= 200 && status < 300 ? null : `HTTP ${status}`,
        };
      } catch (error) {
        return { statusCode: null, errorMessage: describe(error) };
      }
    },
  };
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`انتهت المهلة بعد ${ms}ms.`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function sendPinned(
  request: WebhookHttpRequest,
  pinned: PinnedDestination,
  timeoutMs: number,
): Promise<number> {
  const { url, address, family } = pinned;
  const transport = url.protocol === "https:" ? https : http;
  return new Promise<number>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        host: url.hostname,
        // The vetted address, and only it. `lookup` is consulted by
        // `net.connect` at the moment it dials, so this is the resolution the
        // socket actually uses — there is no second one to poison.
        lookup: (_hostname, _options, callback) => {
          (callback as (err: NodeJS.ErrnoException | null, addr: string, fam: number) => void)(null, address, family);
        },
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...request.headers, host: url.host },
        timeout: timeoutMs,
      },
      (res) => {
        // Drain so the socket is released rather than left half-read.
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`انتهت المهلة بعد ${timeoutMs}ms.`));
    });
    req.on("error", reject);
    req.end(request.body);
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== error.message) return `${error.message}: ${cause.message}`;
    return error.message;
  }
  return String(error);
}
