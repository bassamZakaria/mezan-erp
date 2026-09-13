import type { Entitlements } from "../entitlements/entitlements.js";
import { dedupeModules, type Plan } from "./plan.js";
import { addDays, type Subscription } from "./subscription.js";
import type { Tenant } from "./tenant.js";
import { isoTimestamp } from "./validation.js";

export function subscriptionExpiresAt(s: Subscription): string {
  return s.status === "trialing" && s.trialEndsAt ? s.trialEndsAt : s.currentPeriodEnd;
}

export function deriveEntitlements(plan: Plan, subscription: Subscription): Entitlements {
  return {
    plan: plan.code,
    activeModules: dedupeModules([...plan.modules, ...subscription.addOnModules]),
    features: { ...plan.features },
    seats: plan.seatsIncluded + subscription.extraSeats,
    expiresAt: subscriptionExpiresAt(subscription),
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
  if (subscription.status === "trialing") {
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
