import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatform, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN, type PlatformHandle } from "@mezan/backend";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { reachable } from "./cloud-harness.js";
import { provisionReviewTenant } from "./review-tenant.js";

const REVIEW = { code: "review", pin: "482913" };

function pick(user: Record<string, unknown>): Record<string, unknown> {
  const keys = ["nameAr", "nameEn", "email", "phone", "roleId", "isCompanyAdmin", "employeeId", "branchScope", "warehouseScope", "status", "photoUrl"];
  return Object.fromEntries(keys.map((k) => [k, user[k]]));
}

async function login(router: TenantRouter, username: string, pin: string): Promise<Response> {
  return router.app.fetch(
    new Request("http://ignored/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", [TENANT_HEADER]: REVIEW.code },
      body: JSON.stringify({ username, pin }),
    }),
  );
}

/**
 * Its own file: one real `seedDemoData: true` run per process (see
 * `demo-tenant.test.ts` for why a second one throws NEGATIVE_STOCK).
 */
describe("provisionReviewTenant", () => {
  let platform: PlatformHandle;
  let router: TenantRouter;
  let dataDir: string;

  beforeAll(async () => {
    platform = await createPlatform({ dbPath: ":memory:" });
    dataDir = mkdtempSync(path.join(tmpdir(), "mezan-review-"));
    router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0 });
    reachable(router.app);
    const created = await provisionReviewTenant({ platform, router, env: { platformDir: dataDir, sqliteExclusive: false } }, REVIEW);
    expect(created).toBe(true);
  }, 120000);

  afterAll(async () => {
    await router.close();
    platform.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("is an active tenant under its own code", async () => {
    const tenant = await platform.stores.tenants.findByCode(REVIEW.code);
    expect(tenant?.status).toBe("active");
  });

  it("signs the admin and a linked employee in with the reviewer PIN, and the published PIN opens nothing", async () => {
    expect((await login(router, SEED_ADMIN_EMAIL, REVIEW.pin)).status).toBe(200);
    expect((await login(router, "ahmed.shennawy@cyag.example", REVIEW.pin)).status).toBe(200);
    expect((await login(router, "karim.fouad@cyag.example", SEED_ADMIN_PIN)).status).toBe(401);
  });

  it("serves the seeded dashboard to the reviewer", async () => {
    const session = (await (await login(router, SEED_ADMIN_EMAIL, REVIEW.pin)).json()) as { token: string };
    const summary = await router.app.fetch(
      new Request("http://ignored/dashboard/summary", {
        headers: { authorization: `Bearer ${session.token}`, [TENANT_HEADER]: REVIEW.code },
      }),
    );
    expect(summary.status).toBe(200);
  });

  it("does not re-seed on a second start, and moves a user left on the published PIN back to the reviewer PIN", async () => {
    const session = (await (await login(router, SEED_ADMIN_EMAIL, REVIEW.pin)).json()) as { token: string };
    const headers = { "content-type": "application/json", authorization: `Bearer ${session.token}`, [TENANT_HEADER]: REVIEW.code, "x-branch-scope": "*", "x-warehouse-scope": "*" };
    const users = (await (await router.app.fetch(new Request("http://ignored/users", { headers }))).json()) as Array<Record<string, unknown>>;
    const karim = users.find((u) => u["email"] === "karim.fouad@cyag.example");
    expect(karim).toBeDefined();
    const { id, ...rest } = karim!;
    const reset = await router.app.fetch(
      new Request(`http://ignored/users/${encodeURIComponent(String(id))}`, { method: "PUT", headers, body: JSON.stringify({ ...pick(rest), pin: SEED_ADMIN_PIN }) }),
    );
    expect(reset.status).toBe(200);
    expect((await login(router, "karim.fouad@cyag.example", SEED_ADMIN_PIN)).status).toBe(200);

    const created = await provisionReviewTenant({ platform, router, env: { platformDir: dataDir, sqliteExclusive: false } }, REVIEW);
    expect(created).toBe(false);
    expect((await login(router, "karim.fouad@cyag.example", SEED_ADMIN_PIN)).status).toBe(401);
    expect((await login(router, "karim.fouad@cyag.example", REVIEW.pin)).status).toBe(200);
  });
});
