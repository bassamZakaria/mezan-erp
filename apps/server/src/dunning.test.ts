import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import { activateTenant, archiveTenant, cancelSubscription, createTenant, startSubscription, suspendSubscription } from "@mezan/domain";
import { drainForeignWrites } from "@mezan/persistence";
import { runDunningSweep, startDunningTimer } from "./dunning.js";

const T = "2026-01-15T00:00:00.000Z";
const PAST_END = "2026-03-01T00:00:00.000Z";

const platforms: PlatformHandle[] = [];
afterEach(() => {
  for (const p of platforms.splice(0)) p.close();
});

async function newPlatform(): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: ":memory:" });
  platforms.push(platform);
  return platform;
}

describe("runDunningSweep", () => {
  it("marks an active subscription past its period end as past_due and returns the count", async () => {
    const platform = await newPlatform();
    const expired = await createTenant({ id: "t-expired", code: "expired", nameAr: "منتهية", ownerEmail: "a@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: expired.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-expired", tenantId: expired.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    const laterStart = "2026-02-25T00:00:00.000Z";
    const fresh = await createTenant({ id: "t-fresh", code: "fresh", nameAr: "حديثة", ownerEmail: "b@x.example", now: laterStart }, platform.stores.tenants);
    await activateTenant({ id: fresh.id, now: laterStart }, platform.stores.tenants);
    await startSubscription({ id: "sub-fresh", tenantId: fresh.id, planId: "PLAN-CORE", billingCycle: "monthly", now: laterStart }, platform.stores.subscriptions, platform.stores.plans);

    const result = await runDunningSweep(platform, () => new Date(PAST_END));

    expect(result).toEqual({ marked: 1, failed: 0, landedOnFree: 0 });
    const expiredSub = await platform.stores.subscriptions.findById("sub-expired");
    expect(expiredSub?.status).toBe("past_due");
    const freshSub = await platform.stores.subscriptions.findById("sub-fresh");
    expect(freshSub?.status).toBe("active");
  });

  it("waits for a transaction another operation has open instead of writing into it", async () => {
    const platform = await newPlatform();
    const expired = await createTenant({ id: "t-expired", code: "expired", nameAr: "منتهية", ownerEmail: "a@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: expired.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-expired", tenantId: expired.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const settling = platform.audit.atomic!(async () => {
      begin();
      await finished;
      throw new Error("the settlement rolls back");
    }).catch(() => undefined);
    await begun;

    const sweeping = runDunningSweep(platform, () => new Date(PAST_END));
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish();
    await settling;

    expect(await sweeping).toEqual({ marked: 1, failed: 0, landedOnFree: 0 });
    expect((await platform.stores.subscriptions.findById("sub-expired"))?.status).toBe("past_due");
    expect(drainForeignWrites()).toEqual([]);
  });

  it("lands an ended trial on Free, and leaves a suspended or cancelled subscription alone", async () => {
    const platform = await newPlatform();

    const trialing = await createTenant({ id: "t-trial", code: "trial", nameAr: "تجريبية", ownerEmail: "c@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: trialing.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-trial", tenantId: trialing.id, planId: "PLAN-CORE", billingCycle: "monthly", trial: true, now: T }, platform.stores.subscriptions, platform.stores.plans);

    const suspended = await createTenant({ id: "t-susp", code: "susp", nameAr: "موقوفة", ownerEmail: "d@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: suspended.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-susp", tenantId: suspended.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
    await suspendSubscription({ id: "sub-susp", now: T }, platform.stores.subscriptions);

    const cancelled = await createTenant({ id: "t-cancel", code: "cancel", nameAr: "ملغاة", ownerEmail: "e@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: cancelled.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-cancel", tenantId: cancelled.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
    await cancelSubscription({ id: "sub-cancel", now: T }, platform.stores.subscriptions);

    const result = await runDunningSweep(platform, () => new Date(PAST_END));

    // DEC-31: a trial whose 14 days ran out is not "left alone" — it lands on
    // the Free plan, active and writable. It is never dunned, because there is
    // nothing owed; `marked` stays 0 and `landedOnFree` counts it instead.
    expect(result).toEqual({ marked: 0, failed: 0, landedOnFree: 1 });
    const landed = await platform.stores.subscriptions.findById("sub-trial");
    expect(landed?.status).toBe("active");
    expect(landed?.planId).toBe("PLAN-FREE");
    // And the plan it came from is remembered, so every module it just lost
    // stays readable rather than going 403.
    expect(landed?.previousPlanId).toBe("PLAN-CORE");
    expect((await platform.stores.subscriptions.findById("sub-susp"))?.status).toBe("suspended");
    expect((await platform.stores.subscriptions.findById("sub-cancel"))?.status).toBe("cancelled");
  });

  it("leaves an active subscription still within its period alone", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant({ id: "t-live", code: "live", nameAr: "حية", ownerEmail: "f@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-live", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    const result = await runDunningSweep(platform, () => new Date(T));

    expect(result).toEqual({ marked: 0, failed: 0, landedOnFree: 0 });
    expect((await platform.stores.subscriptions.findById("sub-live"))?.status).toBe("active");
  });

  it("skips a tenant with no subscription at all", async () => {
    const platform = await newPlatform();
    await createTenant({ id: "t-none", code: "none", nameAr: "بلا اشتراك", ownerEmail: "g@x.example", now: T }, platform.stores.tenants);

    const result = await runDunningSweep(platform, () => new Date(PAST_END));

    expect(result).toEqual({ marked: 0, failed: 0, landedOnFree: 0 });
  });

  it("skips an archived tenant even if its subscription still reads active and past its period", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant({ id: "t-arch", code: "arch", nameAr: "مؤرشفة", ownerEmail: "j@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-arch", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
    await archiveTenant({ id: tenant.id, now: T }, platform.stores.tenants);

    const result = await runDunningSweep(platform, () => new Date(PAST_END));

    expect(result).toEqual({ marked: 0, failed: 0, landedOnFree: 0 });
    expect((await platform.stores.subscriptions.findById("sub-arch"))?.status).toBe("active");
  });

  it("does not let one subscription's failure abort the sweep", async () => {
    const platform = await newPlatform();

    const bad = await createTenant({ id: "t-bad", code: "bad", nameAr: "سيئة", ownerEmail: "k@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: bad.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-bad", tenantId: bad.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    const good = await createTenant({ id: "t-good", code: "good", nameAr: "جيدة", ownerEmail: "l@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: good.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-good", tenantId: good.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    const originalSave = platform.stores.subscriptions.save.bind(platform.stores.subscriptions);
    platform.stores.subscriptions.save = async (s) => {
      if (s.id === "sub-bad" && s.status === "past_due") throw new Error("boom");
      return originalSave(s);
    };

    const result = await runDunningSweep(platform, () => new Date(PAST_END));

    expect(result).toEqual({ marked: 1, failed: 1, landedOnFree: 0 });
    expect((await platform.stores.subscriptions.findById("sub-bad"))?.status).toBe("active");
    expect((await platform.stores.subscriptions.findById("sub-good"))?.status).toBe("past_due");
  });
});

describe("startDunningTimer", () => {
  it("sweeps once immediately without waiting for the interval", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant({ id: "t-imm", code: "imm", nameAr: "فورية", ownerEmail: "h@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-imm", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    const timer = startDunningTimer(platform, { now: () => new Date(PAST_END), intervalMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await platform.stores.subscriptions.findById("sub-imm"))?.status).toBe("past_due");
    timer.stop();
  });

  it("sweeps again after the injected interval elapses, and stop() ends further sweeps", async () => {
    vi.useFakeTimers();
    try {
      const platform = await newPlatform();
      const tenant = await createTenant({ id: "t-tick", code: "tick", nameAr: "دورية", ownerEmail: "i@x.example", now: T }, platform.stores.tenants);
      await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
      await startSubscription({ id: "sub-tick", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

      let clock = new Date(T).getTime();
      const timer = startDunningTimer(platform, { now: () => new Date(clock), intervalMs: 10 });
      await vi.advanceTimersByTimeAsync(0);
      expect((await platform.stores.subscriptions.findById("sub-tick"))?.status).toBe("active");

      clock = new Date(PAST_END).getTime();
      await vi.advanceTimersByTimeAsync(10);
      expect((await platform.stores.subscriptions.findById("sub-tick"))?.status).toBe("past_due");

      timer.stop();
      const renewed = await platform.stores.subscriptions.findById("sub-tick");
      await platform.stores.subscriptions.save({ ...renewed!, status: "active" });
      await vi.advanceTimersByTimeAsync(100);
      expect((await platform.stores.subscriptions.findById("sub-tick"))?.status).toBe("active");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unrefs its timer so it never keeps the process alive on its own", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const timer = startDunningTimer({ stores: { tenants: { list: async () => [] } } } as unknown as PlatformHandle, { intervalMs: 60_000 });
    const created = setIntervalSpy.mock.results[setIntervalSpy.mock.results.length - 1]?.value as NodeJS.Timeout;
    expect(created.hasRef()).toBe(false);
    timer.stop();
    setIntervalSpy.mockRestore();
  });
});
