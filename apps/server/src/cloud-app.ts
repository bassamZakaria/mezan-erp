import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { bodyLimit } from "hono/body-limit";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { createPlatform, createPlatformAuth, createPlatformRoutes, type PlatformHandle } from "@mezan/backend";
import { createSessionRegistry } from "@mezan/api";
import { TenantNotFoundError } from "@mezan/domain";
import type { CreateTenantRequestDTO, ProvisionResultDTO, ProvisionRetryRequestDTO } from "@mezan/contracts";
import { createTenantRouter, requireOriginSecret, type TenantRouter } from "./tenant-router.js";
import { provisionTenant, PlanRequiredError } from "./provision-tenant.js";
import { createSignupRoutes } from "./signup-routes.js";
import { provisionDemoTenant } from "./demo-tenant.js";
import { provisionReviewTenant } from "./review-tenant.js";
import { createLegalRoutes, LEGAL_BASE_PATH } from "./legal-routes.js";
import { startDunningTimer } from "./dunning.js";
import { createBackupScheduler } from "./backup-scheduler.js";
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
import type { CloudEnv } from "./env.js";

// An owner pressing the button waits on this request; whatever the pass has
// not reached by then is reported as deferred and left to the timer.
const OPERATOR_SWEEP_BUDGET_MS = 20_000;

const PLATFORM_BODY_BYTES = 256 * 1024;

export interface CreateCloudAppOptions {
  readonly now?: () => Date;
  readonly authMiddleware?: MiddlewareHandler;
  readonly transformIndexHtml?: (html: string) => string;
  readonly backups?: { start(): () => void };
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

  const router = createTenantRouter({
    platform,
    dataDir: env.platformDir,
    tenantDomain: env.tenantDomain,
    trustForwardedHost: env.trustProxy,
    allowTenantHeader: true,
    now,
    connection: { exclusive: env.sqliteExclusive },
  });

  if (env.seedDemo) {
    await (options.seedDemo ?? provisionDemoTenant)({ platform, router, env });
  }

  if (env.reviewTenant) {
    const created = await provisionReviewTenant({ platform, router, env, now }, env.reviewTenant);
    if (created) console.log(`[cloud] reviewer tenant "${env.reviewTenant.code}" seeded; every login uses MEZAN_REVIEW_PIN.`);
  }

  const provisionTenantForRoutes = (cmd: CreateTenantRequestDTO & { actorId: string }): Promise<ProvisionResultDTO> =>
    provisionTenant(cmd, { platform, router, now });

  const provisionRetryForRoutes = async (input: { tenantId: string } & ProvisionRetryRequestDTO): Promise<ProvisionResultDTO> => {
    const tenant = await platform.stores.tenants.findById(input.tenantId);
    if (!tenant) throw new TenantNotFoundError(input.tenantId);
    const live = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    const planId = live?.planId ?? input.planId;
    const billingCycle = live?.billingCycle ?? input.billingCycle;
    if (!planId || !billingCycle) throw new PlanRequiredError();
    return provisionTenant(
      {
        code: tenant.code,
        nameAr: tenant.nameAr,
        nameEn: tenant.nameEn,
        ownerEmail: tenant.ownerEmail,
        ownerNameAr: input.ownerNameAr ?? tenant.nameAr,
        planId,
        billingCycle,
        trial: live ? live.status === "trialing" : (input.trial ?? false),
      },
      { platform, router, now },
    );
  };

  let testProvider: PaymobTestProvider | null = null;
  let cardCheckout: CardCheckoutService | null = null;
  if (env.paymob.mode !== "off") {
    const provider = env.paymob.mode === "live" ? createPaymobProvider(env.paymob) : (testProvider = createPaymobTestProvider());
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
    invalidateEntitlements: router.invalidate,
    cardCheckout: checkoutService
      ? {
          testMode: checkoutService.provider.testMode,
          open: ({ tenantId, actorId, request }) => {
            const origin = trustedReturnOrigin(request, env);
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
        }
      : undefined,
  });

  const dunningTimer = startDunningTimer(platform, {
    now,
    onError: (err) => console.error("[cloud] dunning sweep failed", err),
  });

  const checkoutSweepTimer = checkoutService
    ? startCardCheckoutSweepTimer(checkoutService, {
        onError: (err) => console.error("[cloud] card checkout sweep failed", err),
      })
    : null;

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

  // Also above the demo basic-auth and the origin-secret gate: Paymob sends
  // neither, and the HMAC verified inside is this route's only credential.
  if (checkoutService) {
    root.route(PAYMOB_WEBHOOK_PATH, createPaymobWebhookRoutes(checkoutService));
  }

  // Above the demo basic-auth: a store reviewer opens these signed out.
  root.route(
    LEGAL_BASE_PATH,
    createLegalRoutes({
      platform,
      supportEmail: env.supportEmail,
      platformSmtp: env.platformSmtp,
      trustProxy: env.trustProxy,
      now,
    }),
  );

  if (options.authMiddleware) {
    root.use("/*", options.authMiddleware);
  }

  root.use("/api/*", requireOriginSecret(env.originSecret));

  // `/api/platform` before `/api`: the tenant router's own catch-all would
  // otherwise swallow the console's routes first.
  // The platform's own forms are a few fields each. A tenant's request is
  // limited by the tenant app, which knows who is asking (api body-limit.ts).
  const platformBody = bodyLimit({
    maxSize: PLATFORM_BODY_BYTES,
    onError: (c) => c.json({ error: "PAYLOAD_TOO_LARGE", message: "حجم البيانات المرسلة أكبر من المسموح به." }, 413),
  });
  for (const mount of ["/api/platform/*", "/api/billing/*", "/api/signup/*"]) root.use(mount, platformBody);
  root.route("/api/platform", platformApp);
  root.route("/api/billing", createTenantBillingRoutes({ platform, router, env, service: checkoutService, now }));
  root.route("/api/signup", createSignupRoutes({ platform, router, env, now }));
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
      checkoutSweepTimer?.stop();
      await router.close();
      platform.close();
    },
  };
}
