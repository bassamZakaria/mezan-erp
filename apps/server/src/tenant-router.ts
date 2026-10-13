import { Hono, type MiddlewareHandler } from "hono";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createBackend, type BackendHandle, type CompanyAdminAccount, type PlatformHandle, type SignedInUser } from "@mezan/backend";
import { clearTenantBinding, isBusySqliteError, isUnreadableSqliteError, TenantBindingMismatchError, writeTenantBinding, type SqliteOpenOptions } from "@mezan/persistence";
import type { CompanyOwnerPort, UserEmailChange } from "@mezan/api";
import { TenantBooksStanding, TenantResolveMode, type PlatformResolveDTO, type TenantBooksDTO } from "@mezan/contracts";
import {
  AuditSeverityCode,
  TenantBooksReview,
  tenantDbFile,
  tenantDbFileRefusalOf,
  tenantHandedTo,
  tenantIsServed,
  TenantStatusCode,
  tenantWithBooksReview,
  tenantWithOwnerRecordDue,
  type Tenant,
} from "@mezan/domain";
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
import {
  activeCompanyAdminsIn,
  BOOKS_CHECK_ACTOR,
  judgeTenantBooks,
  recordBooksReview,
  TenantBooksAudit,
  TenantBooksBoundError,
  TenantBooksNotBoundError,
  TenantBooksUnconfirmedError,
  type BooksReviewRecord,
  type TenantBooksVerdict,
} from "./tenant-books.js";
import { settleTenantDbFile, TenantDbFileBusyError, TenantDbFileRefusal, TenantDbFileForeignError, TenantDbFileUnreadableError } from "./tenant-db-file.js";
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
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers, hooks: TenantBackendHooks, connection: SqliteOpenOptions, books: TenantBooks) => Promise<BackendHandle>;
  readonly connection?: SqliteOpenOptions;
  readonly mailPendingHandOver?: (mail: PendingHandOverMail) => Promise<void>;
}

export interface TenantBackendHooks {
  readonly onUserEmailChanged: (change: UserEmailChange) => Promise<void>;
  readonly onUserSignedIn: (user: SignedInUser) => Promise<void>;
  readonly companyOwner: CompanyOwnerPort;
  readonly claimedElsewhere: () => Promise<boolean>;
}

export interface TenantBooks {
  readonly tenantId: string;
  readonly provisioning: boolean;
  // SECURITY: false for books nobody has confirmed are this tenant's. They are
  // served as they are and no tenant binding is written into them.
  readonly bind: boolean;
}

export interface TenantBooksScan {
  readonly checked: number;
  readonly standings: ReadonlyMap<TenantBooksStanding, number>;
  readonly needingSomebody: readonly { readonly id: string; readonly code: string; readonly standing: TenantBooksStanding }[];
}

const BOOKS_NEEDING_NOBODY: readonly TenantBooksStanding[] = [TenantBooksStanding.Bound, TenantBooksStanding.WillBind, TenantBooksStanding.NotCreated];

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
  // CONTRACT: none of these opens a tenant's database for use.
  scanBooks(): Promise<TenantBooksScan>;
  booksStandingOf(tenant: Tenant): Promise<TenantBooksStanding | null>;
  booksOf(tenantId: string): Promise<TenantBooksDTO>;
  confirmBooks(input: { readonly tenantId: string; readonly userId: string; readonly actor: string }): Promise<Tenant>;
  disownBooks(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  unbindBooks(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
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
const REVIEW_WRITE_ATTEMPTS = 2;

const STANDING_OF_REFUSAL: ReadonlyMap<string, TenantBooksStanding> = new Map([[TenantDbFileRefusal.Missing, TenantBooksStanding.Missing]]);

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
  const openBackend = options.openBackend ?? (async (code, dbPath, r, hooks, connection, books) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      connection,
      tenantBinding: books.bind ? books.tenantId : undefined,
      seedWhenEmpty: books.provisioning,
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
      const tenant = await settled(stored);
      const { code } = tenant;
      const provisioning = tenant.status === TenantStatusCode.Provisioning;
      const dbPath = tenantDbPath(options.dataDir, tenant.dbFile);
      const connection: SqliteOpenOptions = { ...options.connection, fileMustExist: !provisioning };
      // REQUIRED ORDERING: whose books these are is settled, and the connection
      // that asked is closed, before the database is opened for use.
      const verdict = await judged(tenant, dbPath);
      if (verdict.refusal) throw verdict.refusal;
      const bind = verdict.standing !== TenantBooksStanding.Unconfirmed;
      if (!bind && tenant.booksReview !== TenantBooksReview.Unconfirmed) {
        await reviewed(tenantId, marked(TenantBooksReview.Unconfirmed), { action: TenantBooksAudit.Unconfirmed, severity: AuditSeverityCode.Warning, actor: BOOKS_CHECK_ACTOR }).catch((err: unknown) =>
          console.error(`[cloud] the books of "${code}" are served unconfirmed, and marking them for confirmation failed; it is tried again on the next open`, err),
        );
      }
      // A confirmation whose platform write was lost after the binding reached
      // the file leaves the mark behind; the binding is the fact, so the mark goes.
      if (verdict.standing === TenantBooksStanding.Bound && tenant.booksReview === TenantBooksReview.Unconfirmed) {
        await reviewed(tenantId, (before, at) => tenantWithBooksReview(before, null, at), {
          action: TenantBooksAudit.Confirmed,
          severity: AuditSeverityCode.Warning,
          actor: BOOKS_CHECK_ACTOR,
          details: { foundBound: true },
        }).catch((err: unknown) => console.error(`[cloud] the books of "${code}" are bound to it, and clearing their confirmation mark failed; it is tried again on the next open`, err));
      }
      const backend = await openBackend(code, dbPath, resolversFor(code), hooksFor(tenantId, code), connection, { tenantId, provisioning, bind }).catch((err: unknown) => {
        throw isUnreadableSqliteError(err) ? new TenantDbFileUnreadableError(tenantId, tenant.dbFile, err) : err;
      });
      if (bind) standings.set(tenantId, TenantBooksStanding.Bound);
      openCodes.set(tenantId, code);
      if (bind) await ownerContact.reconcile(tenantId, backend).catch((err: unknown) => console.error(`[cloud] owner contact of "${code}" could not be reconciled on open`, err));
      return backend;
    },
  });

  const standings = new Map<string, TenantBooksStanding>();
  const booksConnection = options.connection ?? {};

  // SECURITY: an owner e-mail on more than one tenant row proves nothing about
  // which of their databases is which.
  async function sharedOwnerEmails(): Promise<ReadonlySet<string>> {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const { ownerEmail } of await options.platform.stores.tenants.list()) (seen.has(ownerEmail) ? shared : seen).add(ownerEmail);
    return shared;
  }

  async function judged(tenant: Tenant, file: string, shared?: ReadonlySet<string>): Promise<TenantBooksVerdict> {
    const ownerEmailShared = (shared ?? (await sharedOwnerEmails())).has(tenant.ownerEmail);
    const verdict = onBooks(tenant, () => judgeTenantBooks(tenant, file, booksConnection, ownerEmailShared));
    standings.set(tenant.id, verdict.standing);
    return verdict;
  }

  async function settled(stored: Tenant): Promise<Tenant> {
    try {
      return await settleTenantDbFile(options.platform.stores.tenants, options.dataDir, stored, { waitMs: options.dbFileWaitMs });
    } catch (err) {
      const standing = STANDING_OF_REFUSAL.get(tenantDbFileRefusalOf(err)?.error ?? "");
      if (standing) standings.set(stored.id, standing);
      throw err;
    }
  }

  // CONTRACT: reads the books where they are, moving nothing. A database still
  // under its tenant's code is judged there, as the first open will find it.
  function booksFileOf(tenant: Tenant): string {
    const named = tenantDbPath(options.dataDir, tenant.dbFile);
    const wanted = tenantDbPath(options.dataDir, tenantDbFile(tenant.id));
    return existsSync(named) || !existsSync(wanted) ? named : wanted;
  }

  async function reviewed(tenantId: string, change: (before: Tenant, at: string) => Tenant, record: BooksReviewRecord): Promise<Tenant> {
    for (let attempt = 0; attempt < REVIEW_WRITE_ATTEMPTS; attempt += 1) {
      const before = await liveTenant(tenantId);
      const after = change(before, (options.now ?? (() => new Date()))().toISOString());
      if (await recordBooksReview(options.platform, before, after, record)) return after;
    }
    throw new Error("the tenant's owner changed while its books were being reviewed");
  }

  const marked = (review: TenantBooksReview) => (before: Tenant, at: string): Tenant => tenantWithBooksReview(before, review, at);

  function onBooks<T>(tenant: Tenant, write: () => T): T {
    try {
      return write();
    } catch (err) {
      if (isBusySqliteError(err)) throw new TenantDbFileBusyError(tenant.id, tenant.dbFile);
      if (err instanceof TenantBindingMismatchError) throw new TenantDbFileForeignError(tenant.id, tenant.dbFile, err.boundTenantId);
      throw err;
    }
  }

  async function booksForTheConsole(tenantId: string): Promise<{ readonly tenant: Tenant; readonly file: string; readonly verdict: TenantBooksVerdict }> {
    const tenant = await settled(await liveTenant(tenantId));
    const file = tenantDbPath(options.dataDir, tenant.dbFile);
    return { tenant, file, verdict: await judged(tenant, file) };
  }

  async function reconcileOwnerOf(tenantId: string): Promise<void> {
    const tenant = await options.platform.stores.tenants.findById(tenantId);
    if (!tenant || tenant.status === TenantStatusCode.Archived || tenant.booksReview) return;
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
    const refusal = tenantDbFileRefusalOf(err);
    if (refusal) {
      if (refusal.retryable) c.header("Retry-After", String(DB_FILE_RETRY_AFTER_SECONDS));
      return c.json({ error: refusal.error, message: refusal.message, messageEn: refusal.messageEn }, 503);
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
      if (tenant.booksReview === TenantBooksReview.Unconfirmed) throw new TenantBooksUnconfirmedError();
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
    async scanBooks() {
      const tenants = (await options.platform.stores.tenants.list()).filter((tenant) => tenant.status !== TenantStatusCode.Archived);
      const counted = new Map<TenantBooksStanding, number>();
      const needingSomebody: { id: string; code: string; standing: TenantBooksStanding }[] = [];
      const shared = await sharedOwnerEmails();
      for (const tenant of tenants) {
        const { standing } = await judged(tenant, booksFileOf(tenant), shared);
        counted.set(standing, (counted.get(standing) ?? 0) + 1);
        if (!BOOKS_NEEDING_NOBODY.includes(standing)) needingSomebody.push({ id: tenant.id, code: tenant.code, standing });
      }
      return { checked: tenants.length, standings: counted, needingSomebody };
    },
    async booksStandingOf(tenant) {
      if (tenant.status === TenantStatusCode.Archived) return null;
      return standings.get(tenant.id) ?? (await judged(tenant, booksFileOf(tenant))).standing;
    },
    async booksOf(tenantId) {
      const tenant = await liveTenant(tenantId);
      const { standing, identity } = await judged(tenant, booksFileOf(tenant));
      return {
        standing,
        companyName: identity?.companyName ?? null,
        admins: identity ? activeCompanyAdminsIn(identity).map((admin) => ({ id: admin.id, nameAr: admin.nameAr, email: admin.email })) : [],
      };
    },
    // REQUIRED ORDERING: the served backend lets go of the file, the binding, the
    // mark, the owner and the audit row are one write, and the backend opened
    // meanwhile is closed again, so the next request is served from books that
    // are bound. An owner the platform still owes the tenant a record for is
    // assigned afterwards, once the bound books have taken that record.
    async confirmBooks({ tenantId, userId, actor }) {
      const { tenant, file, verdict } = await booksForTheConsole(tenantId);
      if (verdict.refusal && verdict.standing !== TenantBooksStanding.Disowned) throw verdict.refusal;
      const admin = verdict.identity ? activeCompanyAdminsIn(verdict.identity).find((candidate) => candidate.id === userId) : undefined;
      if (!admin) throw new OwnerCandidateNotFoundError();
      if (verdict.identity?.boundTenantId !== tenant.id || tenant.booksReview) {
        const eventId = randomUUID();
        await cache.evict(tenantId);
        await reviewed(
          tenantId,
          (before, at) => {
            const confirmed = tenantWithBooksReview(before, null, at);
            if (before.ownerUserId === admin.id || before.ownerRecordDue) return confirmed;
            return tenantWithOwnerRecordDue(tenantHandedTo(confirmed, admin, at), { eventId, userId: admin.id, previousUserId: before.ownerUserId, actor, confirmedBy: OwnerConfirmation.PlatformConsole });
          },
          {
            action: TenantBooksAudit.Confirmed,
            severity: AuditSeverityCode.Critical,
            actor,
            details: { fromUserId: tenant.ownerUserId, toUserId: admin.id, toEmail: admin.email, companyName: verdict.identity?.companyName ?? null, eventId },
            inTheSameWrite: () => onBooks(tenant, () => writeTenantBinding(file, tenant.id, booksConnection, options.now)),
          },
        );
        await cache.evict(tenantId);
      }
      standings.set(tenantId, TenantBooksStanding.Bound);
      const backend = await cache.get(tenantId);
      const confirmed = await liveTenant(tenantId);
      return confirmed.ownerUserId === admin.id ? confirmed : ownerContact.assign(tenantId, admin.id, actor, backend);
    },
    // REQUIRED ORDERING: the mark is written before the served backend is closed.
    // A request arriving in between is answered by the backend that is about to
    // close; the one after it opens the books again and is refused.
    async disownBooks({ tenantId, actor }) {
      const { tenant, verdict } = await booksForTheConsole(tenantId);
      if (verdict.standing === TenantBooksStanding.Disowned) return tenant;
      if (verdict.refusal) throw verdict.refusal;
      if (verdict.standing === TenantBooksStanding.Bound) throw new TenantBooksBoundError();
      const disowned = await reviewed(tenantId, marked(TenantBooksReview.Disowned), {
        action: TenantBooksAudit.Disowned,
        severity: AuditSeverityCode.Critical,
        actor,
        details: { companyName: verdict.identity?.companyName ?? null },
      });
      standings.set(tenantId, TenantBooksStanding.Disowned);
      await cache.evict(tenantId);
      return disowned;
    },
    // REQUIRED ORDERING: the row is marked, with its audit row, then the served
    // backend is closed, and only then does the binding leave the file. Stopped
    // in between, the books are not served and asking again finishes the job;
    // any other order leaves an unbound file for the next open to bind again on
    // the proof that was wrong.
    async unbindBooks({ tenantId, actor }) {
      const { tenant, file, verdict } = await booksForTheConsole(tenantId);
      if (verdict.identity?.boundTenantId !== tenant.id) {
        if (verdict.refusal && verdict.standing !== TenantBooksStanding.Disowned) throw verdict.refusal;
        throw new TenantBooksNotBoundError();
      }
      const disowned =
        tenant.booksReview === TenantBooksReview.Disowned
          ? tenant
          : await reviewed(tenantId, marked(TenantBooksReview.Disowned), {
              action: TenantBooksAudit.Unbound,
              severity: AuditSeverityCode.Critical,
              actor,
              details: { companyName: verdict.identity.companyName },
            });
      standings.set(tenantId, TenantBooksStanding.Disowned);
      await cache.evict(tenantId);
      onBooks(tenant, () => clearTenantBinding(file, tenant.id, booksConnection));
      return disowned;
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
