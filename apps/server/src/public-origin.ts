import type { CloudEnv } from "./env.js";

function configuredOrigin(env: CloudEnv): string | undefined {
  return env.publicOrigin ?? (env.paymob.mode === "off" ? undefined : env.paymob.publicUrl);
}

function requestHost(request: Request, env: CloudEnv): string {
  const raw = (env.trustProxy ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host") ?? "";
  return raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

function ownTenantHost(host: string, domain: string): boolean {
  return host.endsWith(`.${domain}`) && !host.slice(0, -(domain.length + 1)).includes(".");
}

// SECURITY: a link that is mailed or redirected to must never carry a host the
// caller merely claimed. Only the configured public origin, or one of this
// deployment's own tenant subdomains, is ever answered. Null means no origin
// can be trusted, and the caller must not send the link anywhere.
export function trustedPublicOrigin(request: Request, env: CloudEnv): string | null {
  const configured = configuredOrigin(env);
  const domain = env.tenantDomain?.toLowerCase();
  if (domain) {
    const host = requestHost(request, env);
    if (ownTenantHost(host, domain)) return `${configured ? new URL(configured).protocol : "https:"}//${host}`;
  }
  return configured ?? null;
}

/** For a link written with no request in hand: the configured origin, else the tenant's own subdomain. */
export function tenantPublicOrigin(env: CloudEnv, tenantCode: string): string | null {
  const configured = configuredOrigin(env);
  if (configured) return configured;
  return env.tenantDomain ? `https://${tenantCode}.${env.tenantDomain.toLowerCase()}` : null;
}
