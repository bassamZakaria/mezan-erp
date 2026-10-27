import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackend, createPlatform, PlatformAuditUnavailableError, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { withSqliteTransaction } from "@mezan/persistence";
import {
  activateTenant,
  archiveTenant,
  createTenant,
  InvalidTenantTransitionError,
  SignupRequestStatus,
  startSignup,
  TenantStatusCode,
  verifySignup,
  type Tenant,
} from "@mezan/domain";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { createTenantPurge, TENANT_DATA_PURGED_AUDIT, TENANT_PURGE_SYSTEM_ACTOR, TenantNotTerminatedError, TenantPurgeTrigger } from "./tenant-purge.js";
import { tenantBackupFolder } from "./backup-scheduler.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, type TenantRouter, type TenantRouterOptions } from "./tenant-router.js";
import { reachable } from "./cloud-harness.js";

function reachableRouter(options: TenantRouterOptions): TenantRouter {
  const router = createTenantRouter(options);
  reachable(router.app);
  return router;
}

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

  it("releases nothing when the platform audit cannot record it: the tenant stays provisioning under its own code", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-audit", code: "audited", nameAr: "شركة", ownerEmail: "o@audited.example", now: T }, platform.stores.tenants);
    const audit = Object.create(platform.audit) as PlatformHandle["audit"];
    audit.append = async () => {
      throw new Error("the platform audit refused the row");
    };

    const refused = await releaseProvisioningTenant({ platform: { ...platform, audit }, router: quietRouter, dataDir, now }, { tenant, actorId: "op-1" }).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(PlatformAuditUnavailableError);
    expect(await platform.stores.tenants.findById(tenant.id)).toMatchObject({ code: "audited", status: TenantStatusCode.Provisioning });
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
      platform.stores.sqlite!,
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
    const router = reachableRouter({
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

describe("deleting a terminated tenant's data after the retention period", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function terminatedWorld() {
    const { dataDir, platform } = await world();
    let clock = Date.parse(T);
    const evicted: string[] = [];
    const exportsDiscarded: string[] = [];
    const anchorDir = path.join(dataDir, "audit-anchors");
    const purge = createTenantPurge({
      platform,
      router: { evict: async (id) => void evicted.push(id), invalidate: () => undefined },
      dataDir,
      retentionDays: 90,
      localAnchorDir: anchorDir,
      discardExports: (id) => exportsDiscarded.push(id),
      now: () => new Date(clock),
    });
    const created = await createTenant({ id: "t-gone", code: "gone", nameAr: "شركة منتهية", ownerEmail: "o@gone.example", now: T }, platform.stores.tenants);
    const tenant = await activateTenant({ id: created.id, now: T }, platform.stores.tenants);
    mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) writeFileSync(path.join(dataDir, `${tenant.dbFile}${suffix}`), "THE BOOKS");
    mkdirSync(tenantBackupFolder(dataDir, tenant.id), { recursive: true });
    writeFileSync(path.join(tenantBackupFolder(dataDir, tenant.id), "2026-10-13T00-00-00-000Z.sqlite"), "A BACKUP");
    mkdirSync(path.join(dataDir, "backups", "gone"), { recursive: true });
    writeFileSync(path.join(dataDir, "backups", "gone", "2026-10-14T00-00-00-000Z.sqlite"), "A LEGACY BACKUP");
    writeFileSync(path.join(dataDir, "backups", "gone", "2020-01-01T00-00-00-000Z.sqlite"), "AN EARLIER HOLDER'S BACKUP");
    mkdirSync(anchorDir, { recursive: true });
    writeFileSync(path.join(anchorDir, `${tenant.id}.jsonl`), "{}\n");
    return { dataDir, platform, purge, tenant, evicted, exportsDiscarded, advance: (days: number) => (clock += days * DAY), anchorDir };
  }

  it("never touches an active tenant, and refuses to purge one outright", async () => {
    const { dataDir, purge, tenant } = await terminatedWorld();
    expect(await purge.sweep()).toEqual({ scheduled: 0, purged: 0, failed: 0 });
    await expect(purge.purge(tenant, { actor: "x", reason: "a test of the refusal", trigger: TenantPurgeTrigger.Owner })).rejects.toBeInstanceOf(TenantNotTerminatedError);
    expect(existsSync(path.join(dataDir, tenant.dbFile))).toBe(true);
  });

  it("schedules the deletion at archive, waits out the period and its extension, then deletes every local copy, leaves a tombstone and an audit row, and does it once", async () => {
    const { dataDir, platform, purge, tenant, evicted, exportsDiscarded, advance, anchorDir } = await terminatedWorld();
    const archived = await archiveTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    await purge.scheduleOnArchive(archived, T);
    expect((await purge.view(archived)).retention?.deleteAfter).toBe(new Date(Date.parse(T) + 90 * DAY).toISOString());

    advance(89);
    expect(await purge.sweep()).toMatchObject({ purged: 0 });
    expect(await purge.extend({ tenant: archived, deleteAfter: "2027-02-01T00:00:00.000Z", reason: "the owner asked for more time to export", actorId: "op-1", at: T })).toBe(true);
    expect(await purge.extend({ tenant: archived, deleteAfter: "2027-01-01T00:00:00.000Z", reason: "an earlier date is refused", actorId: "op-1", at: T })).toBe(false);
    advance(2);
    expect(await purge.sweep()).toMatchObject({ purged: 0 });
    expect(existsSync(path.join(dataDir, tenant.dbFile))).toBe(true);

    advance(30);
    expect(await purge.sweep()).toEqual({ scheduled: 0, purged: 1, failed: 0 });
    for (const suffix of ["", "-wal", "-shm"]) expect(existsSync(path.join(dataDir, `${tenant.dbFile}${suffix}`))).toBe(false);
    expect(existsSync(tenantBackupFolder(dataDir, tenant.id))).toBe(false);
    expect(readdirSync(path.join(dataDir, "backups", "gone"))).toEqual(["2020-01-01T00-00-00-000Z.sqlite"]);
    expect(existsSync(path.join(anchorDir, `${tenant.id}.jsonl`))).toBe(false);
    expect(evicted).toEqual([tenant.id]);
    expect(exportsDiscarded).toEqual([tenant.id]);
    expect(await platform.stores.tenants.findById(tenant.id)).toBeNull();
    const tombstone = platform.stores.sqlite!.prepare("SELECT * FROM tenant_tombstone").all();
    expect(tombstone).toEqual([{ id: tenant.id, code: "gone", deleted_at: expect.any(String) }]);
    const row = (await platform.audit.query("security")).find((r) => r.action === TENANT_DATA_PURGED_AUDIT);
    expect(row).toMatchObject({ severity: "CRITICAL", actor: TENANT_PURGE_SYSTEM_ACTOR, entityId: tenant.id });

    expect(await purge.sweep()).toEqual({ scheduled: 0, purged: 0, failed: 0 });
    expect((await purge.purge(archived, { actor: "x", reason: "a second call is a no-op", trigger: TenantPurgeTrigger.Owner })).removed).toEqual([]);
  });

  it("starts the clock for a tenant archived before the schedule existed the first time it is seen, never backdated", async () => {
    const { platform, purge, tenant, advance } = await terminatedWorld();
    const archived = await archiveTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    advance(400);
    expect(await purge.sweep()).toEqual({ scheduled: 1, purged: 0, failed: 0 });
    expect(Date.parse((await purge.view(archived)).retention!.deleteAfter) - Date.parse(T)).toBe(490 * DAY);
  });
});
