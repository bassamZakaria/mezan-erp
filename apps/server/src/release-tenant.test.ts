import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackend, createPlatform, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { withSqliteTransaction } from "@mezan/persistence";
import {
  activateTenant,
  createTenant,
  InvalidTenantTransitionError,
  SignupRequestStatus,
  startSignup,
  TenantStatusCode,
  verifySignup,
  type Tenant,
} from "@mezan/domain";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, type TenantRouter } from "./tenant-router.js";

const T = "2026-10-12T10:00:00.000Z";
const now = (): Date => new Date(T);

const dirs: string[] = [];
const routers: TenantRouter[] = [];
const platforms: PlatformHandle[] = [];

afterEach(async () => {
  for (const router of routers.splice(0)) await router.close();
  for (const platform of platforms.splice(0)) platform.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function world(): Promise<{ dataDir: string; platform: PlatformHandle }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-release-"));
  dirs.push(dataDir);
  const platform = await createPlatform({ dbPath: path.join(dataDir, "platform.db"), now });
  platforms.push(platform);
  return { dataDir, platform };
}

function gate(): { readonly reached: Promise<void>; readonly opened: Promise<void>; arrive(): void; open(): void } {
  let open = (): void => undefined;
  let arrive = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  return { reached, opened, arrive, open };
}

function databasesIn(dataDir: string): string[] {
  return readdirSync(path.join(dataDir, "tenants"))
    .filter((name) => name.endsWith(".db"))
    .sort();
}

const quietRouter = { evict: async () => undefined, invalidate: () => undefined };

describe("releasing a tenant stuck in provisioning", () => {
  it("never moves or removes the tenant's database, and frees the code", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-stuck", code: "stuck", nameAr: "شركة عالقة", ownerEmail: "o@stuck.example", now: T }, platform.stores.tenants);
    mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
    writeFileSync(path.join(dataDir, tenant.dbFile), "THE BOOKS");
    const before = readdirSync(path.join(dataDir, "tenants"));

    const released = await releaseProvisioningTenant({ platform, router: quietRouter, dataDir, now }, { tenant, actorId: "op-1" });

    expect(released).toMatchObject({ id: tenant.id, status: TenantStatusCode.Archived, code: "released-t-stuck", dbFile: tenant.dbFile });
    expect(readdirSync(path.join(dataDir, "tenants"))).toEqual(before);
    expect(readFileSync(path.join(dataDir, tenant.dbFile), "utf8")).toBe("THE BOOKS");
    expect(await platform.stores.tenants.findByCode("stuck")).toBeNull();
  });

  it("leaves a tenant that activated while the release waited its turn live, with its database and the tenants directory untouched", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-race", code: "racer", nameAr: "شركة السباق", ownerEmail: "o@racer.example", now: T }, platform.stores.tenants);
    mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
    writeFileSync(path.join(dataDir, tenant.dbFile), "THE BOOKS");
    const before = readdirSync(path.join(dataDir, "tenants"));
    const parked = gate();
    const evicted: string[] = [];
    const router = { evict: async (id: string) => void evicted.push(id), invalidate: () => undefined };

    const activating = withSqliteTransaction(
      platform.stores.sqlite,
      async () => {
        parked.arrive();
        await parked.opened;
        await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
      },
      "BEGIN IMMEDIATE",
    );
    await parked.reached;
    const releasing = releaseProvisioningTenant({ platform, router, dataDir, now }, { tenant, actorId: "op-1" });
    const outcome = releasing.then(
      () => "released",
      (err: unknown) => err,
    );
    parked.open();
    await activating;

    expect(await outcome).toBeInstanceOf(InvalidTenantTransitionError);
    const after = await platform.stores.tenants.findById(tenant.id);
    expect(after).toMatchObject({ status: TenantStatusCode.Active, code: "racer", dbFile: tenant.dbFile });
    expect(existsSync(path.join(dataDir, after?.dbFile ?? "missing"))).toBe(true);
    expect(readdirSync(path.join(dataDir, "tenants"))).toEqual(before);
    expect(evicted).toEqual([]);
    expect((await platform.audit.query("security")).filter((row) => row.action === "TENANT_RELEASED")).toEqual([]);
  });

  it("supersedes a provisioner parked before its PIN write: it starts no subscription and no database is created or moved", async () => {
    const { dataDir, platform } = await world();
    const parked = gate();
    let park = true;
    const router = createTenantRouter({
      platform,
      dataDir,
      sweepEveryMs: 0,
      now,
      openBackend: async (_code, dbPath, resolvers) => {
        mkdirSync(path.dirname(dbPath), { recursive: true });
        const backend = await createBackend({
          dbPath,
          resolveEntitlements: () => resolvers.resolveEntitlements(),
          resolveLicenseState: () => resolvers.resolveLicenseState(),
        });
        const fetch = backend.app.fetch.bind(backend.app);
        backend.app.fetch = (async (request: Request, ...rest: []) => {
          if (park && new URL(request.url).pathname === "/bootstrap/admin") {
            park = false;
            parked.arrive();
            await parked.opened;
          }
          return fetch(request, ...rest);
        }) as BackendHandle["app"]["fetch"];
        return backend;
      },
    });
    routers.push(router);
    const claims = platform.stores.signupRequests;
    await startSignup(
      { id: "sr-1", code: "parked", nameAr: "شركة منتظرة", ownerEmail: "o@parked.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", tokenHash: "hash-1", now: T, expiresInMs: 60_000 },
      claims,
      platform.stores.tenants,
      platform.stores.plans,
    );
    const request = await verifySignup("hash-1", claims, T, platform.stores.tenants);
    expect(await claims.tryClaimProvisioning("hash-1", "claim-1", T, "2026-10-12T09:58:00.000Z")).toBe(true);
    const fence = await claims.provisioningFence("hash-1", "claim-1");

    const provisioning = provisionTenant(
      { code: request.code, nameAr: request.nameAr, ownerEmail: request.ownerEmail, ownerNameAr: request.ownerNameAr, planId: request.planId, billingCycle: request.billingCycle, trial: true },
      { platform, router, now, stillOurs: () => claims.renewProvisioning("hash-1", "claim-1", T), fence: fence ?? 0 },
    ).then(
      () => "provisioned",
      (err: unknown) => (err as Error).name,
    );
    await parked.reached;
    const tenant = (await platform.stores.tenants.findByCode("parked")) as Tenant;
    const before = databasesIn(dataDir);
    expect(before).toEqual([`${tenant.id}.db`]);

    const released = await releaseProvisioningTenant({ platform, router, dataDir, now }, { tenant, actorId: "op-1" });
    parked.open();

    expect(released.status).toBe(TenantStatusCode.Archived);
    expect(await provisioning).toBe("ProvisioningSupersededError");
    expect(await claims.provisioningClaimedAt("hash-1")).toBeNull();
    expect((await claims.findByTokenHash("hash-1"))?.status).toBe(SignupRequestStatus.Released);
    expect(await platform.stores.subscriptions.listByTenant(tenant.id)).toEqual([]);
    expect(await platform.stores.tenants.findById(tenant.id)).toMatchObject({ status: TenantStatusCode.Archived, code: `released-${tenant.id}` });
    expect(databasesIn(dataDir)).toEqual(before);
  });
});
