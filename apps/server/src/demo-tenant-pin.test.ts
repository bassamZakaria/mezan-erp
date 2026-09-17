import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPlatform, SEED_ADMIN_EMAIL, type PlatformHandle } from "@mezan/backend";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { provisionDemoTenant, DEMO_TENANT_CODE } from "./demo-tenant.js";

/**
 * Its own file so this is the only real `seedDemoData: true` run in this
 * process — see `demo-tenant.test.ts`'s file-level comment for why a second
 * one in the same process throws NEGATIVE_STOCK regardless of what is under
 * test here.
 */
describe("provisionDemoTenant — MEZAN_SEED_ADMIN_PIN", () => {
  const platforms: PlatformHandle[] = [];
  const dirs: string[] = [];
  const routers: TenantRouter[] = [];

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const r of routers.splice(0)) await r.close();
    for (const p of platforms.splice(0)) p.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("seeds the demo tenant's admin with the overridden PIN, not the published default", async () => {
    vi.stubEnv("MEZAN_SEED_ADMIN_PIN", "222222");

    const platform = await createPlatform({ dbPath: ":memory:" });
    platforms.push(platform);
    const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-demo-pin-"));
    dirs.push(dataDir);
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0 });
    routers.push(router);

    await provisionDemoTenant({ platform, router, env: { platformDir: dataDir, sqliteExclusive: false } });

    const login = (pin: string) =>
      router.app.fetch(
        new Request("http://ignored/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: DEMO_TENANT_CODE },
          body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin }),
        }),
      );

    expect((await login("222222")).status).toBe(200);
    expect((await login("123456")).status).toBe(401);
  }, 60000);
});
