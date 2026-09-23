import type { Entitlements } from "../entitlements/entitlements.js";
import { dedupeModules, isFreePlan, type Plan } from "./plan.js";
import { liveTrialModules, type ModuleTrial } from "./module-trial.js";
import { addDays, type Subscription } from "./subscription.js";
import type { Tenant } from "./tenant.js";
import { isoTimestamp } from "./validation.js";

export function subscriptionExpiresAt(s: Subscription): string {
  return s.status === "trialing" && s.trialEndsAt ? s.trialEndsAt : s.currentPeriodEnd;
}

export interface DeriveEntitlementsContext {
  readonly moduleTrials?: readonly ModuleTrial[];
  /** Every module this tenant has ever been entitled to. One that is no longer active stays readable. */
  readonly everEntitled?: readonly string[];
  readonly now?: string;
}

export function deriveEntitlements(plan: Plan, subscription: Subscription, context: DeriveEntitlementsContext = {}): Entitlements {
  const trials = context.moduleTrials ?? [];
  const now = context.now ?? new Date().toISOString();
  const activeModules = dedupeModules([...plan.modules, ...subscription.addOnModules, ...liveTrialModules(trials, now)]);
  const readOnlyModules = dedupeModules([...(context.everEntitled ?? []), ...trials.map((t) => t.module)]).filter(
    (m) => !activeModules.includes(m),
  );
  return {
    plan: plan.code,
    planNameAr: plan.nameAr,
    planNameEn: plan.nameEn,
    planKind: plan.kind,
    trialEndsAt: subscription.status === "trialing" ? subscription.trialEndsAt : null,
    activeModules,
    readOnlyModules,
    features: { ...plan.features },
    seats: plan.seatsIncluded + subscription.extraSeats,
    expiresAt: isFreePlan(plan) ? null : subscriptionExpiresAt(subscription),
    limits: {
      branches: plan.branchesIncluded + subscription.extraBranches,
      warehouses: plan.warehousesIncluded + subscription.extraWarehouses,
    },
    quotas: { ...plan.quotas },
    moduleTrials: trials.map((t) => ({ module: t.module, startedAt: t.startedAt, endsAt: t.endsAt })),
  };
}

export type SubscriptionLicenseStateName = "ACTIVE" | "GRACE" | "READ_ONLY" | "INVALID" | "UNLICENSED";

export type SubscriptionLicenseReason =
  | "TENANT_ARCHIVED"
  | "NO_SUBSCRIPTION"
  | "TENANT_SUSPENDED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_SUSPENDED"
  | "TRIAL_ENDED"
  | "GRACE_ENDED"
  | "INVALID_CLOCK";

export interface SubscriptionLicenseState {
  readonly state: SubscriptionLicenseStateName;
  readonly canWrite: boolean;
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  readonly graceEndsAt?: string;
  readonly reason?: SubscriptionLicenseReason;
}

export function subscriptionLicenseState(
  tenant: Tenant,
  subscription: Subscription | null,
  now: string,
  plan?: Pick<Plan, "kind"> | null,
): SubscriptionLicenseState {
  const licensee = tenant.nameAr;
  const at = isoTimestamp(now);
  if (at === null) {
    return { state: "INVALID", canWrite: false, usable: true, licensee, reason: "INVALID_CLOCK" };
  }
  if (tenant.status === "archived") {
    return { state: "INVALID", canWrite: false, usable: false, licensee, reason: "TENANT_ARCHIVED" };
  }
  if (tenant.status === "provisioning" || !subscription) {
    return { state: "UNLICENSED", canWrite: false, usable: true, licensee, reason: "NO_SUBSCRIPTION" };
  }
  const expiresAt = subscriptionExpiresAt(subscription);
  if (tenant.status === "suspended") {
    return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "TENANT_SUSPENDED" };
  }
  if (subscription.status === "cancelled") {
    return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "SUBSCRIPTION_CANCELLED" };
  }
  if (subscription.status === "suspended") {
    return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "SUBSCRIPTION_SUSPENDED" };
  }
  // A free plan never lapses: no period end, no grace, no read-only. Checked
  // before every date comparison below, which is the whole point of DEC-31 —
  // the tenant's own books must never be held behind a renewal.
  if (plan && isFreePlan(plan) && subscription.status !== "past_due") {
    return { state: "ACTIVE", canWrite: true, usable: true, licensee };
  }
  if (subscription.status === "trialing") {
    // Reached only when the deployment has no active free plan to land on;
    // `effectiveSubscription` has already moved every other lapsed trial.
    return at < expiresAt
      ? { state: "ACTIVE", canWrite: true, usable: true, licensee, expiresAt }
      : { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "TRIAL_ENDED" };
  }
  if (at < subscription.currentPeriodEnd) {
    return { state: "ACTIVE", canWrite: true, usable: true, licensee, expiresAt };
  }
  const graceEndsAt = addDays(subscription.currentPeriodEnd, subscription.graceDays);
  if (at < graceEndsAt) {
    return { state: "GRACE", canWrite: true, usable: true, licensee, expiresAt, graceEndsAt };
  }
  return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "GRACE_ENDED" };
}
