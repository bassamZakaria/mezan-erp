import {
  createEntitlements, deriveEntitlements, subscriptionLicenseState, SubscriptionStatusKind, UNLICENSED_ENTITLEMENTS,
  type Entitlements,
} from "@mezan/domain";
import { resolveTenantPlan, type PlatformHandle } from "@mezan/backend";
import type { LicenseStateView } from "@mezan/api";

export interface TenantResolvers {
  resolveEntitlements(): Promise<Entitlements>;
  resolveLicenseState(): Promise<LicenseStateView>;
  invalidate(): void;
}

interface Snapshot { readonly entitlements: Entitlements; readonly license: LicenseStateView; readonly at: number; readonly until: number }

const MISSING_TENANT: LicenseStateView = { state: "INVALID", canWrite: false, usable: false, reason: "TENANT_NOT_FOUND" };

export function createTenantResolvers(
  platform: PlatformHandle,
  code: string,
  options: { readonly now?: () => Date; readonly ttlMs?: number; readonly onError?: (err: unknown) => void } = {},
): TenantResolvers {
  const now = options.now ?? (() => new Date());
  const ttl = options.ttlMs ?? 30_000;
  let snapshot: Snapshot | null = null;

  async function load(): Promise<Snapshot> {
    const at = now();
    const nowIso = at.toISOString();
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant) return { entitlements: UNLICENSED_ENTITLEMENTS, license: MISSING_TENANT, at: at.getTime(), until: at.getTime() + ttl };
    // Resolves the reverse trial's drop to Free (and writes it back) BEFORE
    // anything is derived, so the entitlements and the licence state below can
    // never disagree about which plan the tenant is on.
    const view = await resolveTenantPlan(platform, tenant.id, nowIso, options.onError);
    const { subscription, plan } = view;
    const entitlements = subscription && plan
      ? createEntitlements(
          deriveEntitlements(plan, subscription, {
            moduleTrials: view.moduleTrials,
            everEntitled: view.everEntitled,
            now: nowIso,
          }),
        )
      : UNLICENSED_ENTITLEMENTS;
    const license = subscriptionLicenseState(tenant, subscription, nowIso, plan);
    // The cache must not outlive the trial it is caching: a snapshot taken a
    // minute before the boundary would otherwise keep serving the top plan
    // after it, and a second process reading fresh would disagree.
    const trialEnds = subscription?.status === SubscriptionStatusKind.Trialing && subscription.trialEndsAt
      ? Date.parse(subscription.trialEndsAt)
      : Number.POSITIVE_INFINITY;
    return { entitlements, license, at: at.getTime(), until: Math.min(at.getTime() + ttl, trialEnds) };
  }

  async function current(): Promise<Snapshot> {
    if (snapshot && now().getTime() < snapshot.until) return snapshot;
    snapshot = await load();
    return snapshot;
  }

  return {
    async resolveEntitlements() { return (await current()).entitlements; },
    async resolveLicenseState() { return (await current()).license; },
    invalidate() { snapshot = null; },
  };
}
