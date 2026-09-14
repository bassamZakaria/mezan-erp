import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { createPlatform, createPlatformAuth, createPlatformRoutes, type PlatformHandle } from "@mezan/backend";
import { createSessionRegistry } from "@mezan/api";
import type { CreateTenantRequestDTO, ProvisionResultDTO } from "@mezan/contracts";
import { createTenantRouter, requireOriginSecret, type TenantRouter } from "./tenant-router.js";
import { provisionTenant } from "./provision-tenant.js";
import { provisionDemoTenant } from "./demo-tenant.js";
import { startDunningTimer } from "./dunning.js";
import { createBackupScheduler } from "./backup-scheduler.js";
import type { CloudEnv } from "./env.js";

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

  const provisionTenantForRoutes = (cmd: CreateTenantRequestDTO & { actorId: string }): Promise<ProvisionResultDTO> =>
    provisionTenant(cmd, { platform, router, now });

  const platformApp = createPlatformRoutes({
    platform,
    auth,
    now,
    provisionTenant: provisionTenantForRoutes,
    invalidateEntitlements: router.invalidate,
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

  if (options.authMiddleware) {
    root.use("/*", options.authMiddleware);
  }

  root.use("/api/*", requireOriginSecret(env.originSecret));

  // `/api/platform` before `/api`: the tenant router's own catch-all would
  // otherwise swallow the console's routes first.
  root.route("/api/platform", platformApp);
  root.route("/api", router.app);

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
