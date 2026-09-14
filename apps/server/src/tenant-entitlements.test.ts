import { afterEach, describe, expect, it } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import { createTenant, activateTenant, startSubscription, cancelSubscription } from "@mezan/domain";
import { createTenantResolvers } from "./tenant-entitlements.js";

const T = new Date("2026-01-15T00:00:00.000Z").getTime();

const platforms: PlatformHandle[] = [];
afterEach(() => {
  for (const p of platforms.splice(0)) p.close();
});

async function newPlatform(): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: ":memory:" });
  platforms.push(platform);
  return platform;
}

describe("createTenantResolvers", () => {
  it("resolves entitlements and licence state from the tenant's live subscription", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant(
      {
        id: "t-cyag",
        code: "cyag",
        nameAr: "سياج",
        ownerEmail: "owner@cyag.example",
        now: new Date(T).toISOString(),
      },
      platform.stores.tenants,
    );
    await activateTenant({ id: tenant.id, now: new Date(T).toISOString() }, platform.stores.tenants);
    await startSubscription(
      {
        id: "sub-cyag",
        tenantId: tenant.id,
        planId: "PLAN-BUSINESS",
        billingCycle: "monthly",
        extraSeats: 2,
        now: new Date(T).toISOString(),
      },
      platform.stores.subscriptions,
      platform.stores.plans,
    );

    const r = createTenantResolvers(platform, "cyag", { now: () => new Date(T), ttlMs: 1000 });

    const entitlements = await r.resolveEntitlements();
    expect(entitlements.plan).toBe("business");
    expect(entitlements.seats).toBe(12);
    expect(entitlements.limits?.branches).toBe(3);
    expect(entitlements.activeModules).toContain("crm");
    expect(entitlements.activeModules).not.toContain("hr");

    const license = await r.resolveLicenseState();
    expect(license.state).toBe("ACTIVE");
    expect(license.canWrite).toBe(true);
    expect(license.licensee).toBe(tenant.nameAr);
  });

  it("keeps answering within the TTL after the subscription changes underneath it, then reflects the change after invalidate", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant(
      {
        id: "t-nile",
        code: "nile",
        nameAr: "النيل",
        ownerEmail: "owner@nile.example",
        now: new Date(T).toISOString(),
      },
      platform.stores.tenants,
    );
    await activateTenant({ id: tenant.id, now: new Date(T).toISOString() }, platform.stores.tenants);
    await startSubscription(
      {
        id: "sub-nile",
        tenantId: tenant.id,
        planId: "PLAN-CORE",
        billingCycle: "monthly",
        now: new Date(T).toISOString(),
      },
      platform.stores.subscriptions,
      platform.stores.plans,
    );

    const r = createTenantResolvers(platform, "nile", { now: () => new Date(T), ttlMs: 1000 });
    expect((await r.resolveLicenseState()).state).toBe("ACTIVE");

    await cancelSubscription({ id: "sub-nile", now: new Date(T).toISOString() }, platform.stores.subscriptions);

    expect((await r.resolveLicenseState()).state).toBe("ACTIVE");

    r.invalidate();

    const license = await r.resolveLicenseState();
    expect(license.state).toBe("READ_ONLY");
    expect(license.reason).toBe("SUBSCRIPTION_CANCELLED");

    const entitlements = await r.resolveEntitlements();
    expect(entitlements.plan).toBe("core");
    expect(entitlements.activeModules).toContain("sales");
  });

  it("gives UNLICENSED_ENTITLEMENTS and state UNLICENSED for a tenant with no subscription", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant(
      {
        id: "t-bare",
        code: "bare",
        nameAr: "عارية",
        ownerEmail: "owner@bare.example",
        now: new Date(T).toISOString(),
      },
      platform.stores.tenants,
    );
    await activateTenant({ id: tenant.id, now: new Date(T).toISOString() }, platform.stores.tenants);

    const r = createTenantResolvers(platform, "bare", { now: () => new Date(T) });
    const entitlements = await r.resolveEntitlements();
    expect(entitlements.plan).toBe("UNLICENSED");
    expect(entitlements.seats).toBe(0);

    const license = await r.resolveLicenseState();
    expect(license.state).toBe("UNLICENSED");
  });

  it("gives UNLICENSED_ENTITLEMENTS and state INVALID for an unknown tenant code", async () => {
    const platform = await newPlatform();
    const r = createTenantResolvers(platform, "ghost", { now: () => new Date(T) });

    const entitlements = await r.resolveEntitlements();
    expect(entitlements.plan).toBe("UNLICENSED");

    const license = await r.resolveLicenseState();
    expect(license.state).toBe("INVALID");
    expect(license.usable).toBe(false);
  });
});
