import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { createTenant, retirePlan, startSubscription, TenantCodeTakenError } from "@mezan/domain";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { provisionTenant, TenantProvisioningError } from "./provision-tenant.js";

const T = "2026-01-15T00:00:00.000Z";

const platforms: PlatformHandle[] = [];
const dirs: string[] = [];
const routers: TenantRouter[] = [];
afterEach(async () => {
  for (const r of routers.splice(0)) await r.close();
  for (const p of platforms.splice(0)) p.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newRouter(platform: PlatformHandle): TenantRouter {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-provision-"));
  dirs.push(dataDir);
  const router = createTenantRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now: () => new Date(T),
    openBackend: async (_code, _dbPath, resolvers) =>
      createBackend({
        dbPath: ":memory:",
        resolveEntitlements: () => resolvers.resolveEntitlements(),
        resolveLicenseState: () => resolvers.resolveLicenseState(),
      }),
  });
  routers.push(router);
  return router;
}

async function newPlatform(): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: ":memory:" });
  platforms.push(platform);
  return platform;
}

describe("provisionTenant", () => {
  it("creates, seeds, admins, subscribes and activates a brand-new tenant", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);

    const result = await provisionTenant(
      {
        code: "cyag",
        nameAr: "سياج",
        ownerEmail: "owner@cyag.example",
        ownerNameAr: "محمد الشهابي",
        planId: "PLAN-CORE",
        billingCycle: "monthly",
        trial: false,
      },
      { platform, router, now: () => new Date(T), pinOf: () => "654321" },
    );

    expect(result.tenant.code).toBe("cyag");
    expect(result.tenant.status).toBe("active");
    expect(result.adminEmail).toBe("owner@cyag.example");
    expect(result.adminPin).toBe("654321");

    const saved = await platform.stores.tenants.findByCode("cyag");
    expect(saved?.status).toBe("active");

    const sub = await platform.stores.subscriptions.findLiveByTenant(result.tenant.id);
    expect(sub?.planId).toBe("PLAN-CORE");
    expect(sub?.status).toBe("active");

    const backend = await router.backendFor("cyag");
    const loginRes = await backend.app.fetch(
      new Request("http://tenant.internal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "owner@cyag.example", pin: "654321" }),
      }),
    );
    expect(loginRes.status).toBe(200);
    expect(((await loginRes.json()) as { tenantName: string }).tenantName).toBe("سياج");
  });

  it("refuses a code already claimed by a live tenant", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);

    await provisionTenant(
      { code: "nile", nameAr: "النيل", ownerEmail: "owner@nile.example", ownerNameAr: "المدير", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T), pinOf: () => "111111" },
    );

    await expect(
      provisionTenant(
        { code: "nile", nameAr: "النيل الجديدة", ownerEmail: "x@nile.example", ownerNameAr: "س", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
        { platform, router, now: () => new Date(T), pinOf: () => "222222" },
      ),
    ).rejects.toBeInstanceOf(TenantCodeTakenError);
  });

  it("leaves the tenant provisioning and rethrows with the tenant id when subscribing fails AFTER seeding and admin creation, and a resumed call completes without a second admin", async () => {
    const platform = await newPlatform();
    await retirePlan({ id: "PLAN-CORE" }, platform.stores.plans);
    const router = newRouter(platform);

    const cmd = {
      code: "old",
      nameAr: "قديمة",
      ownerEmail: "owner@old.example",
      ownerNameAr: "المدير",
      planId: "PLAN-CORE",
      billingCycle: "monthly" as const,
      trial: false,
    };

    let thrown: unknown;
    try {
      await provisionTenant(cmd, { platform, router, now: () => new Date(T), pinOf: () => "111111" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TenantProvisioningError);
    const failedTenant = await platform.stores.tenants.findByCode("old");
    expect(failedTenant?.status).toBe("provisioning");
    expect((thrown as TenantProvisioningError).tenantId).toBe(failedTenant?.id);

    // Seeding already ran, through the in-process handle.
    const backend = await router.backendFor("old");
    const statusRes = await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"));
    const status = (await statusRes.json()) as Record<string, number | boolean>;
    expect(status["claimed"]).toBe(true);
    expect(Object.values(status).some((v) => typeof v === "number" && v > 0)).toBe(true);

    // The router's public dispatch still refuses a provisioning tenant.
    const dispatchRes = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "old" } }));
    expect(dispatchRes.status).toBe(404);

    const resumed = await provisionTenant(
      { ...cmd, planId: "PLAN-BUSINESS" },
      { platform, router, now: () => new Date(T), pinOf: () => "222222" },
    );
    expect(resumed.tenant.status).toBe("active");
    expect(resumed.tenant.id).toBe(failedTenant?.id);
    expect(resumed.adminPin).toBeNull();
    expect(resumed.adminEmail).toBe(cmd.ownerEmail);

    const sub = await platform.stores.subscriptions.findLiveByTenant(resumed.tenant.id);
    expect(sub?.planId).toBe("PLAN-BUSINESS");

    // No second admin was created — the original PIN still logs the owner in.
    const loginRes = await backend.app.fetch(
      new Request("http://tenant.internal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: cmd.ownerEmail, pin: "111111" }),
      }),
    );
    expect(loginRes.status).toBe(200);
  });

  it("does not re-start a subscription that is already live on a resumed tenant", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);

    const tenant = await createTenant(
      { id: "t-resume", code: "resume", nameAr: "مستأنفة", ownerEmail: "owner@resume.example", now: T },
      platform.stores.tenants,
    );
    await startSubscription(
      { id: "sub-resume", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T },
      platform.stores.subscriptions,
      platform.stores.plans,
    );

    const result = await provisionTenant(
      { code: "resume", nameAr: "مستأنفة", ownerEmail: "owner@resume.example", ownerNameAr: "المدير", planId: "PLAN-BUSINESS", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T), pinOf: () => "333333" },
    );

    expect(result.tenant.status).toBe("active");
    expect(result.adminPin).toBe("333333");
    const subs = await platform.stores.subscriptions.listByTenant(tenant.id);
    expect(subs.length).toBe(1);
    expect(subs[0]?.planId).toBe("PLAN-CORE");
  });
});
