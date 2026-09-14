import {
  createEntitlements, deriveEntitlements, subscriptionLicenseState, UNLICENSED_ENTITLEMENTS,
  type Entitlements, type Subscription,
} from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";
import type { LicenseStateView } from "@mezan/api";

export interface TenantResolvers {
  resolveEntitlements(): Promise<Entitlements>;
  resolveLicenseState(): Promise<LicenseStateView>;
  invalidate(): void;
}

interface Snapshot { readonly entitlements: Entitlements; readonly license: LicenseStateView; readonly at: number }

const MISSING_TENANT: LicenseStateView = { state: "INVALID", canWrite: false, usable: false, reason: "TENANT_NOT_FOUND" };

export function createTenantResolvers(
  platform: PlatformHandle,
  code: string,
  options: { readonly now?: () => Date; readonly ttlMs?: number } = {},
): TenantResolvers {
  const now = options.now ?? (() => new Date());
  const ttl = options.ttlMs ?? 30_000;
  let snapshot: Snapshot | null = null;

  /** The tenant's most recent subscription regardless of status — read access survives cancellation. */
  async function latestSubscription(tenantId: string): Promise<Subscription | null> {
    const all = await platform.stores.subscriptions.listByTenant(tenantId);
    return all.length > 0 ? all[all.length - 1]! : null;
  }

  async function load(): Promise<Snapshot> {
    const at = now();
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant) return { entitlements: UNLICENSED_ENTITLEMENTS, license: MISSING_TENANT, at: at.getTime() };
    const live = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    const subscription = live ?? (await latestSubscription(tenant.id));
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    const entitlements = subscription && plan
      ? createEntitlements(deriveEntitlements(plan, subscription))
      : UNLICENSED_ENTITLEMENTS;
    const license = subscriptionLicenseState(tenant, subscription, at.toISOString());
    return { entitlements, license, at: at.getTime() };
  }

  async function current(): Promise<Snapshot> {
    if (snapshot && now().getTime() - snapshot.at < ttl) return snapshot;
    snapshot = await load();
    return snapshot;
  }

  return {
    async resolveEntitlements() { return (await current()).entitlements; },
    async resolveLicenseState() { return (await current()).license; },
    invalidate() { snapshot = null; },
  };
}
