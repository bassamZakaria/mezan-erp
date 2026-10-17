import type { JobTracker } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import { TenantStatusCode, hasModule } from "@mezan/domain";
import { createTenantResolvers } from "./tenant-entitlements.js";
import type { TenantRouter } from "./tenant-router.js";

const OWNER_DIGEST_MODULE = "accounting";
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

export interface OwnerDigestSweepResult {
  readonly visited: number;
  readonly queued: number;
  readonly failed: number;
}

export interface OwnerDigestSweepOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly now?: () => Date;
  readonly onError?: (err: unknown) => void;
}

/**
 * Visits every active, licensed tenant and lets its own backend decide whether a
 * digest is due. The opt-in and the per-(period, recipient) idempotency live inside
 * the tenant's books, so a tenant that has not switched the schedule on is opened,
 * answers "nothing to do" and is left alone; opening it never writes.
 */
export async function runOwnerDigestSweep(options: OwnerDigestSweepOptions): Promise<OwnerDigestSweepResult> {
  const now = options.now ?? (() => new Date());
  let visited = 0;
  let queued = 0;
  let failed = 0;
  for (const tenant of await options.platform.stores.tenants.list()) {
    if (tenant.status !== TenantStatusCode.Active) continue;
    try {
      const resolvers = createTenantResolvers(options.platform, tenant.code, { now });
      const [entitlements, license] = await Promise.all([resolvers.resolveEntitlements(), resolvers.resolveLicenseState()]);
      if (!license.usable || !hasModule(entitlements, OWNER_DIGEST_MODULE)) continue;
      const backend = await options.router.backendOf(tenant.id);
      visited += 1;
      const result = await backend.runOwnerDigest();
      queued += result?.queued ?? 0;
    } catch (err) {
      failed += 1;
      options.onError?.(err);
    }
  }
  return { visited, queued, failed };
}

export interface OwnerDigestTimerOptions extends OwnerDigestSweepOptions {
  readonly intervalMs?: number;
  readonly job?: JobTracker;
}

export interface OwnerDigestTimer {
  stop(): Promise<void>;
}

/**
 * The first sweep waits one interval: a process that has just started (or a test that boots the
 * cloud app) must not open every tenant's books at once.
 */
export function startOwnerDigestTimer(options: OwnerDigestTimerOptions): OwnerDigestTimer {
  let current: Promise<unknown> = Promise.resolve();
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    const sweep = () => runOwnerDigestSweep(options);
    current = (options.job ? options.job.run(sweep, (result) => result.queued) : sweep())
      .catch((err: unknown) => options.onError?.(err))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(run, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await current;
    },
  };
}
