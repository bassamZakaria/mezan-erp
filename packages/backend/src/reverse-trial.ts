import {
  applyTrialEndToFree,
  defaultFreePlan,
  effectiveSubscription,
  needsTrialEndMaterialised,
  PlanChangeActor,
  recordSecurityEvent,
  SubscriptionTransition,
  type AuditSink,
  type ModuleTrial,
  type Plan,
  type Subscription,
  type SubscriptionTransitionRepository,
} from "@mezan/domain";
import type { PlatformHandle } from "./create-platform.js";

export interface TenantPlanView {
  readonly subscription: Subscription | null;
  readonly plan: Plan | null;
  readonly freePlan: Plan | null;
  readonly moduleTrials: readonly ModuleTrial[];
  /** Every entitlement module this tenant has ever held, so one that left the plan stays readable. */
  readonly everEntitled: readonly string[];
  /** True when the stored row was moved to Free by this call. */
  readonly moved: boolean;
}

/**
 * Materialises the reverse trial's drop to Free.
 *
 * LAZY, NOT SCHEDULED. `effectiveSubscription` is the single definition of what
 * a subscription is at a given instant, and every reader applies it, so the
 * answer never depends on whether a job ran — a server that was down over the
 * boundary still reads the tenant as being on Free the moment it comes back.
 * This call only writes that answer down, and is safe to lose: the next read
 * computes the same thing again.
 *
 * IDEMPOTENT under concurrency by `compareAndSet`, which moves the row only
 * while it still looks the way this caller read it and writes the audit row in
 * the SAME transaction. Two readers racing over the boundary therefore produce
 * one move and one audit row, never two.
 */
export async function materialiseEndedTrial(
  subscriptions: SubscriptionTransitionRepository,
  audit: AuditSink,
  subscription: Subscription,
  freePlan: Plan,
  nowIso: string,
  onError?: (err: unknown) => void,
): Promise<boolean> {
  if (!needsTrialEndMaterialised(subscription, freePlan.id, nowIso)) return false;
  const after = applyTrialEndToFree(subscription, freePlan.id, nowIso);
  try {
    return await subscriptions.compareAndSet(subscription, after, async () => {
      await recordSecurityEvent(audit, {
        module: "platform",
        entityType: "SUBSCRIPTION",
        entityId: subscription.id,
        action: SubscriptionTransition.TrialEndedToFree,
        actor: PlanChangeActor.ReverseTrial,
        severity: "INFO",
        timestamp: nowIso,
        details: {
          tenantId: subscription.tenantId,
          fromPlanId: subscription.planId,
          toPlanId: freePlan.id,
          trialEndedAt: subscription.trialEndsAt,
        },
      });
    });
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/**
 * The tenant's plan as of `nowIso`, with the trial drop already applied — and
 * written back when it had not been yet.
 */
export async function resolveTenantPlan(
  platform: PlatformHandle,
  tenantId: string,
  nowIso: string,
  onError?: (err: unknown) => void,
): Promise<TenantPlanView> {
  const history = await platform.stores.subscriptions.listByTenant(tenantId);
  const live = await platform.stores.subscriptions.findLiveByTenant(tenantId);
  // Read access survives cancellation: fall back to the most recent row.
  const stored = live ?? (history.length > 0 ? history[history.length - 1]! : null);
  const plans = await platform.stores.plans.list();
  const freePlan = defaultFreePlan(plans);

  const moved = stored !== null && freePlan !== null
    ? await materialiseEndedTrial(platform.stores.subscriptions, platform.audit, stored, freePlan, nowIso, onError)
    : false;

  const subscription = effectiveSubscription(stored, freePlan?.id ?? null, nowIso);
  const plan = subscription ? (plans.find((p) => p.id === subscription.planId) ?? null) : null;
  const moduleTrials = await platform.stores.moduleTrials.listByTenant(tenantId);

  const planById = new Map(plans.map((p) => [p.id, p] as const));
  const ever = new Set<string>();
  for (const s of history) {
    for (const m of planById.get(s.planId)?.modules ?? []) ever.add(m);
    for (const m of s.addOnModules) ever.add(m);
  }
  if (subscription) for (const m of planById.get(subscription.planId)?.modules ?? []) ever.add(m);
  for (const t of moduleTrials) ever.add(t.module);

  return { subscription, plan, freePlan, moduleTrials, everEntitled: [...ever], moved };
}
