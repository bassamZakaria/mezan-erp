import { markPastDue } from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Marks every tenant's live subscription `past_due` once its current period
 * has ended, and leaves every other one alone (trialing, already past_due,
 * suspended, cancelled, or still within its period). Returns how many it moved.
 */
export async function runDunningSweep(platform: PlatformHandle, now: () => Date): Promise<number> {
  const nowIso = now().toISOString();
  const tenants = await platform.stores.tenants.list();
  let moved = 0;
  for (const tenant of tenants) {
    const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    if (!subscription || subscription.status !== "active") continue;
    if (subscription.currentPeriodEnd > nowIso) continue;
    await markPastDue({ id: subscription.id, now: nowIso }, platform.stores.subscriptions);
    moved += 1;
  }
  return moved;
}

export interface DunningTimerOptions {
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly onError?: (err: unknown) => void;
}

export interface DunningTimer {
  stop(): void;
}

/**
 * Runs the sweep once immediately, then every `intervalMs` (24h by default).
 * `unref()`s its timer so a plain sweep loop never keeps the process alive on
 * its own — apps/server still runs; nothing else pins the event loop for this.
 */
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
