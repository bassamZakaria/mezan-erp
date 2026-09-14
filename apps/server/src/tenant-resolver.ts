import { isValidSlug } from "@mezan/domain";

export interface TenantResolverOptions {
  readonly tenantDomain?: string;
  /** Trust `x-forwarded-host` over `Host` — only safe behind a proxy that sets it. Default false. */
  readonly trustForwardedHost?: boolean;
  /** Allow the `x-mezan-tenant` header to name the tenant. Default true. */
  readonly allowTenantHeader?: boolean;
}

export const TENANT_HEADER = "x-mezan-tenant";

function hostOf(request: Request, trustForwardedHost: boolean): string | null {
  const raw = (trustForwardedHost ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host");
  if (!raw) return null;
  return raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

function slugOrNull(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase();
  return isValidSlug(code) ? code : null;
}

export function resolveTenantCode(request: Request, options: TenantResolverOptions): string | null {
  const domain = options.tenantDomain?.toLowerCase();
  const host = hostOf(request, options.trustForwardedHost ?? false);
  if (domain && host && host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -(domain.length + 1));
    if (!label.includes(".")) return slugOrNull(label);
  }
  if (options.allowTenantHeader === false) return null;
  return slugOrNull(request.headers.get(TENANT_HEADER));
}
