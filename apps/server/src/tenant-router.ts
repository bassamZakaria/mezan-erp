import { Hono } from "hono";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createBackend, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { resolveTenantCode, TENANT_HEADER } from "./tenant-resolver.js";

export interface TenantRouterOptions {
  readonly platform: PlatformHandle;
  readonly dataDir: string;
  readonly tenantDomain?: string;
  readonly idleMs?: number;
  readonly sweepEveryMs?: number;
  readonly now?: () => Date;
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers) => Promise<BackendHandle>;
}

export interface TenantRouter {
  readonly app: Hono;
  invalidate(code: string): void;
  close(): Promise<void>;
}

export function tenantDbPath(dataDir: string, dbFile: string): string {
  return path.join(dataDir, dbFile);
}

/**
 * Whether THIS request's host actually matched the configured tenant domain
 * (a real subdomain hit), as opposed to `tenantDomain` merely being
 * configured for the deployment. `resolveTenantCode` folds subdomain and
 * header resolution into one code and can't tell them apart afterwards, so
 * `/platform/resolve` needs its own check to report which mechanism this
 * particular request used.
 */
function hostMatchesTenantDomain(request: Request, tenantDomain: string | undefined): boolean {
  if (!tenantDomain) return false;
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!raw) return false;
  const host = raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
  const domain = tenantDomain.toLowerCase();
  if (!host.endsWith(`.${domain}`)) return false;
  const label = host.slice(0, -(domain.length + 1));
  return !label.includes(".");
}

export function createTenantRouter(options: TenantRouterOptions): TenantRouter {
  const resolvers = new Map<string, TenantResolvers>();
  const resolversFor = (code: string) => {
    let r = resolvers.get(code);
    if (!r) { r = createTenantResolvers(options.platform, code, { now: options.now }); resolvers.set(code, r); }
    return r;
  };
  const openBackend = options.openBackend ?? (async (_code, dbPath, r) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
    });
  });
  const cache: BackendCache<BackendHandle> = createBackendCache({
    idleMs: options.idleMs,
    sweepEveryMs: options.sweepEveryMs,
    open: async (code) => {
      const tenant = await options.platform.stores.tenants.findByCode(code);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");
      return openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code));
    },
  });

  const app = new Hono();
  const resolverOptions = { tenantDomain: options.tenantDomain };

  app.get("/platform/resolve", async (c) => {
    const mode = hostMatchesTenantDomain(c.req.raw, options.tenantDomain) ? "subdomain" : "code";
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    const tenant = code ? await options.platform.stores.tenants.findByCode(code) : null;
    const usable = tenant && (tenant.status === "active" || tenant.status === "suspended");
    return c.json({ mode, tenant: usable ? { code: tenant.code, nameAr: tenant.nameAr, nameEn: tenant.nameEn } : null });
  });

  /**
   * Named wildcard (`:rest{.*}`), not a bare `/*` — `c.req.raw` keeps
   * whatever URL the caller used all the way through Hono's own `route()`
   * mounting (verified: `.route("/api", app)` never rewrites `c.req.raw`).
   * Forwarding it unchanged would hand the tenant backend `/api/tenant`
   * instead of `/tenant` once `cloud.ts` mounts this router under `/api`.
   * The named capture always holds this router's OWN sub-path regardless of
   * any ancestor prefix, so the request is rebuilt from it before dispatch.
   */
  app.all("/:rest{.*}", async (c) => {
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    if (!code) return c.json({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" }, 400);
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === "archived" || tenant.status === "provisioning") {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    const backend = await cache.get(code);
    const rest = c.req.param("rest");
    const targetUrl = new URL(`/${rest}${new URL(c.req.raw.url).search}`, c.req.raw.url);
    return backend.app.fetch(new Request(targetUrl, c.req.raw));
  });

  return {
    app,
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    close: () => cache.close(),
  };
}

export { TENANT_HEADER };
