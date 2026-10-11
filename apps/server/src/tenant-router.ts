import { Hono, type MiddlewareHandler } from "hono";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { createBackend, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import type { SqliteOpenOptions } from "@mezan/persistence";
import type { UserEmailChange } from "@mezan/api";
import { TenantResolveMode, type PlatformResolveDTO } from "@mezan/contracts";
import { followTenantOwnerEmail, recordSecurityEvent, tenantIsServed, TenantStatusCode } from "@mezan/domain";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { resolveTenantCode, TENANT_HEADER } from "./tenant-resolver.js";

export interface TenantRouterOptions {
  readonly platform: PlatformHandle;
  readonly dataDir: string;
  readonly tenantDomain?: string;
  readonly trustForwardedHost?: boolean;
  readonly allowTenantHeader?: boolean;
  readonly idleMs?: number;
  readonly ttlMs?: number;
  readonly sweepEveryMs?: number;
  readonly now?: () => Date;
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers, hooks: TenantBackendHooks) => Promise<BackendHandle>;
  /** Passed straight through to every tenant `createBackend` call (e.g. `{ exclusive: true }` on EFS). Ignored when `openBackend` is supplied. */
  readonly connection?: SqliteOpenOptions;
}

export interface TenantBackendHooks {
  readonly onUserEmailChanged: (change: UserEmailChange) => Promise<void>;
}

function safeEqual(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rejects every request under this middleware with 403 unless it carries
 * `x-mezan-origin: <secret>` — CloudFront adds this as a custom origin
 * header, so only traffic through the app's own edge (not a direct hit on
 * the origin) passes. A caller with no secret configured never applies this.
 */
export function requireOriginSecret(secret?: string): MiddlewareHandler {
  return async (c, next) => {
    if (!secret) return next();
    if (!safeEqual(c.req.header("x-mezan-origin") ?? "", secret)) {
      return c.json({ error: "ORIGIN_REQUIRED", message: "الوصول غير مسموح من هذا المصدر" }, 403);
    }
    return next();
  };
}

export interface TenantRouter {
  readonly app: Hono;
  backendFor(code: string): Promise<BackendHandle>;
  invalidate(code: string): void;
  sweep(): Promise<void>;
  close(): Promise<void>;
  /** Codes with a currently open (cached) tenant backend — an idle-evicted or never-opened tenant is absent. */
  openTenants(): string[];
}

export function tenantDbPath(dataDir: string, dbFile: string): string {
  return path.join(dataDir, dbFile);
}

/** Whether THIS request's host itself matched the tenant domain, vs. resolving via the header. */
function hostMatchesTenantDomain(request: Request, options: TenantResolverOptionsForMode): boolean {
  if (!options.tenantDomain) return false;
  const raw = (options.trustForwardedHost ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host");
  if (!raw) return false;
  const host = raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
  const domain = options.tenantDomain.toLowerCase();
  if (!host.endsWith(`.${domain}`)) return false;
  return !host.slice(0, -(domain.length + 1)).includes(".");
}

interface TenantResolverOptionsForMode {
  readonly tenantDomain?: string;
  readonly trustForwardedHost?: boolean;
}

/** This router's own catch-all pattern — kept as a constant so its length can be subtracted from `routePath`. */
const REST_PATTERN = "/:rest{.*}";

export function createTenantRouter(options: TenantRouterOptions): TenantRouter {
  const resolvers = new Map<string, TenantResolvers>();
  const resolversFor = (code: string) => {
    let r = resolvers.get(code);
    if (!r) {
      r = createTenantResolvers(options.platform, code, { now: options.now, ttlMs: options.ttlMs });
      resolvers.set(code, r);
    }
    return r;
  };
  const clock = options.now ?? (() => new Date());
  const hooksFor = (code: string): TenantBackendHooks => ({
    // Runs inside the tenant's own save: the audit row is part of the change, so its failure undoes both.
    onUserEmailChanged: async (change) => {
      const at = clock().toISOString();
      const before = await options.platform.stores.tenants.findByCode(code);
      const tenant = await followTenantOwnerEmail({ code, before: change.before, after: change.after, now: at }, options.platform.stores.tenants);
      if (!tenant || !before) return;
      try {
        await options.platform.stores.signupRequests.followOwnerEmail(code, before.ownerEmail, tenant.ownerEmail);
        await recordSecurityEvent(options.platform.audit, {
          module: "platform",
          entityType: "PLATFORM",
          entityId: tenant.id,
          action: "TENANT_OWNER_EMAIL_CHANGED",
          actor: `tenant:${code}:${change.actorId}`,
          severity: "CRITICAL",
          timestamp: at,
          details: { code, before: before.ownerEmail, after: tenant.ownerEmail, userId: change.userId },
        });
      } catch (err) {
        await options.platform.stores.tenants.save(before);
        await options.platform.stores.signupRequests.followOwnerEmail(code, tenant.ownerEmail, before.ownerEmail);
        throw err;
      }
    },
  });
  const openBackend = options.openBackend ?? (async (code, dbPath, r, hooks) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      connection: options.connection,
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
      onUserEmailChanged: hooks.onUserEmailChanged,
    });
  });
  const cache: BackendCache<BackendHandle> = createBackendCache({
    idleMs: options.idleMs,
    sweepEveryMs: options.sweepEveryMs,
    now: options.now ? () => options.now!().getTime() : undefined,
    onEvict: (code) => { resolvers.delete(code); },
    open: async (code) => {
      const tenant = await options.platform.stores.tenants.findByCode(code);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");
      return openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code), hooksFor(code));
    },
  });

  const app = new Hono();
  const resolverOptions = {
    tenantDomain: options.tenantDomain,
    trustForwardedHost: options.trustForwardedHost,
    allowTenantHeader: options.allowTenantHeader,
  };

  app.onError((err, c) => {
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    console.error(err);
    return c.json({ error: "INTERNAL", message: "حدث خطأ غير متوقع" }, 500);
  });

  /**
   * Answers ONLY whether a tenant is usable — never its name. This is an
   * unauthenticated lookup anyone who knows (or guesses) a code can call, so
   * it must not become a name-enumeration oracle (Slack/Zoho workspace
   * lookup never reveals the workspace name pre-auth either). The login
   * screen shows the resolved tenant's name only after sign-in; before that
   * it echoes back the code the person typed.
   */
  app.get("/platform/resolve", async (c) => {
    const mode = hostMatchesTenantDomain(c.req.raw, resolverOptions) ? TenantResolveMode.Subdomain : TenantResolveMode.Code;
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    const tenant = code ? await options.platform.stores.tenants.findByCode(code) : null;
    const body: PlatformResolveDTO = { mode, exists: tenantIsServed(tenant) };
    return c.json(body);
  });

  /** `c.req.path`/`routePath` stay undecoded, unlike `c.req.param`, so an encoded segment (e.g. `%2F`) survives the forward. */
  app.all(REST_PATTERN, async (c) => {
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    if (!code) return c.json({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" }, 400);
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || !tenantIsServed(tenant)) {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    const backend = await cache.get(code);
    const prefixLen = c.req.routePath.length - REST_PATTERN.length;
    const subPath = c.req.path.slice(prefixLen) || "/";
    const targetUrl = new URL(`${subPath}${new URL(c.req.raw.url).search}`, c.req.raw.url);
    return backend.app.fetch(new Request(targetUrl, c.req.raw));
  });

  return {
    app,
    async backendFor(code) {
      const tenant = await options.platform.stores.tenants.findByCode(code);
      if (!tenant || tenant.status === TenantStatusCode.Archived) throw new Error("TENANT_NOT_FOUND");
      return cache.get(code);
    },
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    sweep: () => cache.sweep(),
    close: () => cache.close(),
    openTenants: () => cache.openCodes(),
  };
}

export { TENANT_HEADER };
