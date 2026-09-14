import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createTenant, activateTenant, startSubscription } from "@mezan/domain";
import { createBackend, type PlatformHandle } from "@mezan/backend";
import { createTenantResolvers } from "./tenant-entitlements.js";
import { tenantDbPath, type TenantRouter } from "./tenant-router.js";
import type { CloudEnv } from "./env.js";

export const DEMO_TENANT_CODE = "demo";
const DEMO_NAME_AR = "شركة سياج التجريبية";
/** The seeded plan's fixed id (`packages/backend/src/create-platform.ts`'s `PLATFORM_SEED_PLANS`), not its `code`. */
const DEMO_PLAN_ID = "PLAN-ENTERPRISE";

export interface ProvisionDemoTenantDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly env: Pick<CloudEnv, "platformDir" | "sqliteExclusive">;
  readonly now?: () => Date;
}

/**
 * Provisions the seeded demo tenant, once.
 *
 * The demo's owner is `admin@cyag.example` — the SAME identity every empty
 * tenant's bootstrap already creates, named «محمد الشهابي»
 * (`packages/backend/src/seed.ts`'s `SEED_ADMIN_EMAIL`/`SEED_ADMIN_NAME`), so
 * `POST /bootstrap/admin` (the path `provisionTenant` uses for a real signup)
 * would 409 on the duplicate email. The demo is not "claimed" through that
 * route at all: its backend is opened directly, with `seedDemoData: true`,
 * BEFORE the tenant router ever caches it, and the fallback seed admin —
 * already known everywhere else in this repo as `admin@cyag.example` / PIN
 * `123456` — stays active as the demo's login. The tenant + subscription are
 * created first so the resolvers this backend opens with already see the
 * enterprise plan's full entitlements.
 */
export async function provisionDemoTenant(deps: ProvisionDemoTenantDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  if (await deps.platform.stores.tenants.findByCode(DEMO_TENANT_CODE)) return;

  const nowIso = now().toISOString();
  const tenant = await createTenant(
    {
      id: randomUUID(),
      code: DEMO_TENANT_CODE,
      nameAr: DEMO_NAME_AR,
      ownerEmail: "admin@cyag.example",
      now: nowIso,
    },
    deps.platform.stores.tenants,
  );
  await startSubscription(
    {
      id: randomUUID(),
      tenantId: tenant.id,
      planId: DEMO_PLAN_ID,
      billingCycle: "yearly",
      trial: false,
      now: nowIso,
    },
    deps.platform.stores.subscriptions,
    deps.platform.stores.plans,
  );
  const activated = await activateTenant({ id: tenant.id, now: nowIso }, deps.platform.stores.tenants);

  const dbPath = tenantDbPath(deps.env.platformDir, activated.dbFile);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const resolvers = createTenantResolvers(deps.platform, DEMO_TENANT_CODE, { now });
  const backend = await createBackend({
    dbPath,
    connection: { exclusive: deps.env.sqliteExclusive },
    seedDemoData: true,
    resolveEntitlements: () => resolvers.resolveEntitlements(),
    resolveLicenseState: () => resolvers.resolveLicenseState(),
  });
  backend.close();
}
