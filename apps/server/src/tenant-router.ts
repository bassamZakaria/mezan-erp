import { Hono, type Context, type MiddlewareHandler } from "hono";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createSourceThrottle, delegatedGrantEnv, SmtpDestinationPolicy, throttleSource, tooManyAttempts, type SourceThrottle } from "@mezan/api";
import { createBackend, type BackendHandle, type CompanyAdminAccount, type IntegrationsGateway, type PlatformHandle, type SignedInUser } from "@mezan/backend";
import type { SessionGrant, SmtpConfig } from "@mezan/api";
import {
  clearTenantBinding,
  isBusySqliteError,
  isUnreadableSqliteError,
  SqliteFileBusyError,
  sqliteFileStamp,
  TenantBindingMismatchError,
  writeTenantBinding,
  type SqliteOpenOptions,
  type TenantBooksIdentity,
} from "@mezan/persistence";
import type { CompanyOwnerPort, UserEmailChange } from "@mezan/api";
import { REFUSED_TENANT_BOOKS, TenantBooksStanding, TenantResolveMode, type PlatformResolveDTO, type TenantBooksDTO } from "@mezan/contracts";
import { TenantBooksReview, tenantDbFile, tenantHandedTo, tenantIsServed, TenantStatusCode, tenantWithBooksReview, tenantWithOwnerRecordDue, type Tenant } from "@mezan/domain";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { callerSource, originEnv, requireCloudSource, SOCKET_ONLY, type ClientSourceOptions, type CloudSource, type SourceReporter } from "./client-source.js";
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
  classifyTenantBooks,
  readBooksFile,
  recordBooksReview,
  TenantBooksAudit,
  TenantBooksBoundError,
  TenantBooksChangedError,
  TenantBooksNotBoundError,
  type BooksFile,
  type BooksReviewRecord,
  type TenantBooksVerdict,
} from "./tenant-books.js";
import { answerTenantDbFileRefusal, settleTenantDbFile, TenantDbFileBusyError, TenantDbFileForeignError, TenantDbFileUnreadableError } from "./tenant-db-file.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { requestHost, resolveTenantCode, tenantSlugOfHost, TENANT_HEADER } from "./tenant-resolver.js";
import { readTenantBackupStatus } from "./tenant-backup-status.js";
import { LogEvent, annotateRequest, createLogger } from "@mezan/api";

const log = createLogger("cloud");

export interface TenantRouterOptions {
  readonly platform: PlatformHandle;
  readonly dataDir: string;
  readonly tenantDomain?: string;
  readonly unlockLinkFor?: (tenantCode: string) => ((token: string) => string) | undefined;
  readonly trustForwardedHost?: boolean;
  readonly clientSource?: ClientSourceOptions;
  readonly sourceReporter?: SourceReporter;
  readonly securityMail?: SmtpConfig;
  readonly allowTenantHeader?: boolean;
  readonly idleMs?: number;
  readonly ttlMs?: number;
  readonly sweepEveryMs?: number;
  readonly now?: () => Date;
  readonly dbFileWaitMs?: number;
  readonly openBackend?: (
    code: string,
    dbPath: string,
    resolvers: TenantResolvers,
    hooks: TenantBackendHooks,
    connection: SqliteOpenOptions,
    mail: TenantMail,
    books: TenantBooks,
  ) => Promise<BackendHandle>;
  readonly signInSources?: SourceThrottle;
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

export interface TenantBooks {
  readonly tenantId: string;
  readonly provisioning: boolean;
  // SECURITY: false for books written before databases were bound. They are
  // served as they are and an open writes no binding into them: only the
  // platform console's confirmation does.
  readonly bind: boolean;
}

export interface TenantBooksScan {
  readonly standings: ReadonlyMap<TenantBooksStanding, number>;
  readonly refused: readonly { readonly id: string; readonly code: string; readonly standing: TenantBooksStanding }[];
  readonly unread: readonly { readonly id: string; readonly code: string }[];
}

const BOOKS_SCRATCH_FOLDER = "scratch";

export function booksScratchDir(dataDir: string): string {
  return path.join(dataDir, BOOKS_SCRATCH_FOLDER);
}

export interface TenantMail {
  readonly unlockLink?: (token: string) => string;
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

const COUNTED_AS_FAILED: ReadonlySet<number> = new Set([401, 423]);
const CROSS_TENANT_FREE_ATTEMPTS = 90;

export interface TenantDoor {
  fetch(request: Request, source: CloudSource): Promise<Response>;
  findSession(token: string, source: CloudSource, deviceSecret: string | null): SessionGrant | null;
  readonly integrations: IntegrationsGateway | null;
  // SECURITY: answers `request` as `grant` without a session token. Only the `/api/v1` gateway
  // calls it, with a grant it resolved from a verified API key.
  fetchAs(request: Request, source: CloudSource, grant: SessionGrant): Promise<Response>;
}

function doorTo(backend: BackendHandle): TenantDoor {
  return {
    fetch: async (request, source) => backend.app.fetch(request, originEnv(source)),
    findSession: (token, source, deviceSecret) => backend.sessions.find(token, source, deviceSecret),
    integrations: backend.integrations ?? null,
    fetchAs: async (request, source, grant) => backend.app.fetch(request, delegatedGrantEnv(originEnv(source), grant)),
  };
}

export interface OpenTenant {
  readonly id: string;
  readonly code: string;
}

export interface TenantRouter {
  readonly app: Hono;
  // SECURITY: the backend as THIS PROCESS acts on it (provisioning, backups,
  // seeding) — an in-process call with no address reads as the host's own
  // console. A route answering a caller uses `callerDoor`, never this.
  backendFor(code: string): Promise<BackendHandle>;
  callerDoor(code: string): Promise<TenantDoor>;
  backendOf(tenantId: string): Promise<BackendHandle>;
  reconcileOwner(code: string): Promise<void>;
  reconcileOwnerOf(tenantId: string): Promise<void>;
  reconcileOpenOwners(): Promise<void>;
  ownerCandidates(tenantId: string): Promise<CompanyAdminAccount[]>;
  assignOwner(input: { readonly tenantId: string; readonly userId: string; readonly actor: string }): Promise<Tenant>;
  confirmPendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  declinePendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  resendPendingOwner(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  // CONTRACT: these four read a tenant's books where they lie. None opens a
  // database for use, writes to it or moves it. `lastBooksStandingOf` answers
  // what was last read and reads only books nothing was read of yet.
  scanBooks(): Promise<TenantBooksScan>;
  lastBooksStandingOf(tenant: Tenant): Promise<TenantBooksStanding | null>;
  booksStandingOf(tenant: Tenant): Promise<TenantBooksStanding | null>;
  booksOf(tenantId: string): Promise<TenantBooksDTO>;

  confirmBooks(input: { readonly tenantId: string; readonly userId: string; readonly companyName: string | null; readonly actor: string }): Promise<Tenant>;
  disownBooks(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  unbindBooks(input: { readonly tenantId: string; readonly actor: string }): Promise<Tenant>;
  // SECURITY: null for every link that confirms nothing, whatever the reason, so the caller answers them all alike.
  confirmPendingOwnerByToken(token: string): Promise<Tenant | null>;
  lockedAccountsOf(tenantId: string): Promise<readonly string[]>;
  unlockAccountOf(input: { readonly tenantId: string; readonly account: string; readonly actor: string }): Promise<boolean>;
  evict(tenantId: string): Promise<void>;
  invalidate(code: string): void;
  // REQUIRED ORDERING: called only for a tenant whose registration has just
  // been discarded. It closes the open backend BEFORE it removes the database
  // and every file written beside it, so nothing is left writing to a file
  // that is gone.
  discardDatabase(tenant: Pick<Tenant, "id" | "dbFile">): Promise<void>;
  sweep(): Promise<void>;
  close(): Promise<void>;
  openTenants(): OpenTenant[];
}

export function tenantDbPath(dataDir: string, dbFile: string): string {
  return path.join(dataDir, dbFile);
}

/** This router's own catch-all pattern — kept as a constant so its length can be subtracted from `routePath`. */
const REST_PATTERN = "/:rest{.*}";
const REVIEW_WRITE_ATTEMPTS = 2;

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
        await reconcileOwnerOf(tenantId).catch((err: unknown) => log.error({ err: err }, `owner contact of "${code}" could not be reconciled`));
        return ownerContact.effectiveOwnerUserId(tenantId, await opened(tenantId));
      },
      handOver: (input) => ownerContact.handOver(tenantId, input),
    },
    claimedElsewhere: async () => {
      const tenant = await options.platform.stores.tenants.findById(tenantId);
      return !tenant || tenant.ownerUserId !== null || tenant.status !== TenantStatusCode.Provisioning;
    },
  });
  const openBackend = options.openBackend ?? (async (code, dbPath, r, hooks, connection, mail, books) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      connection,
      tenantBinding: books.bind ? books.tenantId : undefined,
      seedWhenEmpty: books.provisioning,
      securityMail: options.securityMail,
      unlockLink: mail.unlockLink,
      platformOperatorUnlocks: true,
      sessionsInDatabase: true,
      tenantMailDestinations: SmtpDestinationPolicy.PublicOnly,
      backupStatus: async () => readTenantBackupStatus(options.dataDir, books.tenantId, dbPath, options.now),
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
      onUserEmailChanged: hooks.onUserEmailChanged,
      onUserSignedIn: hooks.onUserSignedIn,
      companyOwner: hooks.companyOwner,
      claimedElsewhere: hooks.claimedElsewhere,
      integrations: { tenantCode: code },
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
      // REQUIRED ORDERING: whose books these are is settled where the file
      // lies, and the connection that asked is closed, before the file is
      // moved under the tenant's id or opened for use. Refused books keep
      // their name and every byte.
      const verdict = await judged(stored, booksFileOf(stored), true);
      if (verdict.refusal) throw verdict.refusal;
      const tenant = await settleTenantDbFile(options.platform.stores.tenants, options.dataDir, stored, { waitMs: options.dbFileWaitMs, outsideTheTurn: options.platform.outsideTheTurn });
      const { code } = tenant;
      const provisioning = tenant.status === TenantStatusCode.Provisioning;
      const connection: SqliteOpenOptions = { ...options.connection, fileMustExist: !provisioning };
      const bind = verdict.standing !== TenantBooksStanding.Unbound;
      const mail: TenantMail = { unlockLink: options.unlockLinkFor?.(code) };
      const backend = await openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code), hooksFor(tenantId, code), connection, mail, { tenantId, provisioning, bind }).catch((err: unknown) => {
        if (isUnreadableSqliteError(err)) throw new TenantDbFileUnreadableError(tenantId, tenant.dbFile, err);
        if (err instanceof TenantBindingMismatchError) throw new TenantDbFileForeignError(tenantId, tenant.dbFile, err.boundTenantId);
        throw err;
      });
      if (bind) standings.set(tenantId, TenantBooksStanding.Bound);
      openCodes.set(tenantId, code);
      await ownerContact.reconcile(tenantId, backend).catch((err: unknown) => log.error({ err: err }, `owner contact of "${code}" could not be reconciled on open`));
      return backend;
    },
  });

  // REQUIRED: opening a tenant is file and tenant-database work. A console
  // route reaches it holding the platform connection's turn, and hands it back here.
  const opened = (tenantId: string): Promise<BackendHandle> => options.platform.outsideTheTurn(() => cache.get(tenantId));
  const outside = <T>(work: () => Promise<T>): Promise<T> => options.platform.outsideTheTurn(work);

  const scratchDir = booksScratchDir(options.dataDir);
  const booksConnection = options.connection ?? {};
  const standings = new Map<string, TenantBooksStanding>();
  const booksRead = new Map<string, { readonly file: string; readonly stamp: string; readonly read: BooksFile }>();
  const booksBeingRead = new Map<string, Promise<BooksFile>>();
  let closed = false;

  function refusedOnBooks(tenant: Tenant, err: unknown): never {
    if (isBusySqliteError(err) || err instanceof SqliteFileBusyError) throw new TenantDbFileBusyError(tenant.id, tenant.dbFile);
    if (err instanceof TenantBindingMismatchError) throw new TenantDbFileForeignError(tenant.id, tenant.dbFile, err.boundTenantId);
    throw err;
  }

  function onBooks<T>(tenant: Tenant, write: () => T): T {
    try {
      return write();
    } catch (err) {
      return refusedOnBooks(tenant, err);
    }
  }

  async function readAndRemember(tenantId: string, file: string): Promise<BooksFile> {
    const stamp = sqliteFileStamp(file);
    const read = await readBooksFile(file, scratchDir, booksConnection);
    if (sqliteFileStamp(file) === stamp) booksRead.set(tenantId, { file, stamp, read });
    else booksRead.delete(tenantId);
    return read;
  }

  function readOnceAmongAskers(tenantId: string, file: string): Promise<BooksFile> {
    const underWay = booksBeingRead.get(file);
    if (underWay) return underWay;
    const reading = readAndRemember(tenantId, file).finally(() => booksBeingRead.delete(file));
    booksBeingRead.set(file, reading);
    return reading;
  }

  // SECURITY: an open asks `fresh` and is answered from the file as it is at
  // that moment. The console and the scan are answered from the last read
  // while the database, its log and its journal are the files that were read.
  async function judged(tenant: Tenant, file: string, fresh = false): Promise<TenantBooksVerdict> {
    const known = booksRead.get(tenant.id);
    const unchanged = !fresh && known !== undefined && known.file === file && known.stamp === sqliteFileStamp(file);
    const read = unchanged && known ? known.read : await (fresh ? readAndRemember(tenant.id, file) : readOnceAmongAskers(tenant.id, file)).catch((err: unknown) => refusedOnBooks(tenant, err));
    const verdict = classifyTenantBooks(tenant, read);
    standings.set(tenant.id, verdict.standing);
    return verdict;
  }

  // CONTRACT: the books where they are. A database still under its tenant's
  // code is judged there, as the first open will find it.
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

  async function booksOnTheConsole(tenantId: string): Promise<{ readonly tenant: Tenant; readonly file: string; readonly verdict: TenantBooksVerdict }> {
    const tenant = await liveTenant(tenantId);
    const file = booksFileOf(tenant);
    return { tenant, file, verdict: await outside(() => judged(tenant, file)) };
  }

  const marked = (review: TenantBooksReview) => (before: Tenant, at: string): Tenant => tenantWithBooksReview(before, review, at);

  async function standingNow(tenant: Tenant): Promise<TenantBooksStanding | null> {
    try {
      return (await outside(() => judged(tenant, booksFileOf(tenant)))).standing;
    } catch (err) {
      log.error({ err: err }, `the books of "${tenant.code}" could not be read`);
      return standings.get(tenant.id) ?? null;
    }
  }

  async function reconcileOwnerOf(tenantId: string): Promise<void> {
    const tenant = await options.platform.stores.tenants.findById(tenantId);
    if (!tenant || tenant.status === TenantStatusCode.Archived) return;
    await ownerContact.reconcile(tenant.id, await opened(tenant.id));
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

  const signInSources =
    options.signInSources ?? createSourceThrottle(options.now ? () => options.now!().getTime() : undefined, CROSS_TENANT_FREE_ATTEMPTS);

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
    log.error({ event: LogEvent.UnhandledError, method: c.req.method, route: c.req.path, err }, "unhandled error");
    return answerTenantDbFileRefusal(c, err) ?? c.json({ error: "INTERNAL", message: "حدث خطأ غير متوقع" }, 500);
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
    annotateRequest({ tenantId: tenant.id });
    const door = doorTo(await opened(tenant.id));
    const prefixLen = c.req.routePath.length - REST_PATTERN.length;
    const subPath = c.req.path.slice(prefixLen) || "/";
    const targetUrl = new URL(`${subPath}${new URL(c.req.raw.url).search}`, c.req.raw.url);
    const forwarded = new Request(targetUrl, c.req.raw);
    const source = callerSource(c);
    if (c.req.method !== "POST" || subPath !== SIGN_IN) return door.fetch(forwarded, source);

    const counted = throttleSource(source) ?? source;
    const wait = signInSources.retryAfter(counted);
    if (wait > 0) {
      c.header("retry-after", String(wait));
      return c.json(tooManyAttempts(wait), 429);
    }
    const answer = await door.fetch(forwarded, source);
    if (COUNTED_AS_FAILED.has(answer.status)) signInSources.fail(counted);
    return answer;
  });

  async function openFor(code: string): Promise<BackendHandle> {
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === TenantStatusCode.Archived) throw new Error("TENANT_NOT_FOUND");
    return opened(tenant.id);
  }

  async function discardDatabase(tenant: Pick<Tenant, "id" | "dbFile">): Promise<void> {
    await cache.evict(tenant.id);
    const database = tenantDbPath(options.dataDir, tenant.dbFile);
    const directory = path.dirname(database);
    if (!existsSync(directory)) return;
    const ownFiles = readdirSync(directory).filter((name) => name === path.basename(database) || name.startsWith(`${path.basename(database)}-`) || name.startsWith(`${path.basename(database)}.`));
    for (const name of ownFiles) rmSync(path.join(directory, name), { force: true });
  }

  return {
    app,
    discardDatabase,
    backendFor: openFor,
    callerDoor: async (code) => doorTo(await openFor(code)),
    async backendOf(tenantId) {
      return opened((await liveTenant(tenantId)).id);
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
            .catch((err: unknown) => log.error({ err: err }, `owner contact of "${code}" could not be reconciled`));
        }),
      );
    },
    async ownerCandidates(tenantId) {
      return (await opened((await liveTenant(tenantId)).id)).companyAdmins();
    },
    async assignOwner({ tenantId, userId, actor }) {
      const tenant = await liveTenant(tenantId);
      return ownerContact.assign(tenant.id, userId, actor, await opened(tenant.id));
    },
    async confirmPendingOwner({ tenantId, actor }) {
      const tenant = await liveTenant(tenantId);
      return ownerContact.confirmPending(tenant.id, actor, OwnerConfirmation.PlatformConsole, await opened(tenant.id));
    },
    async confirmPendingOwnerByToken(token) {
      const tenant = await ownerContact.pendingByToken(token);
      if (!tenant || tenant.status === TenantStatusCode.Archived) return null;
      try {
        return await ownerContact.confirmPending(tenant.id, PREVIOUS_OWNER_ACTOR, OwnerConfirmation.PreviousOwnerLink, await opened(tenant.id), { tokenHash: hashHandOverToken(token) });
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
      const listed = (await options.platform.stores.tenants.list()).filter((tenant) => tenant.status !== TenantStatusCode.Archived);
      const counted = new Map<TenantBooksStanding, number>();
      const refused: { id: string; code: string; standing: TenantBooksStanding }[] = [];
      const unread: { id: string; code: string }[] = [];
      for (const { id, code } of listed) {
        if (closed) break;
        const tenant = await options.platform.stores.tenants.findById(id);
        if (!tenant || tenant.status === TenantStatusCode.Archived) continue;
        try {
          const { standing } = await judged(tenant, booksFileOf(tenant));
          counted.set(standing, (counted.get(standing) ?? 0) + 1);
          if (REFUSED_TENANT_BOOKS.includes(standing)) refused.push({ id, code, standing });
        } catch (err) {
          log.error({ err: err }, `the books of "${code}" could not be read`);
          unread.push({ id, code });
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return { standings: counted, refused, unread };
    },
    async lastBooksStandingOf(tenant) {
      if (tenant.status === TenantStatusCode.Archived) return null;
      return standings.get(tenant.id) ?? standingNow(tenant);
    },
    async booksStandingOf(tenant) {
      return tenant.status === TenantStatusCode.Archived ? null : standingNow(tenant);
    },
    async booksOf(tenantId) {
      const { verdict } = await booksOnTheConsole(tenantId);
      const { standing, identity } = verdict;
      return {
        standing,
        companyName: identity?.companyName ?? null,
        admins: identity ? activeCompanyAdminsIn(identity).map((admin) => ({ id: admin.id, nameAr: admin.nameAr, email: admin.email })) : [],
      };
    },
    // REQUIRED ORDERING: the served backend lets go of the file; the binding,
    // the cleared mark, the owner of a row that names none and the audit row
    // are one write; and a backend opened meanwhile is closed again, so the
    // next request is served from books that are bound.
    async confirmBooks({ tenantId, userId, companyName, actor }) {
      const { tenant, file, verdict } = await booksOnTheConsole(tenantId);
      if (verdict.refusal && verdict.standing !== TenantBooksStanding.Disowned) throw verdict.refusal;
      const admin = verdict.identity ? activeCompanyAdminsIn(verdict.identity).find((candidate) => candidate.id === userId) : undefined;
      if (!verdict.identity || !admin) throw new OwnerCandidateNotFoundError();
      // SECURITY: the books are bound only while they hold the company name
      // and the admin the operator was shown. They are read again inside the
      // write that binds them, on the connection that writes the binding.
      const asShown = (books: TenantBooksIdentity): void => {
        if (books.companyName !== companyName || !activeCompanyAdminsIn(books).some((candidate) => candidate.id === userId)) throw new TenantBooksChangedError();
      };
      asShown(verdict.identity);
      if (verdict.standing !== TenantBooksStanding.Bound) {
        const eventId = randomUUID();
        await outside(() => cache.evict(tenantId));
        await reviewed(
          tenantId,
          (before, at) => {
            const confirmed = tenantWithBooksReview(before, null, at);
            if (before.ownerUserId !== null || before.ownerRecordDue) return confirmed;
            return tenantWithOwnerRecordDue(tenantHandedTo(confirmed, admin, at), { eventId, userId: admin.id, previousUserId: null, actor, confirmedBy: OwnerConfirmation.PlatformConsole });
          },
          {
            action: TenantBooksAudit.Confirmed,
            actor,
            details: { adminUserId: admin.id, adminEmail: admin.email, companyName, eventId },
            inTheSameWrite: () => onBooks(tenant, () => writeTenantBinding(file, tenant.id, { ...booksConnection, now: options.now, accept: asShown })),
          },
        );
        await outside(() => cache.evict(tenantId));
      }
      await opened(tenantId);
      return liveTenant(tenantId);
    },
    // REQUIRED ORDERING: the mark is written before the served backend is closed.
    // A request arriving in between is answered by the backend that is about to
    // close; the one after it opens the books again and is refused.
    async disownBooks({ tenantId, actor }) {
      const { tenant, verdict } = await booksOnTheConsole(tenantId);
      if (verdict.standing === TenantBooksStanding.Disowned) return tenant;
      if (verdict.refusal) throw verdict.refusal;
      if (verdict.standing === TenantBooksStanding.Bound) throw new TenantBooksBoundError();
      const disowned = await reviewed(tenantId, marked(TenantBooksReview.Disowned), { action: TenantBooksAudit.Disowned, actor, details: { companyName: verdict.identity?.companyName ?? null } });
      await outside(() => cache.evict(tenantId));
      return disowned;
    },
    // REQUIRED ORDERING: the row is marked, with its audit row, then the served
    // backend is closed, and only then does the binding leave the file. Stopped
    // in between, the books are not served and asking again finishes the job;
    // in any other order the file would be served as unbound books until the
    // mark was written.
    async unbindBooks({ tenantId, actor }) {
      const { tenant, file, verdict } = await booksOnTheConsole(tenantId);
      if (verdict.identity?.boundTenantId !== tenant.id) {
        if (verdict.refusal && verdict.standing !== TenantBooksStanding.Disowned) throw verdict.refusal;
        throw new TenantBooksNotBoundError();
      }
      const disowned = await reviewed(tenantId, marked(TenantBooksReview.Disowned), { action: TenantBooksAudit.Unbound, actor, details: { companyName: verdict.identity.companyName } });
      await outside(() => cache.evict(tenantId));
      onBooks(tenant, () => clearTenantBinding(file, tenant.id, booksConnection));
      return disowned;
    },
    async lockedAccountsOf(tenantId) {
      return (await opened((await liveTenant(tenantId)).id)).lockedAccounts();
    },
    async unlockAccountOf({ tenantId, account, actor }) {
      const backend = await opened((await liveTenant(tenantId)).id);
      return options.platform.outsideTheTurn(() => backend.unlockAccount(account, actor));
    },
    evict: (tenantId) => cache.evict(tenantId),
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    sweep: () => cache.sweep(),
    close: () => {
      closed = true;
      return cache.close();
    },
    openTenants: () =>
      cache.openCodes().flatMap((id) => {
        const code = openCodes.get(id);
        return code === undefined ? [] : [{ id, code }];
      }),
  };
}

export { TENANT_HEADER };
