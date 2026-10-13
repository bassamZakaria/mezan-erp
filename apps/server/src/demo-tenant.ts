import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createTenant, activateTenant, startModuleTrial, startSubscription } from "@mezan/domain";
import { createBackend, SEED_ADMIN_PIN, type BackendHandle, type PlatformHandle } from "@mezan/backend";
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
 * BEFORE the tenant router ever caches it, and the fallback seed admin
 * `admin@cyag.example` stays active as the demo's login. The tenant +
 * subscription are created first so the resolvers this backend opens with
 * already see the enterprise plan's full entitlements.
 *
 * The admin's PIN is pinned HERE, to the published `123456`, for this tenant
 * only — never through the process-wide `MEZAN_SEED_ADMIN_PIN`, which would
 * reach every tenant the platform console provisions (cloud.ts refuses it).
 * A generated PIN is unusable on the demo: the free instance re-seeds from
 * scratch on every wake, so it would change each time; and the ~20 demo
 * personas in `demo-seed/access.ts`, a second company admin among them, all
 * share `123456` anyway. The real gate in front of this tenant is the
 * `MEZAN_DEMO_PASSWORD` basic auth that cloud.ts requires whenever the demo is
 * seeded.
 */
export async function provisionDemoTenant(deps: ProvisionDemoTenantDeps): Promise<void> {
  const created = await provisionSeededTenant(deps, {
    code: DEMO_TENANT_CODE,
    nameAr: DEMO_NAME_AR,
    adminPin: SEED_ADMIN_PIN,
  });
  if (!created) return;
  // DEC-31 — the billing screen's module section has to show something real.
  // POS is the one module the enterprise plan leaves out, so a live trial on it
  // is the only way the demo can show «تجربة جارية» without inventing data.
  const tenant = await deps.platform.stores.tenants.findByCode(DEMO_TENANT_CODE);
  if (!tenant) return;
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  await startModuleTrial(
    {
      id: randomUUID(),
      tenantId: tenant.id,
      module: "pos",
      startedBy: "seed",
      entitledModules: [],
      now: nowIso,
    },
    deps.platform.stores.moduleTrials,
  );
  deps.router.invalidate(DEMO_TENANT_CODE);
}

export interface SeededTenantSpec {
  readonly code: string;
  readonly nameAr: string;
  readonly adminPin: string;
  readonly afterSeed?: (backend: BackendHandle) => Promise<void>;
}

/** Returns false when a tenant with `spec.code` already exists and nothing was done. */
export async function provisionSeededTenant(deps: ProvisionDemoTenantDeps, spec: SeededTenantSpec): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  if (await deps.platform.stores.tenants.findByCode(spec.code)) return false;

  const nowIso = now().toISOString();
  const tenant = await createTenant(
    {
      id: randomUUID(),
      code: spec.code,
      nameAr: spec.nameAr,
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
  const resolvers = createTenantResolvers(deps.platform, spec.code, { now });
  const backend = await createBackend({
    dbPath,
    connection: { exclusive: deps.env.sqliteExclusive },
    tenantBinding: activated.id,
    seedDemoData: true,
    seedAdminPin: spec.adminPin,
    resolveEntitlements: () => resolvers.resolveEntitlements(),
    resolveLicenseState: () => resolvers.resolveLicenseState(),
  });
  // The seed's confirms queue their e-receipts on detached tasks that park a
  // beat to let the confirm route win; closing on top of them left ten of the
  // demo tenant's consumer receipts unqueued behind a swallowed "database
  // connection is not open", in a database this process then hands to the
  // router.
  try {
    await backend.drain();
    await spec.afterSeed?.(backend);
    await backend.drain();
  } finally {
    backend.close();
  }
  return true;
}
