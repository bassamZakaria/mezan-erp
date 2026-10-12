import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackend, createPlatform, OwnerPinResetOutcome, TenantOwnerAccountNotFoundError, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createTenant, retirePlan, startSubscription, TenantCodeTakenError, TenantStatusCode } from "@mezan/domain";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { provisionTenant, ProvisioningSupersededError, TenantProvisioningError } from "./provision-tenant.js";
import { resetTenantOwnerPin } from "./owner-pin-reset.js";

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

function login(backend: BackendHandle, username: string, pin: string): Promise<Response> {
  return Promise.resolve(
    backend.app.fetch(
      new Request("http://tenant.internal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, pin }),
      }),
    ),
  );
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

  it("leaves the tenant provisioning and rethrows with the tenant id when subscribing fails AFTER seeding and admin creation, and a resumed call completes without a second admin and hands over a fresh PIN", async () => {
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
    expect(resumed.adminPin).toBe("222222");
    expect(resumed.adminEmail).toBe(cmd.ownerEmail);

    const sub = await platform.stores.subscriptions.findLiveByTenant(resumed.tenant.id);
    expect(sub?.planId).toBe("PLAN-BUSINESS");

    expect((await login(backend, cmd.ownerEmail, "111111")).status).toBe(401);
    const signedIn = await login(backend, cmd.ownerEmail, "222222");
    expect(signedIn.status).toBe(200);
    const users = await backend.app.fetch(
      new Request("http://tenant.internal/users", { headers: { authorization: `Bearer ${((await signedIn.json()) as { token: string }).token}` } }),
    );
    const admins = ((await users.json()) as { isCompanyAdmin: boolean; status: string }[]).filter((user) => user.isCompanyAdmin && user.status === "active");
    expect(admins).toHaveLength(1);
  });

  it("does not rotate the PIN of an owner who has already signed in when a provision is resumed", async () => {
    const platform = await newPlatform();
    await retirePlan({ id: "PLAN-CORE" }, platform.stores.plans);
    const router = newRouter(platform);
    const cmd = { code: "signedin", nameAr: "دخلت", ownerEmail: "owner@signedin.example", ownerNameAr: "المدير", planId: "PLAN-CORE", billingCycle: "monthly" as const, trial: false };
    await expect(provisionTenant(cmd, { platform, router, now: () => new Date(T), pinOf: () => "111111" })).rejects.toBeInstanceOf(TenantProvisioningError);
    const backend = await router.backendFor("signedin");
    expect((await login(backend, cmd.ownerEmail, "111111")).status).toBe(200);

    const resumed = await provisionTenant({ ...cmd, planId: "PLAN-BUSINESS" }, { platform, router, now: () => new Date(T), pinOf: () => "222222" });

    expect(resumed.tenant.status).toBe("active");
    expect(resumed.adminPin).toBeNull();
    expect((await login(backend, cmd.ownerEmail, "222222")).status).toBe(401);
    expect((await login(backend, cmd.ownerEmail, "111111")).status).toBe(200);
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

  it("refuses a tenant still being provisioned for a different owner, and leaves it untouched", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const tenant = await createTenant({ id: "t-adopt", code: "adopt", nameAr: "محجوزة", ownerEmail: "first@adopt.example", now: T }, platform.stores.tenants);

    await expect(
      provisionTenant(
        { code: "adopt", nameAr: "محجوزة", ownerEmail: "second@adopt.example", ownerNameAr: "آخر", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
        { platform, router, now: () => new Date(T), pinOf: () => "444444" },
      ),
    ).rejects.toBeInstanceOf(TenantCodeTakenError);

    expect(await platform.stores.tenants.findById(tenant.id)).toEqual(tenant);
    expect(await platform.stores.subscriptions.findLiveByTenant(tenant.id)).toBeNull();
    const backend = await router.backendFor("adopt");
    const status = (await (await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"))).json()) as { claimed: boolean };
    expect(status.claimed).toBe(false);
  });

  it("accepts the recorded owner's email in another letter case", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    await createTenant({ id: "t-case", code: "lettercase", nameAr: "حالة", ownerEmail: "owner@case.example", now: T }, platform.stores.tenants);

    const result = await provisionTenant(
      { code: "lettercase", nameAr: "حالة", ownerEmail: " Owner@Case.Example ", ownerNameAr: "المدير", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T), pinOf: () => "555555" },
    );

    expect(result.tenant.status).toBe("active");
    expect(result.adminPin).toBe("555555");
  });

  it("does not activate a claimed tenant that holds no admin with the owner's email", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const tenant = await createTenant({ id: "t-orphan", code: "orphan", nameAr: "يتيمة", ownerEmail: "owner@orphan.example", now: T }, platform.stores.tenants);
    const backend = await router.backendFor("orphan");
    await backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" }));
    const claimed = await backend.app.fetch(
      new Request("http://tenant.internal/bootstrap/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nameAr: "غريب", email: "someone@else.example", pin: "121212", companyName: "يتيمة" }),
      }),
    );
    expect(claimed.status).toBe(201);

    let thrown: unknown;
    try {
      await provisionTenant(
        { code: "orphan", nameAr: "يتيمة", ownerEmail: "owner@orphan.example", ownerNameAr: "المدير", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
        { platform, router, now: () => new Date(T), pinOf: () => "666666" },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TenantProvisioningError);
    expect((thrown as TenantProvisioningError).cause).toBeInstanceOf(TenantOwnerAccountNotFoundError);
    expect((await platform.stores.tenants.findById(tenant.id))?.status).toBe("provisioning");
    expect(await platform.stores.subscriptions.findLiveByTenant(tenant.id)).toBeNull();
  });

  describe("a contested provisioning claim", () => {
    const cmd = {
      code: "raced", nameAr: "متنازع عليها", ownerEmail: "owner@raced.example", ownerNameAr: "المدير",
      planId: "PLAN-CORE", billingCycle: "monthly" as const, trial: false,
    };

    async function halfProvisioned(firstPin: string) {
      const platform = await newPlatform();
      await retirePlan({ id: "PLAN-CORE" }, platform.stores.plans);
      const router = newRouter(platform);
      await expect(provisionTenant(cmd, { platform, router, now: () => new Date(T), pinOf: () => firstPin })).rejects.toBeInstanceOf(TenantProvisioningError);
      return { platform, router, resume: { ...cmd, planId: "PLAN-BUSINESS" } };
    }

    function lostAtCheck(lostAt: number): () => Promise<boolean> {
      let checks = 0;
      return async () => (checks += 1) < lostAt;
    }

    it("writes no PIN once the claim is lost before the PIN step", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");

      await expect(
        provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", stillOurs: lostAtCheck(1) }),
      ).rejects.toBeInstanceOf(ProvisioningSupersededError);

      const backend = await router.backendFor("raced");
      expect((await platform.stores.tenants.findByCode("raced"))?.status).toBe("provisioning");
      expect((await login(backend, cmd.ownerEmail, "222222")).status).toBe(401);
      expect((await login(backend, cmd.ownerEmail, "111111")).status).toBe(200);
    });

    it("starts no subscription once the claim is lost before the subscription step", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");

      await expect(
        provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", stillOurs: lostAtCheck(2) }),
      ).rejects.toBeInstanceOf(ProvisioningSupersededError);

      const tenant = await platform.stores.tenants.findByCode("raced");
      expect(tenant?.status).toBe("provisioning");
      expect(await platform.stores.subscriptions.findLiveByTenant(tenant?.id ?? "")).toBeNull();
    });

    it("does not activate the tenant once the claim is lost before activation", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");

      await expect(
        provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", stillOurs: lostAtCheck(3) }),
      ).rejects.toBeInstanceOf(ProvisioningSupersededError);

      expect((await platform.stores.tenants.findByCode("raced"))?.status).toBe("provisioning");
    });

    it("does not activate the tenant once the claim is lost after its subscription started", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");

      await expect(
        provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", stillOurs: lostAtCheck(4) }),
      ).rejects.toBeInstanceOf(ProvisioningSupersededError);

      const tenant = await platform.stores.tenants.findByCode("raced");
      expect(tenant?.status).toBe("provisioning");
      expect(await platform.stores.subscriptions.findLiveByTenant(tenant?.id ?? "")).not.toBeNull();
    });

    it("starts no subscription for a tenant that was archived while its provisioner was between steps", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");
      const tenant = await platform.stores.tenants.findByCode("raced");
      if (!tenant) throw new Error("the tenant was not created");
      let checks = 0;
      const archivedMeanwhile = async () => {
        checks += 1;
        if (checks === 2) await platform.stores.tenants.compareAndSetStatus(tenant, { ...tenant, status: TenantStatusCode.Archived, code: "released-raced" });
        return true;
      };

      await expect(
        provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", stillOurs: archivedMeanwhile }),
      ).rejects.toBeInstanceOf(ProvisioningSupersededError);

      expect(await platform.stores.subscriptions.listByTenant(tenant.id)).toEqual([]);
      expect((await platform.stores.tenants.findById(tenant.id))?.status).toBe(TenantStatusCode.Archived);
    });

    it("refuses the PIN of a holder that froze after its last check and was superseded, so every PIN handed out signs in", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");
      const deps = { platform, router, now: () => new Date(T) };
      let winner: Awaited<ReturnType<typeof provisionTenant>> | null = null;
      let frozen = false;
      const freezeWhileAnotherHolderFinishes = async () => {
        if (frozen) return true;
        frozen = true;
        winner = await provisionTenant(resume, { ...deps, pinOf: () => "333333", fence: 2 });
        return true;
      };

      const stale = provisionTenant(resume, { ...deps, pinOf: () => "222222", stillOurs: freezeWhileAnotherHolderFinishes, fence: 1 });

      await expect(stale).rejects.toBeInstanceOf(ProvisioningSupersededError);
      const backend = await router.backendFor("raced");
      expect(winner).toMatchObject({ adminPin: "333333" });
      expect((await login(backend, cmd.ownerEmail, "222222")).status).toBe(401);
      expect((await login(backend, cmd.ownerEmail, "333333")).status).toBe(200);
    });

    it("refuses a signup holder that froze before the console reset the owner's PIN: the console's PIN still signs in", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");
      const staleFence = await platform.stores.signupRequests.takeProvisionFence(T);
      const tenant = await platform.stores.tenants.findByCode("raced");
      if (!tenant) throw new Error("the tenant was not created");

      const issued = await resetTenantOwnerPin({ platform, router, now: () => new Date(T), pinOf: () => "909090" }, { tenant, actorId: "op-1" });
      const stale = provisionTenant(resume, { platform, router, now: () => new Date(T), pinOf: () => "222222", fence: staleFence });

      await expect(stale).rejects.toBeInstanceOf(ProvisioningSupersededError);
      const backend = await router.backendFor("raced");
      expect(issued.adminPin).toBe("909090");
      expect((await login(backend, cmd.ownerEmail, "222222")).status).toBe(401);
      expect((await login(backend, cmd.ownerEmail, "909090")).status).toBe(200);
    });

    it("refuses a signup holder that froze before the console retried the provision: the PIN the console showed still signs in", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");
      const staleFence = await platform.stores.signupRequests.takeProvisionFence(T);

      const retried = await provisionTenant({ ...resume, actorId: "op-1" }, { platform, router, now: () => new Date(T), pinOf: () => "808080" });
      const backend = await router.backendFor("raced");
      const stale = await backend.resetOwnerPin({ email: cmd.ownerEmail, pin: "222222", onlyIfNeverSignedIn: true, actor: "test", fence: staleFence });

      expect(retried.adminPin).toBe("808080");
      expect(stale).toBe(OwnerPinResetOutcome.Superseded);
      expect((await login(backend, cmd.ownerEmail, "222222")).status).toBe(401);
      expect((await login(backend, cmd.ownerEmail, "808080")).status).toBe(200);
    });

    it("hands out fences that only ever rise, across every kind of holder", async () => {
      const platform = await newPlatform();
      const taken = [await platform.stores.signupRequests.takeProvisionFence(T), await platform.stores.signupRequests.takeProvisionFence(T), await platform.stores.signupRequests.takeProvisionFence(T)];

      expect(taken[1]).toBeGreaterThan(taken[0]!);
      expect(taken[2]).toBeGreaterThan(taken[1]!);
    });

    it("lets a later holder write over an earlier one, and an operator's unfenced reset over both", async () => {
      const { platform, router, resume } = await halfProvisioned("111111");
      const backend = await router.backendFor("raced");
      const reset = (pin: string, fence?: number) =>
        backend.resetOwnerPin({ email: cmd.ownerEmail, pin, onlyIfNeverSignedIn: true, actor: "test", ...(fence === undefined ? {} : { fence }) });

      expect(await reset("444444", 5)).toBe(OwnerPinResetOutcome.Reset);
      expect(await reset("555555", 4)).toBe(OwnerPinResetOutcome.Superseded);
      expect(await reset("666666", 5)).toBe(OwnerPinResetOutcome.Reset);
      expect(await reset("777777")).toBe(OwnerPinResetOutcome.Reset);
      expect(await reset("888888", 4)).toBe(OwnerPinResetOutcome.Superseded);
      expect((await login(backend, cmd.ownerEmail, "777777")).status).toBe(200);
      expect(resume.planId).toBe("PLAN-BUSINESS");
    });
  });
});
