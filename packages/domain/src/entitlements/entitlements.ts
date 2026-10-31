/**
 * Entitlements — the one capability object every gate in the codebase reads
 * (docs/archive/plan.md §2.5). It has the SAME shape in both editions: cloud derives it
 * from the subscription record / JWT, desktop from the signed license file. A
 * gate calls `has('pos')` / `hasFeature('pos.restaurant_mode')` and neither
 * knows nor cares which source produced it.
 */

import { FREE_SUB_MODULES, SUB_MODULES, parentOf } from "./sub-modules.js";

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

/**
 * A whole module is held only when listed. A part is held when listed, when
 * its parent is listed, or when every plan gets it free (sub-modules.ts).
 */
export function hasModule(ent: Pick<Entitlements, "activeModules">, module: string): boolean {
  if (ent.activeModules.includes(module)) return true;
  const parent = parentOf(module);
  return parent !== null && (FREE_SUB_MODULES.has(module) || ent.activeModules.includes(parent));
}

export function hasReadOnlyModule(ent: Pick<Entitlements, "activeModules" | "readOnlyModules">, module: string): boolean {
  if (hasModule(ent, module)) return false;
  const readOnly = ent.readOnlyModules ?? [];
  const parent = parentOf(module);
  return readOnly.includes(module) || (parent !== null && readOnly.includes(parent));
}

/** True when the parent or any of its parts is held — for showing a module's menu, never for a write gate. */
export function hasAnyPartOf(ent: Pick<Entitlements, "activeModules">, parent: string): boolean {
  return hasModule(ent, parent) || (SUB_MODULES[parent] ?? []).some((part) => hasModule(ent, part));
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
