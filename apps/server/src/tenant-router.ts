import { Hono, type Context, type MiddlewareHandler } from "hono";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { createSourceThrottle, tooManyAttempts, type SourceThrottle } from "@mezan/api";
import { createBackend, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import type { SessionGrant, SmtpConfig } from "@mezan/api";
import type { SqliteOpenOptions } from "@mezan/persistence";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { callerSource, originEnv, requireCloudSource, SOCKET_ONLY, type ClientSourceOptions, type CloudSource, type SourceReporter } from "./client-source.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { resolveTenantCode, TENANT_HEADER } from "./tenant-resolver.js";

export interface TenantRouterOptions {
  readonly platform: PlatformHandle;
  readonly dataDir: string;
  readonly tenantDomain?: string;
  readonly trustForwardedHost?: boolean;
  /** How the caller's address is read. Defaults to the socket's peer with no proxy trusted. */
  readonly clientSource?: ClientSourceOptions;
  readonly sourceReporter?: SourceReporter;
  /** The platform's mail server, for a tenant that has configured none: an account-lock notice still reaches its administrators. */
  readonly securityMail?: SmtpConfig;
  readonly allowTenantHeader?: boolean;
  readonly idleMs?: number;
  readonly ttlMs?: number;
  readonly sweepEveryMs?: number;
  readonly now?: () => Date;
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers) => Promise<BackendHandle>;
  /** Failed tenant sign-ins per tenant and client address. Defaults to a fresh one. */
  readonly signInSources?: SourceThrottle;
  /** Passed straight through to every tenant `createBackend` call (e.g. `{ exclusive: true }` on EFS). Ignored when `openBackend` is supplied. */
  readonly connection?: SqliteOpenOptions;
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

const SIGN_IN = "/auth/login";
const INVALID_CREDENTIALS = 401;

const SOURCE_KEY_SEPARATOR = "\u0000";

/** A tenant backend as a cloud CALLER reaches it: every read names the address the caller is counted and bound against. */
export interface TenantDoor {
  fetch(request: Request, source: CloudSource): Promise<Response>;
  findSession(token: string, source: CloudSource): SessionGrant | null;
}

function doorTo(backend: BackendHandle): TenantDoor {
  return {
    fetch: async (request, source) => backend.app.fetch(request, originEnv(source)),
    findSession: (token, source) => backend.sessions.find(token, source),
  };
}

export interface TenantRouter {
  readonly app: Hono;
  // SECURITY: the backend as THIS PROCESS acts on it (provisioning, backups,
  // seeding) — an in-process call with no address reads as the host's own
  // console. A route answering a caller uses `callerDoor`, never this.
  backendFor(code: string): Promise<BackendHandle>;
  callerDoor(code: string): Promise<TenantDoor>;
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
  const openBackend = options.openBackend ?? (async (_code, dbPath, r) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      connection: options.connection,
      securityMail: options.securityMail,
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
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
      return openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code));
    },
  });

  const signInSources = options.signInSources ?? createSourceThrottle(options.now ? () => options.now!().getTime() : undefined);

  const app = new Hono();
  app.use("*", requireCloudSource(options.clientSource ?? SOCKET_ONLY, options.sourceReporter));
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
    const mode = hostMatchesTenantDomain(c.req.raw, resolverOptions) ? "subdomain" : "code";
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    const tenant = code ? await options.platform.stores.tenants.findByCode(code) : null;
    const exists = Boolean(tenant && (tenant.status === "active" || tenant.status === "suspended"));
    return c.json({ mode, exists });
  });

  /** `c.req.path`/`routePath` stay undecoded, unlike `c.req.param`, so an encoded segment (e.g. `%2F`) survives the forward. */
  app.all(REST_PATTERN, async (c) => {
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    if (!code) return c.json({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" }, 400);
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === "archived" || tenant.status === "provisioning") {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    const door = doorTo(await cache.get(code));
    const prefixLen = c.req.routePath.length - REST_PATTERN.length;
    const subPath = c.req.path.slice(prefixLen) || "/";
    const targetUrl = new URL(`${subPath}${new URL(c.req.raw.url).search}`, c.req.raw.url);
    const forwarded = new Request(targetUrl, c.req.raw);
    const source = callerSource(c);
    if (c.req.method !== "POST" || subPath !== SIGN_IN) return door.fetch(forwarded, source);

    const held = `${code}${SOURCE_KEY_SEPARATOR}${source}`;
    const wait = signInSources.retryAfter(held);
    if (wait > 0) {
      c.header("retry-after", String(wait));
      return c.json(tooManyAttempts(wait), 429);
    }
    const answer = await door.fetch(forwarded, source);
    if (answer.status === INVALID_CREDENTIALS) signInSources.fail(held);
    return answer;
  });

  async function openFor(code: string): Promise<BackendHandle> {
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === "archived") throw new Error("TENANT_NOT_FOUND");
    return cache.get(code);
  }

  return {
    app,
    backendFor: openFor,
    callerDoor: async (code) => doorTo(await openFor(code)),
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    sweep: () => cache.sweep(),
    close: () => cache.close(),
    openTenants: () => cache.openCodes(),
  };
}

export { TENANT_HEADER };
