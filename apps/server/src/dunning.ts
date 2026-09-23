import { defaultFreePlan, isFreePlan, markPastDue } from "@mezan/domain";
import { materialiseEndedTrial, type PlatformHandle } from "@mezan/backend";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DunningSweepResult {
  readonly marked: number;
  readonly failed: number;
  /** Reverse trials whose drop to Free this sweep wrote down. */
  readonly landedOnFree: number;
}

export async function runDunningSweep(platform: PlatformHandle, now: () => Date): Promise<DunningSweepResult> {
  const nowIso = now().toISOString();
  const tenants = await platform.stores.tenants.list();
  const plans = await platform.stores.plans.list();
  const planById = new Map(plans.map((p) => [p.id, p] as const));
  const freePlan = defaultFreePlan(plans);
  let marked = 0;
  let failed = 0;
  let landedOnFree = 0;
  for (const tenant of tenants) {
    if (tenant.status === "archived") continue;
    try {
      const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
      if (!subscription) continue;
      // Writes down a drop to Free that no reader has crossed yet, so the
      // platform console shows the same plan a tenant's own request would
      // resolve. It calls the SAME function the request path calls, so it can
      // never produce a different answer — only an earlier one.
      if (freePlan && (await materialiseEndedTrial(platform.stores.subscriptions, platform.audit, subscription, freePlan, nowIso))) {
        landedOnFree += 1;
        continue;
      }
      if (subscription.status !== "active") continue;
      // A FREE PLAN NEVER GOES PAST DUE. It has a period end because the column
      // needs one; dunning a tenant who owes nothing would put their own books
      // into grace and then read-only a month after they landed on Free, which
      // is the exact outcome DEC-31 exists to prevent.
      const plan = planById.get(subscription.planId);
      if (plan && isFreePlan(plan)) continue;
      if (subscription.currentPeriodEnd > nowIso) continue;
      await markPastDue({ id: subscription.id, now: nowIso }, platform.stores.subscriptions);
      marked += 1;
    } catch {
      failed += 1;
    }
  }
  return { marked, failed, landedOnFree };
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
