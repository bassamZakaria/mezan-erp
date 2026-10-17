/**
 * Entitlements — the one capability object every gate in the codebase reads
 * (docs/archive/plan.md §2.5). It has the SAME shape in both editions: cloud derives it
 * from the subscription record / JWT, desktop from the signed license file. A
 * gate calls `has('pos')` / `hasFeature('pos.restaurant_mode')` and neither
 * knows nor cares which source produced it.
 */

export interface EntitlementLimits {
  readonly branches: number;
  readonly warehouses: number;
}

export interface EntitlementModuleTrial {
  readonly module: string;
  readonly startedAt: string;
  readonly endsAt: string;
}

export interface Entitlements {
  readonly plan: string;
  /** Per-tenant module toggle list gating the whole nav (recon §tenant payload). */
  readonly activeModules: readonly string[];
  /** Modules the tenant once had and no longer does: reads and exports still answer, writes are refused. */
  readonly readOnlyModules?: readonly string[];
  /** Usage quotas keyed by `QuotaKind`; an absent key is unlimited. */
  readonly quotas?: Readonly<Record<string, number>>;
  readonly moduleTrials?: readonly EntitlementModuleTrial[];
  readonly planNameAr?: string;
  readonly planNameEn?: string;
  /** `PlanKind` of the plan these entitlements come from. */
  readonly planKind?: string;
  /** When the tenant's reverse trial ends; null or absent when it is not on one. */
  readonly trialEndsAt?: string | null;
  /** Finer-grained per-capability flags layered under module activation. */
  readonly features: Readonly<Record<string, boolean>>;
  readonly seats: number;
  /** ISO timestamp, or null for a perpetual/no-expiry grant. */
  readonly expiresAt: string | null;
  readonly limits?: EntitlementLimits;
}

export interface EntitlementsView extends Entitlements {
  has(module: string): boolean;
  hasFeature(flag: string): boolean;
}

export function hasModule(ent: Entitlements, module: string): boolean {
  return ent.activeModules.includes(module);
}

export function hasReadOnlyModule(ent: Entitlements, module: string): boolean {
  return !hasModule(ent, module) && (ent.readOnlyModules ?? []).includes(module);
}

export function hasFeature(ent: Entitlements, flag: string): boolean {
  return ent.features[flag] === true;
}

/**
 * Wraps raw entitlement data with the `has` / `hasFeature` convenience methods.
 * The wrapper is a plain frozen object (no class) so it serializes cleanly.
 */
export function createEntitlements(data: Entitlements): EntitlementsView {
  return Object.freeze({
    plan: data.plan,
    activeModules: data.activeModules,
    features: data.features,
    seats: data.seats,
    expiresAt: data.expiresAt,
    ...(data.limits !== undefined ? { limits: data.limits } : {}),
    ...(data.readOnlyModules !== undefined ? { readOnlyModules: data.readOnlyModules } : {}),
    ...(data.quotas !== undefined ? { quotas: data.quotas } : {}),
    ...(data.moduleTrials !== undefined ? { moduleTrials: data.moduleTrials } : {}),
    ...(data.planNameAr !== undefined ? { planNameAr: data.planNameAr } : {}),
    ...(data.planNameEn !== undefined ? { planNameEn: data.planNameEn } : {}),
    ...(data.planKind !== undefined ? { planKind: data.planKind } : {}),
    ...(data.trialEndsAt !== undefined ? { trialEndsAt: data.trialEndsAt } : {}),
    has(module: string) {
      return hasModule(data, module);
    },
    hasFeature(flag: string) {
      return hasFeature(data, flag);
    },
  });
}

/**
 * Safe default: nothing licensed, zero seats. Any resolver that cannot
 * establish a real subscription/license returns this rather than a
 * permissive default — same "fail closed" posture as every gate that reads it.
 */
export const UNLICENSED_ENTITLEMENTS: EntitlementsView = createEntitlements({
  plan: "UNLICENSED",
  activeModules: [],
  features: {},
  seats: 0,
  expiresAt: null,
});

// INVARIANT: stamped by the edition that mounts the subscription billing routes beside the tenant backend (apps/server) and by nothing else; an offline licence never carries it, so the shell neither offers «الباقة والاستخدام» nor asks `/billing/subscription` there.
export const SUBSCRIPTION_BILLING_FEATURE = "billing.subscription";

export function withSubscriptionBilling(data: Entitlements): EntitlementsView {
  return createEntitlements({ ...data, features: { ...data.features, [SUBSCRIPTION_BILLING_FEATURE]: true } });
}
