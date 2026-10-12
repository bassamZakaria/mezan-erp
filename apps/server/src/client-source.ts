import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";
import { canonicalOrigin, requestOrigin } from "@mezan/api";

declare const cloudSourceBrand: unique symbol;

/** The address a cloud request is counted and bound against. Never null: null is the desktop's own console and nothing on the cloud path may read as it. */
export type CloudSource = string & { readonly [cloudSourceBrand]: true };

// SECURITY: what a request is counted as when its address cannot be read from
// the trusted chain. It is a remote source like any other — throttled per
// source, never exempt as the host's console — and no session is ever issued
// to it, so presenting it can never match a bound session.
export const UNRESOLVED_SOURCE = "unresolved.invalid" as CloudSource;

export function isResolvedSource(source: CloudSource): boolean {
  return source !== UNRESOLVED_SOURCE;
}

export interface ViewerMismatch {
  readonly counted: CloudSource;
  readonly viewer: string;
  readonly trustedProxyHops: number;
}

export interface ClientSourceOptions {
  readonly trustedProxyHops: number;
  readonly trustViewerAddress: boolean;
  /** True where an origin secret proves every request crossed CloudFront, so its viewer address can check the hop count. */
  readonly compareViewerAddress: boolean;
  readonly onViewerMismatch?: (mismatch: ViewerMismatch) => void;
  /** The one header this deployment's edge writes the caller's address in, lower-cased. Read only when a proxy is trusted. */
  readonly trustedAddressHeader?: string;
}

const VIEWER_ADDRESS = "cloudfront-viewer-address";
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

function viewerAddress(header: string | undefined): CloudSource | null {
  const text = header?.trim().toLowerCase() ?? "";
  const portAt = text.lastIndexOf(":");
  if (portAt <= 0) return null;
  return canonical(text.slice(0, portAt).replace(/^\[/, "").replace(/\]$/, ""));
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
    return (peer === null ? null : canonical(canonicalOrigin(peer) ?? "")) ?? UNRESOLVED_SOURCE;
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
  const viewer = options.trustViewerAddress || options.compareViewerAddress ? viewerAddress(c.req.header(VIEWER_ADDRESS)) : null;
  const counted = countedSource(c, options.trustedProxyHops, options.trustedAddressHeader);
  if (options.compareViewerAddress && viewer !== null && viewer !== counted) {
    options.onViewerMismatch?.({ counted, viewer, trustedProxyHops: options.trustedProxyHops });
  }
  return options.trustViewerAddress && viewer !== null ? viewer : counted;
}

export const SOCKET_ONLY: ClientSourceOptions = { trustedProxyHops: 0, trustViewerAddress: false, compareViewerAddress: false };

export interface OriginEnv {
  readonly incoming: { readonly socket: { readonly remoteAddress: string } };
}

/** The environment a tenant backend reads its caller's address from (`requestOrigin`): set by this process, never by a header. */
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
  viewerMismatch(mismatch: ViewerMismatch): void;
}

/** Logs the first of each fault at once, then one line a minute with how many it held back: a flood must not be able to fill the log. */
export function createSourceReporter(log: (line: string) => void = (line) => console.error(line), now: () => number = Date.now): SourceReporter {
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
    viewerMismatch(mismatch) {
      report("viewer", () =>
        `[cloud] CLIENT ADDRESS MISMATCH: hop ${mismatch.trustedProxyHops} from the right of x-forwarded-for reads ${mismatch.counted}, CloudFront-Viewer-Address reads ${mismatch.viewer}. MEZAN_TRUSTED_PROXY_HOPS is wrong for this deployment: throttles and sessions are keyed on the wrong machine.`);
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
    const source = cloudSource(c, { ...options, onViewerMismatch: (m) => reporter.viewerMismatch(m) });
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
