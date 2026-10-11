import type { Entitlements } from "../entitlements/entitlements.js";
import { dedupeModules, isFreePlan, type Plan } from "./plan.js";
import { liveTrialModules, type ModuleTrial } from "./module-trial.js";
import { addDays, SubscriptionStatusKind, type Subscription } from "./subscription.js";
import { TenantStatusCode, type Tenant } from "./tenant.js";
import { isoTimestamp } from "./validation.js";

export function subscriptionExpiresAt(s: Subscription): string {
  return s.status === SubscriptionStatusKind.Trialing && s.trialEndsAt ? s.trialEndsAt : s.currentPeriodEnd;
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
    trialEndsAt: subscription.status === SubscriptionStatusKind.Trialing ? subscription.trialEndsAt : null,
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

export enum LicenseStateName {
  Active = "ACTIVE",
  Grace = "GRACE",
  ReadOnly = "READ_ONLY",
  Invalid = "INVALID",
  Unlicensed = "UNLICENSED",
}
export type SubscriptionLicenseStateName = `${LicenseStateName}`;

export enum LicenseReasonCode {
  TenantArchived = "TENANT_ARCHIVED",
  NoSubscription = "NO_SUBSCRIPTION",
  TenantSuspended = "TENANT_SUSPENDED",
  SubscriptionCancelled = "SUBSCRIPTION_CANCELLED",
  SubscriptionSuspended = "SUBSCRIPTION_SUSPENDED",
  TrialEnded = "TRIAL_ENDED",
  GraceEnded = "GRACE_ENDED",
  InvalidClock = "INVALID_CLOCK",
  StatusUnknown = "STATUS_UNKNOWN",
}
export type SubscriptionLicenseReason = `${LicenseReasonCode}`;

export const STATUS_UNKNOWN_MESSAGE_AR = "حالة الاشتراك غير معروفة — تواصل مع الدعم";

export interface SubscriptionLicenseState {
  readonly state: SubscriptionLicenseStateName;
  readonly canWrite: boolean;
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  readonly graceEndsAt?: string;
  readonly reason?: SubscriptionLicenseReason;
  readonly messageAr?: string;
}

const TENANT_STATUSES: readonly string[] = Object.values(TenantStatusCode);
const SUBSCRIPTION_STATUSES: readonly string[] = Object.values(SubscriptionStatusKind);
const WRITABLE_TENANT_STATUSES: readonly string[] = [TenantStatusCode.Active];
const WRITABLE_SUBSCRIPTION_STATUSES: readonly string[] = [
  SubscriptionStatusKind.Trialing,
  SubscriptionStatusKind.Active,
  SubscriptionStatusKind.PastDue,
];

/** Archived and still-provisioning tenants are not served at all; every other stored status reaches its own backend, where the licence state decides what it may do. */
export function tenantIsServed(tenant: Pick<Tenant, "status"> | null): boolean {
  return tenant !== null && tenant.status !== TenantStatusCode.Archived && tenant.status !== TenantStatusCode.Provisioning;
}

export function subscriptionLicenseState(
  tenant: Tenant,
  subscription: Subscription | null,
  now: string,
  plan?: Pick<Plan, "kind"> | null,
): SubscriptionLicenseState {
  const licensee = tenant.nameAr;
  const readOnly = (reason: LicenseReasonCode, expiresAt?: string): SubscriptionLicenseState => ({
    state: LicenseStateName.ReadOnly,
    canWrite: false,
    usable: true,
    licensee,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    reason,
    ...(reason === LicenseReasonCode.StatusUnknown ? { messageAr: STATUS_UNKNOWN_MESSAGE_AR } : {}),
  });
  const at = isoTimestamp(now);
  if (at === null) {
    return { state: LicenseStateName.Invalid, canWrite: false, usable: true, licensee, reason: LicenseReasonCode.InvalidClock };
  }
  if (tenant.status === TenantStatusCode.Archived) {
    return { state: LicenseStateName.Invalid, canWrite: false, usable: false, licensee, reason: LicenseReasonCode.TenantArchived };
  }
  if (!TENANT_STATUSES.includes(tenant.status)) return readOnly(LicenseReasonCode.StatusUnknown);
  if (tenant.status === TenantStatusCode.Provisioning || !subscription) {
    return { state: LicenseStateName.Unlicensed, canWrite: false, usable: true, licensee, reason: LicenseReasonCode.NoSubscription };
  }
  if (!SUBSCRIPTION_STATUSES.includes(subscription.status)) return readOnly(LicenseReasonCode.StatusUnknown);
  const expiresAt = subscriptionExpiresAt(subscription);
  if (tenant.status === TenantStatusCode.Suspended) return readOnly(LicenseReasonCode.TenantSuspended, expiresAt);
  if (subscription.status === SubscriptionStatusKind.Cancelled) return readOnly(LicenseReasonCode.SubscriptionCancelled, expiresAt);
  if (subscription.status === SubscriptionStatusKind.Suspended) return readOnly(LicenseReasonCode.SubscriptionSuspended, expiresAt);
  // SECURITY: writing is granted only from here on, and only to the statuses
  // named in the two WRITABLE lists. A status added to either enum later is
  // read-only until it is added to its list on purpose.
  if (!WRITABLE_TENANT_STATUSES.includes(tenant.status) || !WRITABLE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
    return readOnly(LicenseReasonCode.StatusUnknown, expiresAt);
  }
  // A free plan never lapses: no period end, no grace, no read-only. Checked
  // before every date comparison below, which is the whole point of DEC-31 —
  // the tenant's own books must never be held behind a renewal.
  if (plan && isFreePlan(plan)) {
    return { state: LicenseStateName.Active, canWrite: true, usable: true, licensee };
  }
  if (subscription.status === SubscriptionStatusKind.Trialing) {
    // Reached only when the deployment has no active free plan to land on;
    // `effectiveSubscription` has already moved every other lapsed trial.
    return at < expiresAt
      ? { state: LicenseStateName.Active, canWrite: true, usable: true, licensee, expiresAt }
      : readOnly(LicenseReasonCode.TrialEnded, expiresAt);
  }
  if (at < subscription.currentPeriodEnd) {
    return { state: LicenseStateName.Active, canWrite: true, usable: true, licensee, expiresAt };
  }
  const graceEndsAt = addDays(subscription.currentPeriodEnd, subscription.graceDays);
  if (at < graceEndsAt) {
    return { state: LicenseStateName.Grace, canWrite: true, usable: true, licensee, expiresAt, graceEndsAt };
  }
  return readOnly(LicenseReasonCode.GraceEnded, expiresAt);
}
