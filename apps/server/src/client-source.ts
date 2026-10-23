import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";
import { canonicalOrigin, requestOrigin } from "@mezan/api";
import { createLogger } from "@mezan/api";

const sourceLog = createLogger("client-source");

declare const cloudSourceBrand: unique symbol;

export type CloudSource = string & { readonly [cloudSourceBrand]: true };

// SECURITY: what a request is counted as when its address cannot be read from
// the trusted chain. It is a remote source like any other — throttled per
// source, never exempt as the host's console — and no session is ever issued
// to it, so presenting it can never match a bound session.
export const UNRESOLVED_SOURCE = "unresolved.invalid" as CloudSource;

export function isResolvedSource(source: CloudSource): boolean {
  return source !== UNRESOLVED_SOURCE;
}

export interface ClientSourceOptions {
  readonly trustedProxyHops: number;
  readonly trustedAddressHeader?: string;
}

const FORWARDED_FOR = "x-forwarded-for";
const V4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED = /^\[([^\]]+)\](?::\d{1,5})?$/;

function canonical(candidate: string): CloudSource | null {
  if (isIP(candidate) === 0) return null;
  return canonicalOrigin(candidate) as CloudSource;
}

function forwardedEntry(entry: string | undefined): CloudSource | null {
  const text = entry?.trim().toLowerCase() ?? "";
  if (text === "") return null;
  const bare = V4_WITH_PORT.exec(text)?.[1] ?? BRACKETED.exec(text)?.[1] ?? text;
  return canonical(bare);
}

// SECURITY: a client writes `x-forwarded-for` itself and each trusted proxy
// only APPENDS to it, so the one hop that can be believed is counted from the
// right — the address the outermost trusted proxy saw. The leftmost hop is
// whatever the caller typed: keyed on it, a throttle is dodged by changing it
// and aimed at a victim by naming them. With a proxy trusted, the socket is the
// proxy and is never read: a chain that does not yield an address is
// UNRESOLVED, not somebody else's address and not the host.
function countedSource(c: Context, trustedProxyHops: number, trustedAddressHeader?: string): CloudSource {
  if (trustedProxyHops === 0) {
    const peer = requestOrigin(c);
    return (peer === null ? null : forwardedEntry(peer)) ?? UNRESOLVED_SOURCE;
  }
  // SECURITY: the named header is believed because the DEPLOYMENT says its
  // edge overwrites it on every request. A request without a usable value did
  // not come through that edge, so it is unresolved — never read from the
  // forwarded chain instead, which is the part of the request a caller writes.
  if (trustedAddressHeader !== undefined) return forwardedEntry(c.req.header(trustedAddressHeader)) ?? UNRESOLVED_SOURCE;
  const hops = (c.req.header(FORWARDED_FOR) ?? "").split(",");
  return forwardedEntry(hops[hops.length - trustedProxyHops]) ?? UNRESOLVED_SOURCE;
}

export function cloudSource(c: Context, options: ClientSourceOptions): CloudSource {
  return countedSource(c, options.trustedProxyHops, options.trustedAddressHeader);
}

export const SOCKET_ONLY: ClientSourceOptions = { trustedProxyHops: 0 };

export interface OriginEnv {
  readonly incoming: { readonly socket: { readonly remoteAddress: string } };
}

export function originEnv(source: CloudSource): OriginEnv {
  return { incoming: { socket: { remoteAddress: source } } };
}

declare module "hono" {
  interface ContextVariableMap {
    cloudSource?: CloudSource;
  }
}

export const SOURCE_UNRESOLVED = "SOURCE_UNRESOLVED";
const SOURCE_UNRESOLVED_STATUS = 503;
const SOURCE_UNRESOLVED_RETRY_SECONDS = 30;
const REPORT_EVERY_MS = 60_000;

export interface SourceReporter {
  unresolved(path: string): void;
}

export function createSourceReporter(log: (line: string) => void = (line) => sourceLog.error(line), now: () => number = Date.now): SourceReporter {
  const last = new Map<string, { at: number; held: number }>();
  function report(kind: string, line: () => string) {
    const at = now();
    const seen = last.get(kind);
    if (seen && at - seen.at < REPORT_EVERY_MS) {
      seen.held += 1;
      return;
    }
    log(`${line()}${seen && seen.held > 0 ? ` (${seen.held} more since the last report)` : ""}`);
    last.set(kind, { at, held: 0 });
  }
  return {
    unresolved(path) {
      report("unresolved", () =>
        `[cloud] CLIENT ADDRESS UNRESOLVED on ${path}: the forwarded chain did not carry an address at the trusted hop. Check MEZAN_TRUSTED_PROXY_HOPS against the proxies in front of this process. The request was refused.`);
    },
  };
}

// SECURITY / REQUIRED ORDERING: mounted in front of every cloud route that
// reaches a tenant backend, a session registry or a throttle. It derives the
// caller's source ONCE and refuses a request that has none, so no handler
// below can count, bind or look up a session against a missing address.
export function requireCloudSource(options: ClientSourceOptions, reporter: SourceReporter = createSourceReporter()): MiddlewareHandler {
  return async (c, next) => {
    if (c.get("cloudSource") !== undefined) return next();
    const source = cloudSource(c, options);
    if (!isResolvedSource(source)) {
      reporter.unresolved(c.req.path);
      c.header("retry-after", String(SOURCE_UNRESOLVED_RETRY_SECONDS));
      return c.json({ error: SOURCE_UNRESOLVED, message: "تعذّر تحديد مصدر الطلب. حاول مرة أخرى بعد قليل." }, SOURCE_UNRESOLVED_STATUS);
    }
    c.set("cloudSource", source);
    return next();
  };
}

export function callerSource(c: Context): CloudSource {
  const source = c.get("cloudSource");
  if (source === undefined) throw new Error("callerSource read on a route that is not behind requireCloudSource");
  return source;
}
