import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { bodyLimit } from "hono/body-limit";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  createPlatform,
  createPlatformAuth,
  createPlatformRoutes,
  PLATFORM_SESSION_LIMITS,
  type OwnerPasswordResetAccount,
  type PlatformEnvSettingsPort,
  type PlatformHandle,
  type RecordedActivation,
} from "@mezan/backend";
import { AuditBoundaryRefusal, BodyLimitRefusal, LogEvent, createJobRegistry, createLogger, createSessionRegistry, requestLogging, type JobRegistry } from "@mezan/api";
import { HealthLevel, SubscriptionStatusKind, TenantNotFoundError, TenantStatusCode, jobLevel, tenantSchema, type Tenant } from "@mezan/domain";
import { createAesGcmSecretBox, createSessionStore, CURRENT_SCHEMA_VERSION, DatabaseBusyError, NulCharacterError, emptyBooksScratch, type SqlDb } from "@mezan/persistence";
import { PLATFORM_SCHEMA, schemaKey, SchemaKeyPurpose, TenantDatabases } from "@mezan/persistence-postgres";
import { HealthLevelDTO, PUBLIC_API_BASE_PATH, type CreateTenantRequestDTO, type OwnerPasswordResetResultDTO, type PlatformOperationsDTO, type ProvisionResultDTO, type ProvisionRetryRequestDTO } from "@mezan/contracts";
import { booksScratchDir, createTenantRouter, requireOriginSecret, type TenantBooksScan, type TenantRouter } from "./tenant-router.js";
import { answerTenantDbFileRefusal } from "./tenant-db-file.js";
import { platformActor, provisionResultDTOOf, provisionTenant, PlanRequiredError } from "./provision-tenant.js";
import { resetTenantOwnerPassword } from "./owner-password-reset.js";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { callerSource, createSourceReporter, requireCloudSource } from "./client-source.js";
import { addressKey, createRequestLimiter, requestCap, SESSION_CAP_MAX_RECORDS, sessionKey } from "./rate-limit.js";
import { createSignupRoutes, SIGNUP_BASE_PATH } from "./signup-routes.js";
import { provisionDemoTenant } from "./demo-tenant.js";
import { provisionReviewTenant } from "./review-tenant.js";
import { createLegalRoutes, LEGAL_BASE_PATH } from "./legal-routes.js";
import { withCloudSiteHead, withDeploymentEnvironmentMeta } from "./site-head.js";
import { requestHost, tenantSlugOfHost } from "./tenant-resolver.js";
import { startDunningTimer } from "./dunning.js";
import { startOwnerDigestTimer } from "./owner-digest.js";
import { startCollectionsTimer } from "./collections-schedule.js";
import { createBackupScheduler } from "./backup-scheduler.js";
import { startAuditAnchorTimer } from "./audit-anchor-job.js";
import { tenantAuditAnchorPort } from "./audit-anchor-console.js";
import { createTenantPurge, startTenantPurgeTimer } from "./tenant-purge.js";
import { AnchorSinkKind, createAuditAnchorService } from "./audit-anchor-setup.js";
import { createTenantBackups } from "./tenant-backups.js";
import { createCardCheckoutService, type CardCheckoutService } from "./card-checkout.js";
import { startCardCheckoutSweepTimer } from "./card-checkout-sweep.js";
import { createPaymobProvider, createPaymobTestProvider, type PaymobTestProvider } from "./paymob-provider.js";
import {
  PAYMOB_WEBHOOK_PATH,
  createPaymobWebhookRoutes,
  createTenantBillingRoutes,
  createTestCheckoutRoutes,
  notificationUrl,
  trustedReturnOrigin,
} from "./billing-routes.js";
import { PaymobMode, type CloudEnv } from "./env.js";
import { MailOutcome, pendingHandOverEmail, smtpMailer, type PlatformMailer } from "./platform-mail.js";
import { PASSWORD_RESET_PATH, servedTenantLookup, tenantPasswordResetLink, tenantPublicOrigin, tenantUnlockLink, UNLOCK_PATH } from "./public-origin.js";
import { createCookieSessions } from "./cookie-session.js";
import { createPublicApiRoutes, refuseApiKeysOutsidePublicApi } from "./public-api-routes.js";
import { AlertKind, createAlerter, type Alerter } from "./alerter.js";
import { derivedKey, platformKey } from "./secrets-key.js";

const CSRF_KEY_USE = "mezan-cookie-csrf-v1";

const log = createLogger("cloud");

export enum PlatformJobKind {
  Dunning = "platform_dunning",
  OwnerDigest = "platform_owner_digest",
  CardCheckoutSweep = "platform_card_checkout_sweep",
  Backups = "platform_backups",
  AuditAnchor = "platform_audit_anchor",
  CollectionsDunning = "platform_collections_dunning",
  TenantPurge = "platform_tenant_purge",
}

export enum ReadinessCheck {
  PlatformDatabase = "platform_database",
  TenantRouter = "tenant_router",
}

export interface Readiness {
  readonly ready: boolean;
  readonly checks: Readonly<Record<ReadinessCheck, boolean>>;
}

const READINESS_WATCH_MS = 60_000;
const DUNNING_INTERVAL_MS = 24 * 60 * 60_000;
const OWNER_DIGEST_INTERVAL_MS = 30 * 60_000;
const COLLECTIONS_INTERVAL_MS = 60 * 60_000;
const CHECKOUT_SWEEP_INTERVAL_MS = 15 * 60_000;
const TENANT_PURGE_INTERVAL_MS = 24 * 60 * 60_000;
export const OWNER_PASSWORD_FILE = "platform-owner-password.txt";

const OPERATOR_SWEEP_BUDGET_MS = 20_000;

const PLATFORM_BODY_BYTES = 256 * 1024;

export interface CreateCloudAppOptions {
  readonly now?: () => Date;
  readonly authMiddleware?: MiddlewareHandler;
  readonly transformIndexHtml?: (html: string) => string;
  readonly backups?: { start(): () => void | Promise<void> };
  readonly mailer?: PlatformMailer;
  readonly alerter?: Alerter;
  readonly envSettings?: PlatformEnvSettingsPort;
  readonly seedDemo?: (deps: {
    readonly platform: PlatformHandle;
    readonly router: TenantRouter;
    readonly env: CloudEnv;
  }) => Promise<void>;
}

export interface CloudApp {
  readonly root: Hono;
  // CONTRACT: settles once the start-up read of every tenant's books is over. Serving does not wait for it.
  readonly booksScanned: Promise<void>;
  readonly jobs: JobRegistry;
  readonly alerter: Alerter;
  readiness(): Promise<Readiness>;
  // REQUIRED ORDERING: call before the HTTP server stops, so no job starts while requests drain; close() calls it too.
  stopJobs(): Promise<void>;
  close(): Promise<void>;
}

function generateOwnerPassword(): string {
  return randomBytes(10).toString("hex");
}

// SECURITY: the generated password never reaches a log line: logs are shipped, rotated and read
// by people who must not sign in as the owner. It is written once to a file only the server's
// user can read, and the log names the file.
function storeGeneratedOwnerPassword(platformDir: string, password: string): void {
  const file = path.join(platformDir, OWNER_PASSWORD_FILE);
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  log.warn(
    { event: LogEvent.OwnerPasswordGenerated, file },
    "the platform owner was seeded with a GENERATED password, written once to this file; sign in, change it, then delete the file",
  );
}

async function readIndexHtmlIfPresent(webDist: string): Promise<string | null> {
  try {
    return await readFile(path.join(webDist, "index.html"), "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function reportTenantBooks(scan: TenantBooksScan): void {
  const counts = [...scan.standings].map(([standing, count]) => `${standing} ${count}`).join(", ");
  const checked = [...scan.standings.values()].reduce((sum, count) => sum + count, 0);
  log.info({ checked }, `tenant books at start: ${checked} checked${counts === "" ? "" : `: ${counts}`}`);
  for (const tenant of scan.refused) log.warn({ tenantId: tenant.id }, `tenant books: "${tenant.code}" (${tenant.id}) is ${tenant.standing}`);
  for (const tenant of scan.unread) log.warn({ tenantId: tenant.id }, `tenant books: "${tenant.code}" (${tenant.id}) could not be read`);
}

const LEVEL_DTO: Readonly<Record<HealthLevel, HealthLevelDTO>> = {
  [HealthLevel.Ok]: HealthLevelDTO.Ok,
  [HealthLevel.Warn]: HealthLevelDTO.Warn,
  [HealthLevel.Critical]: HealthLevelDTO.Critical,
  [HealthLevel.Unknown]: HealthLevelDTO.Unknown,
};

function operationsOf(at: Date, verdict: Readiness, jobs: JobRegistry, alerter: Alerter): PlatformOperationsDTO {
  return {
    generatedAt: at.toISOString(),
    ready: verdict.ready,
    checks: verdict.checks,
    alertsConfigured: alerter.configured,
    jobs: jobs.status().map((job) => ({
      level: LEVEL_DTO[jobLevel({ lastError: job.lastError, lastRunAt: job.lastRunAt, lastOkAt: job.lastOkAt, intervalMs: job.intervalMs, now: at })],
      kind: job.kind,
      lastRunAt: job.lastRunAt,
      lastOkAt: job.lastOkAt,
      lastError: job.lastError,
      lastRecorded: job.lastRecorded,
      nextRunAt: job.nextRunAt,
    })),
    alerts: alerter.recent(),
  };
}

// Created here, not by the SQLite migrator: the first boot after the cutover stamps it.
async function stampSchemaVersion(db: SqlDb): Promise<void> {
  await db.applySchema("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  await db.run(
    "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [String(CURRENT_SCHEMA_VERSION)],
  );
}

export async function createCloudApp(env: CloudEnv, options: CreateCloudAppOptions = {}): Promise<CloudApp> {
  const now = options.now ?? (() => new Date());
  mkdirSync(env.platformDir, { recursive: true });
  emptyBooksScratch(booksScratchDir(env.platformDir));
  const masterKey = platformKey(env.secretsKey, env.platformDir);
  const secrets = createAesGcmSecretBox(masterKey);
  const csrfKey = derivedKey(masterKey, CSRF_KEY_USE);

  const ownerPassword = env.platformOwnerEmail ? (env.platformOwnerPassword ?? generateOwnerPassword()) : undefined;
  const owner = env.platformOwnerEmail && ownerPassword ? { email: env.platformOwnerEmail, password: ownerPassword } : undefined;
  const platformDbPath = path.join(env.platformDir, "platform.db");
  const tenantDatabases = env.postgres ? new TenantDatabases({ connectionString: env.postgres.url, secret: env.postgres.tenantDbSecret, onPoolError: (err, schema) => log.error({ err, schema }, `a Postgres connection for ${schema} failed while idle`) }) : null;
  let platform: PlatformHandle;
  if (env.postgres && tenantDatabases) {
    await tenantDatabases.assertCollation();
    await tenantDatabases.provision(PLATFORM_SCHEMA);
    platform = await createPlatform({
      db: tenantDatabases.get(PLATFORM_SCHEMA).db,
      auditChainKey: schemaKey(env.postgres.auditChainKey, SchemaKeyPurpose.Audit, PLATFORM_SCHEMA),
      fallbackBase: platformDbPath,
      now,
      owner,
    });
    const served = (await platform.stores.tenants.list()).filter((tenant) => tenant.status !== TenantStatusCode.Archived && tenant.status !== TenantStatusCode.Provisioning);
    const missing = await tenantDatabases.reprovisionExisting(served.map((tenant) => tenantSchema(tenant.id)));
    if (missing.length > 0) log.error({ event: LogEvent.ConfigurationWarning, missing }, `${missing.length} served companies have no Postgres schema; their books cannot open until it is restored`);
    log.warn(
      { event: LogEvent.ConfigurationWarning },
      "the books are on Postgres: the file backup scheduler and the audit-anchor job are off (deploy takes pg_dump; anchoring needs the SQLite audit turn)",
    );
  } else {
    platform = await createPlatform({ dbPath: platformDbPath, now, owner, connection: { exclusive: env.sqliteExclusive } });
  }

  if (platform.ownerSeeded && !env.platformOwnerPassword && ownerPassword) {
    storeGeneratedOwnerPassword(env.platformDir, ownerPassword);
  }

  const sessions = createSessionRegistry(Date.now, PLATFORM_SESSION_LIMITS, createSessionStore(platform.stores.db));
  const auth = createPlatformAuth({ platform, sessions, now, sourceOf: callerSource });
  const sourceReporter = createSourceReporter();
  const sourceGate = requireCloudSource(env.clientSource, sourceReporter);

  const mailer = env.platformSmtp ? (options.mailer ?? smtpMailer(env.platformSmtp)) : undefined;
  const alerter = options.alerter ?? createAlerter({ mailer, to: env.alertEmail, now });
  if (!alerter.configured) {
    log.warn({ event: LogEvent.ConfigurationWarning }, "operational alerts are not mailed: set MEZAN_ALERT_EMAIL and the platform SMTP variables");
  }
  if (env.publicLanding && !env.supportEmail && !env.supportPhone && !env.whatsappNumber) {
    log.warn({ event: LogEvent.ConfigurationWarning }, "the public landing page offers no way to reach you: set MEZAN_SUPPORT_EMAIL, MEZAN_SUPPORT_PHONE or MEZAN_WHATSAPP_NUMBER");
  }
  const jobs = createJobRegistry(now);
  jobs.onFailure((failure) =>
    alerter.raise({ kind: AlertKind.JobFailed, key: failure.kind, summary: `the ${failure.kind} job failed`, facts: { job: failure.kind, durationMs: failure.durationMs } }),
  );

  const router = createTenantRouter({
    platform,
    dataDir: env.platformDir,
    secrets,
    mailPendingHandOver: mailer
      ? async ({ tenant, to, successorEmail, token }) => {
          const origin = tenantPublicOrigin(env, tenant.code);
          if (origin === null) throw new Error("no public origin is configured (set MEZAN_PUBLIC_URL or MEZAN_TENANT_DOMAIN)");
          const link = `${origin}/signup/owner-handover?token=${encodeURIComponent(token)}`;
          const mail = pendingHandOverEmail({ link, companyName: tenant.nameAr, successorEmail });
          const sent = await platform.outsideTheTurn(() => mailer.send(to, mail));
          if (sent.outcome !== MailOutcome.Sent) throw new Error(`the hand-over mail was not delivered (${sent.outcome})`);
        }
      : undefined,
    tenantDomain: env.tenantDomain,
    unlockLinkFor: (tenantCode) => tenantUnlockLink(env, tenantCode),
    passwordResetLinkFor: (tenantCode) => tenantPasswordResetLink(env, tenantCode),
    signInLinkFor: (tenantCode) => tenantPublicOrigin(env, tenantCode) ?? undefined,
    trustForwardedHost: env.trustProxy,
    clientSource: env.clientSource,
    sourceReporter,
    securityMail: env.platformSmtp,
    allowTenantHeader: true,
    now,
    connection: { exclusive: env.sqliteExclusive },
    postgres: env.postgres && tenantDatabases ? { databases: tenantDatabases, auditChainKey: env.postgres.auditChainKey } : undefined,
  });

  if (env.seedDemo) {
    await (options.seedDemo ?? provisionDemoTenant)({ platform, router, env });
  }

  if (env.reviewTenant) {
    const created = await provisionReviewTenant({ platform, router, env, now }, env.reviewTenant);
    if (created) log.info(`reviewer tenant "${env.reviewTenant.code}" seeded; every login uses MEZAN_REVIEW_PASSWORD.`);
  }

  const provisionTenantForRoutes = async (
    cmd: CreateTenantRequestDTO & { actorId: string; intendedPlanId?: string | null },
    activation: RecordedActivation,
  ): Promise<ProvisionResultDTO> =>
    provisionResultDTOOf(await provisionTenant(cmd, { platform, router, now, activation }));

  const provisionRetryForRoutes = async (input: { tenantId: string; actorId: string } & ProvisionRetryRequestDTO, activation: RecordedActivation): Promise<ProvisionResultDTO> => {
    const tenant = await platform.stores.tenants.findById(input.tenantId);
    if (!tenant) throw new TenantNotFoundError(input.tenantId);
    const live = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    const planId = live?.planId ?? input.planId;
    const billingCycle = live?.billingCycle ?? input.billingCycle;
    if (!planId || !billingCycle) throw new PlanRequiredError();
    const provisioned = await provisionTenant(
      {
        code: tenant.code,
        nameAr: tenant.nameAr,
        nameEn: tenant.nameEn,
        ownerEmail: tenant.ownerEmail,
        ownerNameAr: input.ownerNameAr ?? tenant.nameAr,
        planId,
        billingCycle,
        trial: live ? live.status === SubscriptionStatusKind.Trialing : (input.trial ?? false),
        actorId: input.actorId,
      },
      { platform, router, now, activation },
    );
    return provisionResultDTOOf(provisioned);
  };

  const resetOwnerPasswordForRoutes = (input: { tenant: Tenant; actorId: string; recordIntent: (account: OwnerPasswordResetAccount) => Promise<void> }): Promise<OwnerPasswordResetResultDTO> =>
    resetTenantOwnerPassword({ platform, router, now }, input);

  const reconcileOwnerQuietly = (tenant: Tenant): Promise<void> =>
    router.reconcileOwnerOf(tenant.id).catch((err: unknown) => log.error({ tenantId: tenant.id, err }, `owner contact of "${tenant.code}" could not be reconciled`));

  let testProvider: PaymobTestProvider | null = null;
  let cardCheckout: CardCheckoutService | null = null;
  if (env.paymob.mode !== PaymobMode.Off) {
    const provider = env.paymob.mode === PaymobMode.Live ? createPaymobProvider(env.paymob) : (testProvider = createPaymobTestProvider());
    cardCheckout = createCardCheckoutService({ platform, provider, now, invalidateEntitlements: router.invalidate });
    if (testProvider) {
      log.warn({ event: LogEvent.ConfigurationWarning }, "card checkout runs in TEST MODE: no Paymob keys are set, checkouts go to a local fake page.");
    }
  }
  const checkoutService = cardCheckout;

  const tenantBackups = createTenantBackups({ dir: env.platformDir, router, now });
  const anchorService = tenantDatabases ? null : createAuditAnchorService(env.auditAnchor, env.platformDir);
  const tenantPurge = createTenantPurge({
    platform,
    router,
    dataDir: env.platformDir,
    retentionDays: env.tenantRetentionDays,
    localAnchorDir: anchorService ? anchorService.localDir : path.join(env.platformDir, "audit-anchors"),
    discardExports: (tenantId) => tenantBackups.discardExportsOf(tenantId),
    now,
    dropDatabase: tenantDatabases
      ? async (tenant) => {
          const schema = tenantSchema(tenant.id);
          await tenantDatabases.drop(schema);
          return `postgres schema ${schema}`;
        }
      : undefined,
  });

  const platformApp = createPlatformRoutes({
    envSettings: options.envSettings,
    platform,
    auth,
    now,
    provisionTenant: provisionTenantForRoutes,
    provisionRetry: provisionRetryForRoutes,
    resetOwnerPassword: resetOwnerPasswordForRoutes,
    releaseTenant: (input) => releaseProvisioningTenant({ platform, router, dataDir: env.platformDir, now }, input),
    lockedAccounts: (tenant) => router.lockedAccountsOf(tenant.id),
    unlockAccount: ({ tenant, account, actorId }) => router.unlockAccountOf({ tenantId: tenant.id, account, actor: platformActor(actorId) }),
    ownerCandidates: (tenant) => router.ownerCandidates(tenant.id),
    assignOwner: ({ tenant, userId, actorId }) => router.assignOwner({ tenantId: tenant.id, userId, actor: platformActor(actorId) }),
    confirmPendingOwner: ({ tenant, actorId }) => router.confirmPendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    declinePendingOwner: ({ tenant, actorId }) => router.declinePendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    resendPendingOwner: ({ tenant, actorId }) => router.resendPendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    tenantBackups,
    tenantBooks: {
      lastStandingOf: (tenant) => router.lastBooksStandingOf(tenant),
      standingOf: (tenant) => router.booksStandingOf(tenant),
      read: (tenant) => router.booksOf(tenant.id),
      confirm: ({ tenant, userId, companyName, actorId }) => router.confirmBooks({ tenantId: tenant.id, userId, companyName, actor: platformActor(actorId) }),
      disown: ({ tenant, actorId }) => router.disownBooks({ tenantId: tenant.id, actor: platformActor(actorId) }),
      unbind: ({ tenant, actorId }) => router.unbindBooks({ tenantId: tenant.id, actor: platformActor(actorId) }),
    },
    handOverMailConfigured: mailer !== undefined,
    reconcileOwner: reconcileOwnerQuietly,
    reconcileOpenOwners: () => router.reconcileOpenOwners(),
    operations: async () => operationsOf(now(), await readiness(), jobs, alerter),
    invalidateEntitlements: router.invalidate,
    auditAnchors: anchorService ? tenantAuditAnchorPort({ platform, router, anchors: anchorService, now }) : undefined,
    tenantRetention: tenantPurge,
    cardCheckout: checkoutService
      ? {
          testMode: checkoutService.provider.testMode,
          open: async ({ tenantId, actorId, request }) => {
            const origin = await trustedReturnOrigin(request, env, servedTenantLookup(platform));
            return checkoutService.open({
              tenantId,
              requestedBy: actorId,
              returnUrl: (id) => `${origin}/platform/tenants/${encodeURIComponent(tenantId)}?checkout=${encodeURIComponent(id)}`,
              notificationUrl: notificationUrl(request, env),
            });
          },
          list: (tenantId) => checkoutService.listByTenant(tenantId),
          sweep: async () =>
            checkoutService.sweepRunning() ? null : checkoutService.sweepPending({ budgetMs: OPERATOR_SWEEP_BUDGET_MS }),
          applyUnapplied: async (input) => (await checkoutService.applyUnapplied(input)).checkout,
          resolveFlagged: (input) => checkoutService.resolveFlagged(input),
        }
      : undefined,
  });

  const dunningTimer = startDunningTimer(platform, {
    now,
    intervalMs: DUNNING_INTERVAL_MS,
    job: jobs.track(PlatformJobKind.Dunning, DUNNING_INTERVAL_MS),
    onError: () => undefined,
  });

  const ownerDigestTimer = startOwnerDigestTimer({
    platform,
    router,
    now,
    intervalMs: OWNER_DIGEST_INTERVAL_MS,
    job: jobs.track(PlatformJobKind.OwnerDigest, OWNER_DIGEST_INTERVAL_MS),
    onError: (err) => log.error({ job: PlatformJobKind.OwnerDigest, err }, "owner digest sweep failed"),
  });

  const collectionsTimer = startCollectionsTimer({
    platform,
    router,
    now,
    intervalMs: COLLECTIONS_INTERVAL_MS,
    job: jobs.track(PlatformJobKind.CollectionsDunning, COLLECTIONS_INTERVAL_MS),
    onError: (err) => log.error({ job: PlatformJobKind.CollectionsDunning, err }, "collections dunning sweep failed"),
  });

  const checkoutSweepTimer = checkoutService
    ? startCardCheckoutSweepTimer(checkoutService, {
        intervalMs: CHECKOUT_SWEEP_INTERVAL_MS,
        job: jobs.track(PlatformJobKind.CardCheckoutSweep, CHECKOUT_SWEEP_INTERVAL_MS),
        onError: () => undefined,
      })
    : null;

  const backups = options.backups ?? createBackupScheduler({
    platform,
    router,
    dir: env.platformDir,
    intervalMs: env.backupIntervalMinutes * 60_000,
    now,
    job: env.backupIntervalMinutes > 0 ? jobs.track(PlatformJobKind.Backups, env.backupIntervalMinutes * 60_000) : undefined,
    onError: () => undefined,
  });
  let stopBackups: (() => void | Promise<void>) | undefined;
  if (env.backupIntervalMinutes > 0 && !tenantDatabases) {
    stopBackups = backups.start();
  }

  const anchorTimer = anchorService
    ? startAuditAnchorTimer({
        platform,
        router,
        signer: anchorService.signer,
        sink: anchorService.sink,
        intervalMs: anchorService.intervalMs,
        now,
        job: jobs.track(PlatformJobKind.AuditAnchor, anchorService.intervalMs),
      })
    : null;
  const tenantPurgeTimer = startTenantPurgeTimer(tenantPurge, { intervalMs: TENANT_PURGE_INTERVAL_MS, job: jobs.track(PlatformJobKind.TenantPurge, TENANT_PURGE_INTERVAL_MS) });
  const productionCloud = process.env["NODE_ENV"] === "production" && !env.seedDemo;
  if (!anchorService && !tenantDatabases) {
    const disabled = { event: "audit_anchor.disabled", reason: "MEZAN_AUDIT_ANCHOR_SIGNING_KEY is not set (or the interval is 0): the audit trail is not anchored outside the database" };
    if (productionCloud) {
      log.error(disabled, "audit anchoring is disabled on a production platform");
      alerter.raise({ kind: AlertKind.AuditAnchorDisabled, summary: "audit anchoring is disabled on a production platform: set MEZAN_AUDIT_ANCHOR_SIGNING_KEY and MEZAN_AUDIT_ANCHOR_S3_BUCKET" });
    } else {
      log.warn(disabled, "audit anchoring is disabled");
    }
  } else if (anchorService?.sinkKind === AnchorSinkKind.LocalFile) {
    log.warn(
      { event: "audit_anchor.local_sink", reason: "anchors go to a local file, which is not external to this host; set MEZAN_AUDIT_ANCHOR_S3_BUCKET" },
      "audit anchors go to a local file",
    );
  }

  let closed = false;
  const readiness = async (): Promise<Readiness> => {
    let platformDatabase = false;
    try {
      platformDatabase = (await platform.stores.db.get("SELECT 1 AS ok")) !== undefined;
    } catch {
      platformDatabase = false;
    }
    const checks = { [ReadinessCheck.PlatformDatabase]: platformDatabase, [ReadinessCheck.TenantRouter]: !closed };
    return { ready: platformDatabase && !closed, checks };
  };
  const readinessWatch = setInterval(async () => {
    const verdict = await readiness();
    if (verdict.ready || closed) return;
    log.error({ event: LogEvent.ReadinessFailed, checks: verdict.checks }, "the server is not ready to serve");
    alerter.raise({ kind: AlertKind.NotReady, summary: "the readiness check is failing", facts: Object.fromEntries(Object.entries(verdict.checks).map(([check, ok]) => [check, ok ? "ok" : "failing"])) });
  }, READINESS_WATCH_MS);
  readinessWatch.unref();

  const root = new Hono();
  root.use("*", requestLogging({ isQuiet: (requestPath) => !requestPath.startsWith("/api/") }));

  // A health check must never depend on the demo password: register them
  // before `authMiddleware`, or the uptime probe gets 401 the moment
  // MEZAN_DEMO_PASSWORD is set.
  root.get("/healthz", (c) => c.text("ok"));
  root.get("/readyz", async (c) => {
    const verdict = await readiness();
    return c.json({ status: verdict.ready ? "ready" : "not_ready", checks: verdict.checks }, verdict.ready ? 200 : 503);
  });

  root.use("/api/*", async (c, next) => {
    const url = new URL(c.req.url);
    if (!url.pathname.endsWith("/")) return next();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return root.fetch(new Request(url, c.req.raw), c.env);
  });

  // Also above the demo basic-auth and the origin-secret gate: Paymob sends
  // neither, and the HMAC verified inside is this route's only credential.
  if (checkoutService) {
    root.route(PAYMOB_WEBHOOK_PATH, createPaymobWebhookRoutes(checkoutService));
  }

  // Above the demo basic-auth: a store reviewer opens these signed out.
  // SECURITY / REQUIRED ORDERING: the pages are public, but the one POST is
  // throttled per caller address, and a forwarded hop is only the caller's
  // once the origin secret has proved the request crossed the edge. So the
  // POST passes the origin-secret gate BEFORE its address is read.
  root.on("POST", `${LEGAL_BASE_PATH}/*`, requireOriginSecret(env.originSecret));
  root.route(
    LEGAL_BASE_PATH,
    createLegalRoutes({ platform, supportEmail: env.supportEmail, platformSmtp: env.platformSmtp, clientSource: env.clientSource, sourceReporter, now }),
  );

  if (options.authMiddleware) {
    root.use("/*", options.authMiddleware);
  }

  root.use("/api/*", requireOriginSecret(env.originSecret));
  root.use("/api/*", sourceGate);

  // SECURITY / REQUIRED ORDERING (DEC-27): the integration API is mounted here, after the origin
  // secret and the source gate and BEFORE the cookie sessions, so a browser cookie never reaches
  // it and CSRF has nothing to guard: its only credential is `Authorization: Bearer mzn_…`, and
  // that credential is refused on every other `/api` path.
  root.use("/api/*", refuseApiKeysOutsidePublicApi());
  root.use(`${PUBLIC_API_BASE_PATH}/*`, bodyLimit({
    maxSize: PLATFORM_BODY_BYTES,
    onError: (c) =>
      c.json({ error: BodyLimitRefusal.PayloadTooLarge, message: "حجم البيانات المرسلة أكبر من المسموح به.", messageEn: "The request is larger than this route accepts." }, 413),
  }));
  root.route(PUBLIC_API_BASE_PATH, createPublicApiRoutes({ platform, router, publicUrl: null, now }));

  // After the public API, which has its own per-key limit; after the source gate, so the key is the
  // caller's resolved address and never a header it wrote.
  // shortcut: counts live in this process, so N instances grant N times the cap; move to platformRateLimiter when scaling out.
  root.use("/api/*", requestCap(createRequestLimiter(env.apiRequestsPerAddressPerMinute, 60_000), addressKey));

  // SECURITY: the cloud edition's browser sessions ride in HttpOnly cookies and
  // every state-changing request made with one must carry its CSRF token. The
  // backends behind this never see a cookie: the edge turns it back into the
  // bearer token every other client sends.
  const cookieSessions = createCookieSessions({
    trustProxy: env.trustProxy,
    tenantResolver: { tenantDomain: env.tenantDomain, trustForwardedHost: env.trustProxy, allowTenantHeader: true },
    platformMaxAgeMs: PLATFORM_SESSION_LIMITS.maxMs,
    audit: platform.audit,
    csrfKey,
  });
  root.use("/api/platform/*", cookieSessions.platform);
  root.use("/api/*", cookieSessions.tenant);
  // After the cookie sessions, which turn the browser's cookie into the bearer token keyed here.
  root.use("/api/*", requestCap(createRequestLimiter(env.apiRequestsPerSessionPerMinute, 60_000, Date.now, SESSION_CAP_MAX_RECORDS), sessionKey));

  // `/api/platform` before `/api`: the tenant router's own catch-all would
  // otherwise swallow the console's routes first.
  const platformBody = bodyLimit({
    maxSize: PLATFORM_BODY_BYTES,
    onError: (c) =>
      c.json({ error: BodyLimitRefusal.PayloadTooLarge, message: "حجم البيانات المرسلة أكبر من المسموح به.", messageEn: "The request is larger than this route accepts." }, 413),
  });
  for (const mount of ["/api/platform/*", "/api/billing/*", "/api/signup/*"]) root.use(mount, platformBody);
  root.route("/api/platform", platformApp);
  root.route("/api/billing", createTenantBillingRoutes({ platform, router, env, service: checkoutService, now, sourceReporter }));
  root.route(SIGNUP_BASE_PATH, createSignupRoutes({ platform, router, env, sourceReporter }));
  root.route("/api", router.app);

  if (checkoutService && testProvider) {
    root.route("/billing/test-checkout", createTestCheckoutRoutes({ platform, service: checkoutService, provider: testProvider }));
  }

  root.onError((err, c) => {
    log.error({ event: LogEvent.UnhandledError, method: c.req.method, route: c.req.path, err }, "unhandled error");
    if (err instanceof NulCharacterError) return c.json({ error: err.code, message: err.messageAr, messageEn: err.message }, 400);
    if (err instanceof DatabaseBusyError) {
      c.header("retry-after", "2");
      return c.json({ error: AuditBoundaryRefusal.ConnectionBusy, message: "قاعدة البيانات مشغولة الآن، فلم يُحفظ أي تغيير. حاول مرة أخرى بعد قليل.", messageEn: "The database is busy, so nothing was saved. Try again shortly." }, 503);
    }
    return answerTenantDbFileRefusal(c, err) ?? c.json({ error: "INTERNAL", message: "حدث خطأ غير متوقع" }, 500);
  });

  const builtIndexHtml = await readIndexHtmlIfPresent(env.webDist);
  if (builtIndexHtml !== null) {
    const rawIndexHtml = withDeploymentEnvironmentMeta(builtIndexHtml, env.deploymentEnvironment);
    const transform = (html: string) => (options.transformIndexHtml ? options.transformIndexHtml(html) : html);
    const appHtml = transform(rawIndexHtml);
    const siteHtml = env.publicLanding ? transform(withCloudSiteHead(rawIndexHtml)) : appHtml;
    // A tenant's own subdomain is that company's app, never the platform's marketing page.
    const indexHtmlFor = (request: Request) => (tenantSlugOfHost(requestHost(request, env.trustProxy), env.tenantDomain) === null ? siteHtml : appHtml);
    const shellPage = (c: Context) => {
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtmlFor(c.req.raw));
    };
    root.get("/", shellPage);
    root.get("/index.html", shellPage);
    // SECURITY: the page a mailed unlock link opens. The link's token is in the
    // fragment and never reaches here; these headers keep the page out of every
    // cache and stop the browser naming it to any site it goes on to. It is
    // served WITHOUT the index transform: that is where a deployment injects
    // its analytics beacon, and no third-party script may load on a page whose
    // address carries a credential.
    for (const credentialPage of [UNLOCK_PATH, PASSWORD_RESET_PATH]) {
      root.get(credentialPage, (c) => {
        c.header("Referrer-Policy", "no-referrer");
        c.header("Cache-Control", "no-store");
        return c.html(rawIndexHtml);
      });
    }
    root.use("/assets/*", async (c, next) => {
      await next();
      // Vite names every file under assets/ by its content hash, so a new build is a new URL.
      // SECURITY: behind the demo gate a shared cache must not hand the bundle to someone who never passed it.
      const audience = options.authMiddleware ? "private" : "public";
      if (c.res.status === 200) c.res.headers.set("Cache-Control", `${audience}, max-age=31536000, immutable`);
    });
    root.use("/*", serveStatic({ root: env.webDist }));
    root.get("/assets/*", (c) => c.text("Not found", 404));
    root.notFound(shellPage);
  } else {
    root.notFound((c) => c.json({ error: "NOT_FOUND", message: "لا توجد حزمة واجهة مبنية" }, 404));
  }

  if (tenantDatabases) await stampSchemaVersion(platform.stores.db);

  // REQUIRED ORDERING: started last and never awaited here. The server answers
  // its health check and its tenants while every company's books are read in
  // the background; a tenant asked for first is judged by its own open.
  const booksScanned = router
    .scanBooks()
    .then(reportTenantBooks)
    .catch((err: unknown) => log.error({ err }, "the start-up read of tenant books failed"));

  let jobsStopped: Promise<void> | null = null;
  const stopJobs = (): Promise<void> => {
    jobsStopped ??= Promise.all([
      stopBackups?.(),
      anchorTimer?.stop(),
      tenantPurgeTimer.stop(),
      dunningTimer.stop(),
      ownerDigestTimer.stop(),
      collectionsTimer.stop(),
      checkoutSweepTimer?.stop(),
    ]).then(() => undefined);
    return jobsStopped;
  };

  return {
    root,
    booksScanned,
    jobs,
    alerter,
    readiness,
    stopJobs,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(readinessWatch);
      alerter.close();
      await stopJobs();
      tenantBackups.close();
      await router.close();
      await booksScanned;
      platform.close();
      await tenantDatabases?.close();
    },
  };
}
