import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import {
  createPlatform,
  createPlatformAuth,
  createPlatformRoutes,
  type OwnerPinResetAccount,
  type PlatformHandle,
} from "@mezan/backend";
import { createSessionRegistry } from "@mezan/api";
import { SubscriptionStatusKind, TenantNotFoundError, type Tenant } from "@mezan/domain";
import type { CreateTenantRequestDTO, OwnerPinResetResultDTO, ProvisionResultDTO, ProvisionRetryRequestDTO } from "@mezan/contracts";
import { createTenantRouter, requireOriginSecret, type TenantBooksScan, type TenantRouter } from "./tenant-router.js";
import { platformActor, provisionResultDTOOf, provisionTenant, PlanRequiredError } from "./provision-tenant.js";
import { resetTenantOwnerPin } from "./owner-pin-reset.js";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { createSourceReporter } from "./client-source.js";
import { createSignupRoutes, SIGNUP_BASE_PATH } from "./signup-routes.js";
import { provisionDemoTenant } from "./demo-tenant.js";
import { provisionReviewTenant } from "./review-tenant.js";
import { createLegalRoutes, LEGAL_BASE_PATH } from "./legal-routes.js";
import { startDunningTimer } from "./dunning.js";
import { createBackupScheduler } from "./backup-scheduler.js";
import { createCardCheckoutService, type CardCheckoutService } from "./card-checkout.js";
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
import { servedTenantLookup, tenantPublicOrigin } from "./public-origin.js";

export interface CreateCloudAppOptions {
  readonly now?: () => Date;
  readonly authMiddleware?: MiddlewareHandler;
  readonly transformIndexHtml?: (html: string) => string;
  readonly backups?: { start(): () => void };
  readonly mailer?: PlatformMailer;
  readonly seedDemo?: (deps: {
    readonly platform: PlatformHandle;
    readonly router: TenantRouter;
    readonly env: CloudEnv;
  }) => Promise<void>;
}

export interface CloudApp {
  readonly root: Hono;
  close(): Promise<void>;
}

function generateOwnerPassword(): string {
  return randomBytes(10).toString("hex");
}

function printGeneratedOwnerPassword(password: string): void {
  console.log("[cloud] ------------------------------------------------------------");
  console.log("[cloud] The platform owner was seeded with a GENERATED PASSWORD. It is");
  console.log("[cloud] shown once, here, and is not recoverable from the database.");
  console.log(`[cloud]   owner password: ${password}`);
  console.log("[cloud] Sign in, then change it.");
  console.log("[cloud] ------------------------------------------------------------");
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
  console.log(`[cloud] tenant books at start: ${scan.checked} checked${counts === "" ? "" : `: ${counts}`}`);
  for (const tenant of scan.needingSomebody) console.warn(`[cloud] tenant books: "${tenant.code}" (${tenant.id}) is ${tenant.standing}`);
}

export async function createCloudApp(env: CloudEnv, options: CreateCloudAppOptions = {}): Promise<CloudApp> {
  const now = options.now ?? (() => new Date());
  mkdirSync(env.platformDir, { recursive: true });

  const ownerPassword = env.platformOwnerEmail ? (env.platformOwnerPassword ?? generateOwnerPassword()) : undefined;
  const platform = await createPlatform({
    dbPath: path.join(env.platformDir, "platform.db"),
    now,
    owner: env.platformOwnerEmail && ownerPassword ? { email: env.platformOwnerEmail, password: ownerPassword } : undefined,
    connection: { exclusive: env.sqliteExclusive },
  });

  if (platform.ownerSeeded && !env.platformOwnerPassword && ownerPassword) {
    printGeneratedOwnerPassword(ownerPassword);
  }

  const sessions = createSessionRegistry();
  const auth = createPlatformAuth({ platform, sessions, now });
  const sourceReporter = createSourceReporter();

  const mailer = env.platformSmtp ? (options.mailer ?? smtpMailer(env.platformSmtp)) : undefined;

  const router = createTenantRouter({
    platform,
    dataDir: env.platformDir,
    mailPendingHandOver: mailer
      ? async ({ tenant, to, successorEmail, token }) => {
          const origin = tenantPublicOrigin(env, tenant.code);
          if (origin === null) throw new Error("no public origin is configured (set MEZAN_PUBLIC_URL or MEZAN_TENANT_DOMAIN)");
          const link = `${origin}/signup/owner-handover?token=${encodeURIComponent(token)}`;
          const sent = await mailer.send(to, pendingHandOverEmail({ link, companyName: tenant.nameAr, successorEmail }));
          if (sent.outcome !== MailOutcome.Sent) throw new Error(`the hand-over mail was not delivered (${sent.outcome})`);
        }
      : undefined,
    tenantDomain: env.tenantDomain,
    trustForwardedHost: env.trustProxy,
    allowTenantHeader: true,
    now,
    connection: { exclusive: env.sqliteExclusive },
  });

  reportTenantBooks(await router.scanBooks());

  if (env.seedDemo) {
    await (options.seedDemo ?? provisionDemoTenant)({ platform, router, env });
  }

  if (env.reviewTenant) {
    const created = await provisionReviewTenant({ platform, router, env, now }, env.reviewTenant);
    if (created) console.log(`[cloud] reviewer tenant "${env.reviewTenant.code}" seeded; every login uses MEZAN_REVIEW_PIN.`);
  }

  const provisionTenantForRoutes = async (cmd: CreateTenantRequestDTO & { actorId: string }): Promise<ProvisionResultDTO> =>
    provisionResultDTOOf(await provisionTenant(cmd, { platform, router, now }));

  const provisionRetryForRoutes = async (input: { tenantId: string; actorId: string } & ProvisionRetryRequestDTO): Promise<ProvisionResultDTO> => {
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
      { platform, router, now },
    );
    return provisionResultDTOOf(provisioned);
  };

  const resetOwnerPinForRoutes = (input: { tenant: Tenant; actorId: string; recordIntent: (account: OwnerPinResetAccount) => Promise<void> }): Promise<OwnerPinResetResultDTO> =>
    resetTenantOwnerPin({ platform, router, now }, input);

  const reconcileOwnerQuietly = (tenant: Tenant): Promise<void> =>
    router.reconcileOwnerOf(tenant.id).catch((err: unknown) => console.error(`[cloud] owner contact of "${tenant.code}" could not be reconciled`, err));

  let testProvider: PaymobTestProvider | null = null;
  let cardCheckout: CardCheckoutService | null = null;
  if (env.paymob.mode !== PaymobMode.Off) {
    const provider = env.paymob.mode === PaymobMode.Live ? createPaymobProvider(env.paymob) : (testProvider = createPaymobTestProvider());
    cardCheckout = createCardCheckoutService({ platform, provider, now, invalidateEntitlements: router.invalidate });
    if (testProvider) {
      console.log("[cloud] card checkout runs in TEST MODE: no Paymob keys are set, checkouts go to a local fake page.");
    }
  }
  const checkoutService = cardCheckout;

  const platformApp = createPlatformRoutes({
    platform,
    auth,
    now,
    provisionTenant: provisionTenantForRoutes,
    provisionRetry: provisionRetryForRoutes,
    resetOwnerPin: resetOwnerPinForRoutes,
    releaseTenant: (input) => releaseProvisioningTenant({ platform, router, dataDir: env.platformDir, now }, input),
    ownerCandidates: (tenant) => router.ownerCandidates(tenant.id),
    assignOwner: ({ tenant, userId, actorId }) => router.assignOwner({ tenantId: tenant.id, userId, actor: platformActor(actorId) }),
    confirmPendingOwner: ({ tenant, actorId }) => router.confirmPendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    declinePendingOwner: ({ tenant, actorId }) => router.declinePendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    resendPendingOwner: ({ tenant, actorId }) => router.resendPendingOwner({ tenantId: tenant.id, actor: platformActor(actorId) }),
    tenantBooks: {
      standingOf: (tenant) => router.booksStandingOf(tenant),
      read: (tenant) => router.booksOf(tenant.id),
      confirm: ({ tenant, userId, actorId }) => router.confirmBooks({ tenantId: tenant.id, userId, actor: platformActor(actorId) }),
      disown: ({ tenant, actorId }) => router.disownBooks({ tenantId: tenant.id, actor: platformActor(actorId) }),
      unbind: ({ tenant, actorId }) => router.unbindBooks({ tenantId: tenant.id, actor: platformActor(actorId) }),
    },
    handOverMailConfigured: mailer !== undefined,
    reconcileOwner: reconcileOwnerQuietly,
    reconcileOpenOwners: () => router.reconcileOpenOwners(),
    invalidateEntitlements: router.invalidate,
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
        }
      : undefined,
  });

  const dunningTimer = startDunningTimer(platform, {
    now,
    onError: (err) => console.error("[cloud] dunning sweep failed", err),
  });

  const backups = options.backups ?? createBackupScheduler({
    platform,
    router,
    dir: env.platformDir,
    intervalMs: env.backupIntervalMinutes * 60_000,
    now,
    onError: (err) => console.error("[cloud] backup run failed", err),
  });
  let stopBackups: (() => void) | undefined;
  if (env.backupIntervalMinutes > 0) {
    stopBackups = backups.start();
  }

  const root = new Hono();

  // A health check must never depend on the demo password: register it
  // before `authMiddleware`, or Render's probe gets 401 the moment
  // MEZAN_DEMO_PASSWORD is set.
  root.get("/healthz", (c) => c.text("ok"));

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
  root.route(
    LEGAL_BASE_PATH,
    createLegalRoutes({ platform, supportEmail: env.supportEmail, platformSmtp: env.platformSmtp, clientSource: env.clientSource, sourceReporter, now }),
  );

  if (options.authMiddleware) {
    root.use("/*", options.authMiddleware);
  }

  root.use("/api/*", requireOriginSecret(env.originSecret));

  // `/api/platform` before `/api`: the tenant router's own catch-all would
  // otherwise swallow the console's routes first.
  root.route("/api/platform", platformApp);
  root.route("/api/billing", createTenantBillingRoutes({ platform, router, env, service: checkoutService, now }));
  root.route(SIGNUP_BASE_PATH, createSignupRoutes({ platform, router, env, now, sourceReporter, mailer }));
  root.route("/api", router.app);

  if (checkoutService && testProvider) {
    root.route("/billing/test-checkout", createTestCheckoutRoutes({ platform, service: checkoutService, provider: testProvider }));
  }

  root.onError((err, c) => {
    console.error(err);
    return c.json({ error: "INTERNAL", message: "حدث خطأ غير متوقع" }, 500);
  });

  const rawIndexHtml = await readIndexHtmlIfPresent(env.webDist);
  if (rawIndexHtml !== null) {
    const indexHtml = options.transformIndexHtml ? options.transformIndexHtml(rawIndexHtml) : rawIndexHtml;
    root.get("/", (c) => c.html(indexHtml));
    root.get("/index.html", (c) => c.html(indexHtml));
    root.use("/*", serveStatic({ root: env.webDist }));
    root.notFound((c) => c.html(indexHtml));
  } else {
    root.notFound((c) => c.json({ error: "NOT_FOUND", message: "لا توجد حزمة واجهة مبنية" }, 404));
  }

  let closed = false;
  return {
    root,
    async close() {
      if (closed) return;
      closed = true;
      stopBackups?.();
      dunningTimer.stop();
      await router.close();
      platform.close();
    },
  };
}
