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
import {
  createOwnerContact,
  hashHandOverToken,
  NoPendingOwnerError,
  OwnerCandidateNotFoundError,
  OwnerConfirmation,
  PendingOwnerExpiredError,
  PREVIOUS_OWNER_ACTOR,
  type PendingHandOverMail,
} from "./owner-contact.js";
import { settleTenantDbFile, TenantDbFileError } from "./tenant-db-file.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { requestHost, resolveTenantCode, tenantSlugOfHost, TENANT_HEADER } from "./tenant-resolver.js";

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
  readonly dbFileWaitMs?: number;
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers, hooks: TenantBackendHooks, connection: SqliteOpenOptions) => Promise<BackendHandle>;
  /** Passed straight through to every tenant `createBackend` call (e.g. `{ exclusive: true }` on EFS). Ignored when `openBackend` is supplied. */
  readonly connection?: SqliteOpenOptions;
  readonly mailPendingHandOver?: (mail: PendingHandOverMail) => Promise<void>;
}

export interface TenantBackendHooks {
  readonly onUserEmailChanged: (change: UserEmailChange) => Promise<void>;
  readonly onUserSignedIn: (user: SignedInUser) => Promise<void>;
  readonly companyOwner: CompanyOwnerPort;
  readonly claimedElsewhere: () => Promise<boolean>;
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
  backendOf(tenantId: string): Promise<BackendHandle>;
  reconcileOwner(code: string): Promise<void>;
  reconcileOwnerOf(tenantId: string): Promise<void>;
  reconcileOpenOwners(): Promise<void>;
  ownerCandidates(tenantId: string): Promise<CompanyAdminAccount[]>;
  assignOwner(input: { readonly tenantId: string; readonly userId: string; readonly actor: string }): Promise<Tenant>;
  confirmPendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  declinePendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  resendPendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  // SECURITY: null for every link that confirms nothing, whatever the reason, so the caller answers them all alike.
  confirmPendingOwnerByToken(token: string): Promise<Tenant | null>;
  evict(tenantId: string): Promise<void>;
  invalidate(code: string): void;
  sweep(): Promise<void>;
  close(): Promise<void>;
  openTenants(): OpenTenant[];
}

export function tenantDbPath(dataDir: string, dbFile: string): string {
  return path.join(dataDir, dbFile);
}

/** This router's own catch-all pattern — kept as a constant so its length can be subtracted from `routePath`. */
const REST_PATTERN = "/:rest{.*}";
const DB_FILE_RETRY_AFTER_SECONDS = 5;

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
  const hooksFor = (tenantId: string, code: string): TenantBackendHooks => ({
    onUserEmailChanged: (change) => ownerContact.emailChanged(tenantId, change),
    onUserSignedIn: (user) => ownerContact.signedIn(tenantId, user),
    companyOwner: {
      currentOwnerUserId: async () => {
        await reconcileOwnerOf(tenantId).catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled`, err));
        return ownerContact.effectiveOwnerUserId(tenantId, await cache.get(tenantId));
      },
      handOver: (input) => ownerContact.handOver(tenantId, input),
    },
    claimedElsewhere: async () => {
      const tenant = await options.platform.stores.tenants.findById(tenantId);
      return !tenant || tenant.ownerUserId !== null || tenant.status !== TenantStatusCode.Provisioning;
    },
  });
  const openBackend = options.openBackend ?? (async (code, dbPath, r, hooks, connection) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      connection,
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
      onUserEmailChanged: hooks.onUserEmailChanged,
      onUserSignedIn: hooks.onUserSignedIn,
      companyOwner: hooks.companyOwner,
      claimedElsewhere: hooks.claimedElsewhere,
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
      const tenant = await settleTenantDbFile(options.platform.stores.tenants, options.dataDir, stored, { waitMs: options.dbFileWaitMs });
      const { code } = tenant;
      const connection: SqliteOpenOptions = { ...options.connection, fileMustExist: tenant.status !== TenantStatusCode.Provisioning };
      const backend = await openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code), hooksFor(tenantId, code), connection);
      openCodes.set(tenantId, code);
      await ownerContact.reconcile(tenantId, backend).catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled on open`, err));
      return backend;
    },
  });

  async function reconcileOwnerOf(tenantId: string): Promise<void> {
    const tenant = await options.platform.stores.tenants.findById(tenantId);
    if (!tenant || tenant.status === TenantStatusCode.Archived) return;
    await ownerContact.reconcile(tenant.id, await cache.get(tenant.id));
  }

  async function reconcileOwner(code: string): Promise<void> {
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (tenant) await reconcileOwnerOf(tenant.id);
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
    if (err instanceof TenantDbFileError) {
      if (!err.retryable) return c.json({ error: err.code, message: "ملف بيانات المنشأة ليس في مكانه المتوقع. تواصل مع الدعم." }, 503);
      c.header("Retry-After", String(DB_FILE_RETRY_AFTER_SECONDS));
      return c.json({ error: err.code, message: "بيانات المنشأة قيد النقل الآن. أعد المحاولة بعد لحظات." }, 503);
    }
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
    const mode = tenantSlugOfHost(requestHost(c.req.raw, options.trustForwardedHost ?? false), options.tenantDomain) !== null ? TenantResolveMode.Subdomain : TenantResolveMode.Code;
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
    async backendOf(tenantId) {
      return cache.get((await liveTenant(tenantId)).id);
    },
    reconcileOwner,
    reconcileOwnerOf,
    async reconcileOpenOwners() {
      await Promise.all(
        [...openCodes].map(async ([tenantId, code]) => {
          const open = cache.peek(tenantId);
          if (!open) return;
          await ownerContact
            .reconcile(tenantId, await open)
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
        return await ownerContact.confirmPending(tenant.id, PREVIOUS_OWNER_ACTOR, OwnerConfirmation.PreviousOwnerLink, await cache.get(tenant.id), { tokenHash: hashHandOverToken(token) });
      } catch (err) {
        if (err instanceof OwnerCandidateNotFoundError || err instanceof PendingOwnerExpiredError || err instanceof NoPendingOwnerError) return null;
        throw err;
      }
    },
    async declinePendingOwner({ tenantId, actor }) {
      return ownerContact.declinePending((await liveTenant(tenantId)).id, actor);
    },
    async resendPendingOwner({ tenantId, actor }) {
      return ownerContact.resendPending((await liveTenant(tenantId)).id, actor);
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
