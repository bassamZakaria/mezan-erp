import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatform, SEED_ADMIN_EMAIL, type PlatformHandle } from "@mezan/backend";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { provisionDemoTenant, DEMO_TENANT_CODE } from "./demo-tenant.js";

const T = "2026-01-15T00:00:00.000Z";

/**
 * ONE real seed for the whole file: `demo-seed/history.ts` tracks running
 * stock in a module-level `onHand` map that is never reset between calls, so
 * a second `seedDemoData: true` run in the SAME process double-counts and
 * throws NEGATIVE_STOCK — a pre-existing property of that fixture script, not
 * of `provisionDemoTenant`. `demo-tenant-pin.test.ts` carries the one
 * assertion that genuinely needs its own seed, in its own file/process.
 */
describe("provisionDemoTenant", () => {
  let platform: PlatformHandle;
  let router: TenantRouter;
  let dataDir: string;
  let env: { platformDir: string; sqliteExclusive: boolean };

  beforeAll(async () => {
    platform = await createPlatform({ dbPath: ":memory:" });
    dataDir = mkdtempSync(path.join(tmpdir(), "mezan-demo-"));
    router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    env = { platformDir: dataDir, sqliteExclusive: false };
    await provisionDemoTenant({ platform, router, env });
  }, 60000);

  afterAll(async () => {
    await router.close();
    platform.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("is active on the enterprise plan, owned by the seed admin", async () => {
    const tenant = await platform.stores.tenants.findByCode(DEMO_TENANT_CODE);
    expect(tenant?.status).toBe("active");
    expect(tenant?.ownerEmail).toBe(SEED_ADMIN_EMAIL);
    expect(tenant?.nameAr).toBe("شركة سياج التجريبية");

    const sub = await platform.stores.subscriptions.findLiveByTenant(tenant!.id);
    expect(sub?.billingCycle).toBe("yearly");
    expect(sub?.trialEndsAt).toBeNull();
    const plan = await platform.stores.plans.findById(sub!.planId);
    expect(plan?.code).toBe("enterprise");
  });

  it("logs the seed admin in and answers the dashboard summary through the router", async () => {
    const loginRes = await router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: DEMO_TENANT_CODE },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: "123456" }),
      }),
    );
    expect(loginRes.status).toBe(200);
    const session = (await loginRes.json()) as { token: string };

    const summaryRes = await router.app.fetch(
      new Request("http://ignored/dashboard/summary", {
        headers: { authorization: `Bearer ${session.token}`, [TENANT_HEADER]: DEMO_TENANT_CODE },
      }),
    );
    expect(summaryRes.status).toBe(200);
  });

  it("starts the POS trial before it seeds, so the module on trial has tills to open", async () => {
    const tenant = await platform.stores.tenants.findByCode(DEMO_TENANT_CODE);
    const trials = await platform.stores.moduleTrials.listByTenant(tenant!.id);
    expect(trials.map((t) => t.module)).toEqual(["pos"]);

    const loginRes = await router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: DEMO_TENANT_CODE },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: "123456" }),
      }),
    );
    const session = (await loginRes.json()) as { token: string };
    const terminalsRes = await router.app.fetch(
      new Request("http://ignored/pos/terminals", {
        headers: { authorization: `Bearer ${session.token}`, [TENANT_HEADER]: DEMO_TENANT_CODE },
      }),
    );
    expect(terminalsRes.status).toBe(200);
    const terminals = (await terminalsRes.json()) as { code: string }[];
    expect(terminals.map((t) => t.code).sort()).toEqual(["POS-001", "POS-002", "POS-003"]);
  });

  it("does nothing on a second call", async () => {
    const before = await platform.stores.tenants.findByCode(DEMO_TENANT_CODE);

    await provisionDemoTenant({ platform, router, env });

    const after = await platform.stores.tenants.findByCode(DEMO_TENANT_CODE);
    expect(after).toEqual(before);
    const subs = await platform.stores.subscriptions.listByTenant(before!.id);
    expect(subs).toHaveLength(1);
  });
});
