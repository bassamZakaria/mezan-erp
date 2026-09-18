import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPlatform, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN, takeSeededAdminSecrets, type PlatformHandle } from "@mezan/backend";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { provisionDemoTenant, DEMO_TENANT_CODE } from "./demo-tenant.js";
import { provisionTenant } from "./provision-tenant.js";

/**
 * Its own file so this is the only real `seedDemoData: true` run in this
 * process — see `demo-tenant.test.ts`'s file-level comment for why a second
 * one in the same process throws NEGATIVE_STOCK regardless of what is under
 * test here.
 */
describe("provisionDemoTenant — the demo's pinned admin PIN", () => {
  const platforms: PlatformHandle[] = [];
  const dirs: string[] = [];
  const routers: TenantRouter[] = [];

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const r of routers.splice(0)) await r.close();
    for (const p of platforms.splice(0)) p.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("gives the demo tenant the published PIN in production, and no provisioned tenant inherits it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEZAN_SEED_ADMIN_PIN", undefined);
    vi.stubEnv("MEZAN_SEED_DEMO", "1");

    const platform = await createPlatform({ dbPath: ":memory:" });
    platforms.push(platform);
    const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-demo-pin-"));
    dirs.push(dataDir);
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0 });
    routers.push(router);

    await provisionDemoTenant({ platform, router, env: { platformDir: dataDir, sqliteExclusive: false } });
    expect(takeSeededAdminSecrets()).toEqual(expect.objectContaining({ pin: SEED_ADMIN_PIN, generated: false }));

    const login = (tenantCode: string, pin: string) =>
      router.app.fetch(
        new Request("http://ignored/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: tenantCode },
          body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin }),
        }),
      );

    expect((await login(DEMO_TENANT_CODE, SEED_ADMIN_PIN)).status).toBe(200);

    // The isolation guarantee: the demo's pinned PIN must never reach a real tenant.
    await provisionTenant(
      {
        code: "acme",
        nameAr: "شركة أكمي",
        ownerEmail: "owner@acme.example",
        ownerNameAr: "مالك أكمي",
        planId: "PLAN-ENTERPRISE",
        billingCycle: "yearly",
        trial: false,
      },
      { platform, router, now: () => new Date() },
    );
    expect(takeSeededAdminSecrets()?.generated).toBe(true);
    expect((await login("acme", SEED_ADMIN_PIN)).status).toBe(401);
  }, 60000);
});
