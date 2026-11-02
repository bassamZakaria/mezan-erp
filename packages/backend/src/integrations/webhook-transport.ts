import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as https from "node:https";
import { isIP } from "node:net";
import { webhookTargetProblem } from "@mezan/domain";
import { isBlockedWebhookAddress } from "@mezan/api";

export interface WebhookHttpRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface WebhookHttpResponse {
  readonly statusCode: number | null;
  readonly error: string | null;
}

export interface WebhookTransport {
  send(request: WebhookHttpRequest): Promise<WebhookHttpResponse>;
}

export function signWebhookPayload(secret: string, signedPayload: string): string {
  return createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

export { isBlockedWebhookAddress };

export class WebhookDestinationRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebhookDestinationRefusedError";
  }
}

interface PinnedDestination {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
}

const INTERNAL_TARGET = "لا يمكن إرسال webhook إلى عنوان داخلي.";

// SECURITY: returns the ADDRESS the socket must use. Vetting one resolution and connecting with a
// second is DNS rebinding; every answer is vetted, and only the vetted address is dialled.
async function resolveDeliverableDestination(rawUrl: string): Promise<PinnedDestination> {
  const problem = webhookTargetProblem(rawUrl);
  if (problem) throw new WebhookDestinationRefusedError(problem.message);
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) === 4) {
    if (isBlockedWebhookAddress(host)) throw new WebhookDestinationRefusedError(INTERNAL_TARGET);
    return { url, address: host, family: 4 };
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new WebhookDestinationRefusedError("تعذّر تحويل اسم المضيف.");
  for (const { address } of addresses) {
    if (isBlockedWebhookAddress(address)) throw new WebhookDestinationRefusedError(INTERNAL_TARGET);
  }
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
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

// SECURITY: redirects are never followed — a public URL answering `302 http://10.0.0.1/` is the
// same attack from the other end.
function sendPinned(request: WebhookHttpRequest, pinned: PinnedDestination, timeoutMs: number): Promise<number> {
  const { url, address, family } = pinned;
  return new Promise<number>((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        host: url.hostname,
        servername: isIP(url.hostname) === 0 ? url.hostname : undefined,
        lookup: (_hostname, _options, callback) => {
          (callback as (err: NodeJS.ErrnoException | null, addr: string, fam: number) => void)(null, address, family);
        },
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...request.headers, host: url.host, "content-length": String(Buffer.byteLength(request.body)) },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`انتهت المهلة بعد ${timeoutMs}ms.`)));
    req.on("error", reject);
    req.end(request.body);
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && cause.message !== error.message ? `${error.message}: ${cause.message}` : error.message;
  }
  return String(error);
}

export function createPinnedWebhookTransport(): WebhookTransport {
  return {
    async send(request) {
      const startedAt = Date.now();
      let pinned: PinnedDestination;
      try {
        pinned = await withDeadline(resolveDeliverableDestination(request.url), request.timeoutMs);
      } catch (error) {
        return { statusCode: null, error: describe(error) };
      }
      const remaining = Math.max(1, request.timeoutMs - (Date.now() - startedAt));
      try {
        const status = await sendPinned(request, pinned, remaining);
        return { statusCode: status, error: status >= 200 && status < 300 ? null : `HTTP ${status}` };
      } catch (error) {
        return { statusCode: null, error: describe(error) };
      }
    },
  };
}
