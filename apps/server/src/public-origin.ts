import type { PlatformHandle } from "@mezan/backend";
import { isReservedTenantCode, tenantIsServed } from "@mezan/domain";
import { configuredPublicOrigin, type CloudEnv } from "./env.js";
import { requestHost, tenantSlugOfHost } from "./tenant-resolver.js";

export type ServedTenantLookup = (code: string) => Promise<boolean>;

export function servedTenantLookup(platform: PlatformHandle): ServedTenantLookup {
  return async (code) => tenantIsServed(await platform.stores.tenants.findByCode(code));
}

// SECURITY: a name the platform keeps for itself (`www`, `api`, a released
// code) may be served by something other than this application. It is never
// written into a link, whoever asks.
function tenantOrigin(env: CloudEnv, slug: string | null): string | null {
  const domain = env.tenantDomain?.toLowerCase();
  if (!domain || !slug || isReservedTenantCode(slug)) return null;
  const host = `${slug}.${domain}`;
  const configured = configuredPublicOrigin(env);
  const candidate = `${configured ? new URL(configured).protocol : "https:"}//${host}`;
  if (!URL.canParse(candidate)) return null;
  const parsed = new URL(candidate);
  return parsed.host === host && parsed.origin === candidate ? parsed.origin : null;
}

// SECURITY: a link that is mailed or redirected to must never carry a host the
// caller merely claimed. A subdomain is answered only when a tenant is served
// under it; otherwise the configured public origin is. Null means no origin
// can be trusted, and the caller must not send the link anywhere.
export async function trustedPublicOrigin(request: Request, env: CloudEnv, servesTenant: ServedTenantLookup): Promise<string | null> {
  const slug = tenantSlugOfHost(requestHost(request, env.trustProxy), env.tenantDomain);
  const onTenantSubdomain = slug !== null && (await servesTenant(slug)) ? tenantOrigin(env, slug) : null;
  return onTenantSubdomain ?? configuredPublicOrigin(env) ?? null;
}

export function tenantPublicOrigin(env: CloudEnv, tenantCode: string): string | null {
  return configuredPublicOrigin(env) ?? tenantOrigin(env, tenantSlugOfHost(`${tenantCode}.${env.tenantDomain?.toLowerCase() ?? ""}`, env.tenantDomain));
}
