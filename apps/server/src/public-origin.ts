import type { CloudEnv } from "./env.js";
import { requestHost, tenantSlugOfHost } from "./tenant-resolver.js";

function configuredOrigin(env: CloudEnv): string | undefined {
  return env.publicOrigin ?? (env.paymob.mode === "off" ? undefined : env.paymob.publicUrl);
}

// SECURITY: the origin is written from a validated tenant code and the
// configured domain, never from the text of a header. It is answered only when
// a URL parser reads back exactly that host.
function tenantOrigin(env: CloudEnv, slug: string | null): string | null {
  const domain = env.tenantDomain?.toLowerCase();
  if (!domain || !slug) return null;
  const host = `${slug}.${domain}`;
  const configured = configuredOrigin(env);
  const candidate = `${configured ? new URL(configured).protocol : "https:"}//${host}`;
  if (!URL.canParse(candidate)) return null;
  const parsed = new URL(candidate);
  return parsed.host === host && parsed.origin === candidate ? parsed.origin : null;
}

// SECURITY: a link that is mailed or redirected to must never carry a host the
// caller merely claimed. Only the configured public origin, or one of this
// deployment's own tenant subdomains, is ever answered. Null means no origin
// can be trusted, and the caller must not send the link anywhere.
export function trustedPublicOrigin(request: Request, env: CloudEnv): string | null {
  return tenantOrigin(env, tenantSlugOfHost(requestHost(request, env.trustProxy), env.tenantDomain)) ?? configuredOrigin(env) ?? null;
}

export function tenantPublicOrigin(env: CloudEnv, tenantCode: string): string | null {
  return configuredOrigin(env) ?? tenantOrigin(env, tenantSlugOfHost(`${tenantCode}.${env.tenantDomain?.toLowerCase() ?? ""}`, env.tenantDomain));
}
