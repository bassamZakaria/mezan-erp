import { Hono, type MiddlewareHandler } from "hono";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { createBackend, type BackendHandle, type CompanyAdminAccount, type PlatformHandle, type SignedInUser } from "@mezan/backend";
import type { SqliteOpenOptions } from "@mezan/persistence";
import type { CompanyOwnerPort, UserEmailChange } from "@mezan/api";
import { TenantResolveMode, type PlatformResolveDTO } from "@mezan/contracts";
import { tenantIsServed, TenantStatusCode, type Tenant } from "@mezan/domain";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { createOwnerContact, OwnerCandidateNotFoundError, OwnerConfirmation, PREVIOUS_OWNER_ACTOR, type PendingHandOverMail } from "./owner-contact.js";
import { settleTenantDbFile } from "./tenant-db-file.js";
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
  /** Mails the previously recorded owner address the link that confirms a pending hand-over. Without it a pending hand-over is confirmed from the console only. */
  readonly mailPendingHandOver?: (mail: PendingHandOverMail) => Promise<void>;
}

export interface TenantBackendHooks {
  readonly onUserEmailChanged: (change: UserEmailChange) => Promise<void>;
  readonly onUserSignedIn: (user: SignedInUser) => Promise<void>;
  readonly companyOwner: CompanyOwnerPort;
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

export interface OpenTenant {
  readonly id: string;
  readonly code: string;
}

export interface TenantRouter {
  readonly app: Hono;
  backendFor(code: string): Promise<BackendHandle>;
  reconcileOwner(code: string): Promise<void>;
  /** Reconciles every OPEN tenant without counting as use, so listing tenants never keeps an idle one open. */
  reconcileOpenOwners(): Promise<void>;
  ownerCandidates(tenantId: string): Promise<CompanyAdminAccount[]>;
  assignOwner(input: { readonly tenantId: string; readonly userId: string; readonly actor: string }): Promise<Tenant>;
  confirmPendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  /** Null when the token names no pending hand-over, or its successor can no longer administer the tenant. */
  confirmPendingOwnerByToken(token: string): Promise<Tenant | null>;
  evict(tenantId: string): Promise<void>;
  invalidate(code: string): void;
  sweep(): Promise<void>;
  close(): Promise<void>;
  /** Tenants with a currently open (cached) backend — an idle-evicted or never-opened tenant is absent. */
  openTenants(): OpenTenant[];
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
  const ownerContact = createOwnerContact({
    platform: options.platform,
    now: options.now ?? (() => new Date()),
    mailPendingHandOver: options.mailPendingHandOver,
  });
  const hooksFor = (code: string): TenantBackendHooks => ({
    onUserEmailChanged: (change) => ownerContact.emailChanged(code, change),
    onUserSignedIn: (user) => ownerContact.signedIn(code, user),
    companyOwner: {
      currentOwnerUserId: async () => {
        await reconcileOwner(code).catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled`, err));
        const tenant = await options.platform.stores.tenants.findByCode(code);
        return tenant ? ownerContact.effectiveOwnerUserId(code, await cache.get(tenant.id)) : null;
      },
      handOver: (input) => ownerContact.handOver(code, input),
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
      onUserSignedIn: hooks.onUserSignedIn,
      companyOwner: hooks.companyOwner,
    });
  });
  // SECURITY: open backends are keyed by tenant id, never by code. A code is
  // reused once its tenant is released; keyed by code, the next company under
  // that code could be handed the previous company's open database.
  const openCodes = new Map<string, string>();
  const cache: BackendCache<BackendHandle> = createBackendCache({
    idleMs: options.idleMs,
    sweepEveryMs: options.sweepEveryMs,
    now: options.now ? () => options.now!().getTime() : undefined,
    onEvict: (tenantId) => {
      const code = openCodes.get(tenantId);
      openCodes.delete(tenantId);
      if (code) resolvers.delete(code);
    },
    open: async (tenantId) => {
      const stored = await options.platform.stores.tenants.findById(tenantId);
      if (!stored) throw new Error("TENANT_NOT_FOUND");
      const tenant = await settleTenantDbFile(options.platform.stores.tenants, options.dataDir, stored);
      const { code } = tenant;
      const backend = await openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code), hooksFor(code));
      openCodes.set(tenantId, code);
      await ownerContact.reconcile(code, backend).catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled on open`, err));
      return backend;
    },
  });

  async function reconcileOwner(code: string): Promise<void> {
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === TenantStatusCode.Archived) return;
    await ownerContact.reconcile(code, await cache.get(tenant.id));
  }

  async function liveTenant(tenantId: string): Promise<Tenant> {
    const tenant = await options.platform.stores.tenants.findById(tenantId);
    if (!tenant || tenant.status === TenantStatusCode.Archived) throw new Error("TENANT_NOT_FOUND");
    return tenant;
  }

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
    const backend = await cache.get(tenant.id);
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
      return cache.get(tenant.id);
    },
    reconcileOwner,
    async reconcileOpenOwners() {
      await Promise.all(
        [...openCodes].map(async ([tenantId, code]) => {
          const open = cache.peek(tenantId);
          if (!open) return;
          await ownerContact
            .reconcile(code, await open)
            .catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled`, err));
        }),
      );
    },
    async ownerCandidates(tenantId) {
      return (await cache.get((await liveTenant(tenantId)).id)).companyAdmins();
    },
    async assignOwner({ tenantId, userId, actor }) {
      const tenant = await liveTenant(tenantId);
      return ownerContact.assign(tenant.id, userId, actor, await cache.get(tenant.id));
    },
    async confirmPendingOwner({ tenantId, actor }) {
      const tenant = await liveTenant(tenantId);
      return ownerContact.confirmPending(tenant.id, actor, OwnerConfirmation.PlatformConsole, await cache.get(tenant.id));
    },
    async confirmPendingOwnerByToken(token) {
      const tenant = await ownerContact.pendingByToken(token);
      if (!tenant || tenant.status === TenantStatusCode.Archived) return null;
      try {
        return await ownerContact.confirmPending(tenant.id, PREVIOUS_OWNER_ACTOR, OwnerConfirmation.PreviousOwnerLink, await cache.get(tenant.id));
      } catch (err) {
        if (err instanceof OwnerCandidateNotFoundError) return null;
        throw err;
      }
    },
    evict: (tenantId) => cache.evict(tenantId),
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    sweep: () => cache.sweep(),
    close: () => cache.close(),
    openTenants: () =>
      cache.openCodes().flatMap((id) => {
        const code = openCodes.get(id);
        return code === undefined ? [] : [{ id, code }];
      }),
  };
}

export { TENANT_HEADER };
