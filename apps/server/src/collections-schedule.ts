import type { JobTracker } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import { TenantStatusCode, hasModule } from "@mezan/domain";
import { createTenantResolvers } from "./tenant-entitlements.js";
import type { TenantRouter } from "./tenant-router.js";

const COLLECTIONS_MODULE = "sales";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface CollectionsSweepResult {
  readonly visited: number;
  readonly ran: number;
  readonly queued: number;
  readonly sent: number;
  readonly failed: number;
}

export interface CollectionsSweepOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly now?: () => Date;
  readonly onError?: (err: unknown) => void;
}

/**
 * Visits every active, licensed tenant and lets its own backend decide whether
 * dunning is due. The opt-in (the policy's automatic sending, DEC-28: cloud
 * only, never a desktop timer) and the once-a-day guard live in the tenant's
 * books, so a tenant that has not switched it on answers "nothing to do".
 */
export async function runCollectionsSweep(options: CollectionsSweepOptions): Promise<CollectionsSweepResult> {
  const now = options.now ?? (() => new Date());
  let visited = 0;
  let ran = 0;
  let queued = 0;
  let sent = 0;
  let failed = 0;
  for (const tenant of await options.platform.stores.tenants.list()) {
    if (tenant.status !== TenantStatusCode.Active) continue;
    try {
      const resolvers = createTenantResolvers(options.platform, tenant.code, { now });
      const [entitlements, license] = await Promise.all([resolvers.resolveEntitlements(), resolvers.resolveLicenseState()]);
      if (!license.usable || !hasModule(entitlements, COLLECTIONS_MODULE)) continue;
      const backend = await options.router.backendOf(tenant.id);
      visited += 1;
      const result = await backend.runScheduledCollections();
      if (!result?.ran) continue;
      ran += 1;
      queued += result.queued;
      sent += result.sent;
    } catch (err) {
      failed += 1;
      options.onError?.(err);
    }
  }
  return { visited, ran, queued, sent, failed };
}

export interface CollectionsTimerOptions extends CollectionsSweepOptions {
  readonly intervalMs?: number;
  readonly job?: JobTracker;
}

export interface CollectionsTimer {
  stop(): Promise<void>;
}

/** The first sweep waits one interval, as the owner digest's does, so a boot never opens every tenant's books at once. */
export function startCollectionsTimer(options: CollectionsTimerOptions): CollectionsTimer {
  let current: Promise<unknown> = Promise.resolve();
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    const sweep = () => runCollectionsSweep(options);
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
