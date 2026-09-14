import { markPastDue } from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DunningSweepResult {
  readonly marked: number;
  readonly failed: number;
}

export async function runDunningSweep(platform: PlatformHandle, now: () => Date): Promise<DunningSweepResult> {
  const nowIso = now().toISOString();
  const tenants = await platform.stores.tenants.list();
  let marked = 0;
  let failed = 0;
  for (const tenant of tenants) {
    if (tenant.status === "archived") continue;
    try {
      const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
      if (!subscription || subscription.status !== "active") continue;
      if (subscription.currentPeriodEnd > nowIso) continue;
      await markPastDue({ id: subscription.id, now: nowIso }, platform.stores.subscriptions);
      marked += 1;
    } catch {
      failed += 1;
    }
  }
  return { marked, failed };
}

export interface DunningTimerOptions {
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly onError?: (err: unknown) => void;
}

export interface DunningTimer {
  stop(): void;
}

export function startDunningTimer(platform: PlatformHandle, options: DunningTimerOptions = {}): DunningTimer {
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? DAY_MS;

  const run = () => {
    runDunningSweep(platform, now).catch((err) => options.onError?.(err));
  };
  run();

  const timer = setInterval(run, intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
