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
import { startDunningTimer } from "./dunning.js";
import type { CloudEnv } from "./env.js";

export interface CreateCloudAppOptions {
  readonly now?: () => Date;
  /** Registered first, ahead of every route — e.g. `cloud.ts`'s shared demo Basic-auth wall. Omitted, every request passes through untouched. */
  readonly authMiddleware?: MiddlewareHandler;
  /** Rewrites `index.html` once, right after it is read from disk — e.g. `cloud.ts`'s analytics-beacon injection. */
  readonly transformIndexHtml?: (html: string) => string;
  /**
   * The in-app backup scheduler (task C2): `start()` begins the timer and
   * returns its `stop()`. Not implemented in this task — omitted, `close()`
   * has nothing of its own to stop.
   */
  readonly backups?: { start(): () => void };
  /**
   * Provisions the seeded demo tenant (task C3), called once at startup when
   * `MEZAN_SEED_DEMO=1`. Not implemented in this task — omitted, the flag has
   * no effect no matter its value.
   */
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

/** Same banner shape `apps/server/src/index.ts` prints the seeded admin PIN with. */
function printGeneratedOwnerPassword(password: string): void {
  console.log("[cloud] ------------------------------------------------------------");
  console.log("[cloud] The platform owner was seeded with a GENERATED PASSWORD. It is");
  console.log("[cloud] shown once, here, and is not recoverable from the database.");
  console.log(`[cloud]   owner password: ${password}`);
  console.log("[cloud] Sign in, then change it.");
  console.log("[cloud] ------------------------------------------------------------");
}

/**
 * Composes the platform database, the platform console API, the tenant
 * router, provisioning, dunning and (through the seams above) backups and the
 * seeded demo tenant into ONE app. `cloud.ts` and `index.ts` each add only
 * what is specific to their own deployment shape around this.
 */
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

  if (env.seedDemo && options.seedDemo) {
    await options.seedDemo({ platform, router, env });
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

  let stopBackups: (() => void) | undefined;
  if (env.backupIntervalMinutes > 0 && options.backups) {
    stopBackups = options.backups.start();
  }

  const root = new Hono();

  if (options.authMiddleware) {
    root.use("/*", options.authMiddleware);
  }

  root.get("/healthz", (c) => c.text("ok"));

  root.use("/api/*", requireOriginSecret(env.originSecret));

  root.route("/api/platform", platformApp);
  root.route("/api", router.app);

  root.onError((err, c) => {
    console.error(err);
    return c.json({ error: "INTERNAL", message: "حدث خطأ غير متوقع" }, 500);
  });

  const rawIndexHtml = await readFile(path.join(env.webDist, "index.html"), "utf8");
  const indexHtml = options.transformIndexHtml ? options.transformIndexHtml(rawIndexHtml) : rawIndexHtml;

  root.get("/", (c) => c.html(indexHtml));
  root.get("/index.html", (c) => c.html(indexHtml));
  root.use("/*", serveStatic({ root: env.webDist }));
  root.notFound((c) => c.html(indexHtml));

  return {
    root,
    async close() {
      stopBackups?.();
      dunningTimer.stop();
      await router.close();
      platform.close();
    },
  };
}
