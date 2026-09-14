import { isValidSlug } from "@mezan/domain";

export interface TenantResolverOptions {
  readonly tenantDomain?: string;
}

export const TENANT_HEADER = "x-mezan-tenant";

function hostOf(request: Request): string | null {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
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
  const host = hostOf(request);
  if (domain && host && host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -(domain.length + 1));
    if (!label.includes(".")) return slugOrNull(label);
  }
  return slugOrNull(request.headers.get(TENANT_HEADER));
}
