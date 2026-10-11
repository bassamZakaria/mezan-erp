import { isIP } from "node:net";
import type { Context } from "hono";
import { requestOrigin } from "@mezan/api";

export interface ClientSourceOptions {
  /** How many proxies this deployment sits behind that each append the address they saw to `x-forwarded-for`. */
  readonly trustedProxyHops: number;
  /** True only where every request provably crossed CloudFront, which overwrites `CloudFront-Viewer-Address`. */
  readonly trustViewerAddress: boolean;
}

const VIEWER_ADDRESS = "cloudfront-viewer-address";
const FORWARDED_FOR = "x-forwarded-for";

function address(candidate: string | undefined): string | null {
  const bare = candidate?.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase() ?? "";
  return isIP(bare) === 0 ? null : bare;
}

function viewerAddress(header: string | undefined): string | null {
  if (!header) return null;
  const portAt = header.lastIndexOf(":");
  return portAt <= 0 ? null : address(header.slice(0, portAt));
}

// SECURITY: a client writes `x-forwarded-for` itself and each trusted proxy
// only APPENDS to it, so the one hop that can be believed is counted from the
// right — the address the outermost trusted proxy saw. The leftmost hop is
// whatever the caller typed: keyed on it, a throttle is dodged by changing it
// and aimed at a victim by naming them.
export function clientSource(c: Context, options: ClientSourceOptions): string | null {
  if (options.trustViewerAddress) {
    const viewer = viewerAddress(c.req.header(VIEWER_ADDRESS));
    if (viewer) return viewer;
  }
  if (options.trustedProxyHops > 0) {
    const hops = (c.req.header(FORWARDED_FOR) ?? "").split(",");
    const appended = address(hops[hops.length - options.trustedProxyHops]);
    if (appended) return appended;
  }
  return requestOrigin(c);
}

/** The environment a tenant backend reads its caller's address from (`requestOrigin`): set by this process, never by a header. */
export function originEnv(source: string | null): { incoming: { socket: { remoteAddress: string } } } | undefined {
  return source === null ? undefined : { incoming: { socket: { remoteAddress: source } } };
}
