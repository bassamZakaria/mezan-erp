import { isValidSlug } from "@mezan/domain";

export interface TenantResolverOptions {
  readonly tenantDomain?: string;
  /** Trust `x-forwarded-host` over `Host` — only safe behind a proxy that sets it. Default false. */
  readonly trustForwardedHost?: boolean;
  /** Allow the `x-mezan-tenant` header to name the tenant. Default true. */
  readonly allowTenantHeader?: boolean;
}

export const TENANT_HEADER = "x-mezan-tenant";

export function requestHost(request: Request, trustForwardedHost: boolean): string | null {
  const raw = (trustForwardedHost ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host");
  if (!raw) return null;
  return raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

function slugOrNull(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase();
  return isValidSlug(code) ? code : null;
}

// SECURITY: the one place a host is read as a tenant subdomain. The label must
// be a tenant code and nothing else; every caller that trusts a host for
// routing, for a mode or for a mailed link goes through here.
export function tenantSlugOfHost(host: string | null, tenantDomain: string | undefined): string | null {
  const domain = tenantDomain?.toLowerCase();
  if (!domain || !host || !host.endsWith(`.${domain}`)) return null;
  const label = host.slice(0, -(domain.length + 1));
  return isValidSlug(label) ? label : null;
}

export function resolveTenantCode(request: Request, options: TenantResolverOptions): string | null {
  const fromHost = tenantSlugOfHost(requestHost(request, options.trustForwardedHost ?? false), options.tenantDomain);
  if (fromHost) return fromHost;
  if (options.allowTenantHeader === false) return null;
  return slugOrNull(request.headers.get(TENANT_HEADER));
}
