import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { activateTenant, createTenant, TenantStatusCode } from "@mezan/domain";
import { bindTenantDatabase, openSqliteConnection } from "@mezan/persistence";
import { createTenantRouter, type TenantRouter } from "./tenant-router.js";
import { createBackupScheduler, runBackups, startBackupTimer } from "./backup-scheduler.js";
import { BackupVerifyOutcome, type BackupVerifyRecord } from "./backup-verify-core.js";
import { TenantDbFileDisownedError } from "./tenant-db-file.js";
import { verifyBackupFile } from "./backup-verify-core.js";

const T = "2026-01-15T00:00:00.000Z";

const platforms: PlatformHandle[] = [];
const routers: TenantRouter[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const r of routers.splice(0)) await r.close();
  for (const p of platforms.splice(0)) p.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function newPlatform(): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: ":memory:", now: () => new Date(T) });
  platforms.push(platform);
  return platform;
}

const dataDirs = new WeakMap<TenantRouter, string>();

function newRouter(platform: PlatformHandle, now: () => Date = () => new Date(T)): TenantRouter {
  const dataDir = tempDir("mezan-backup-router-");
  const router = createTenantRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now,
    openBackend: () => createBackend({ dbPath: ":memory:" }),
  });
  routers.push(router);
  dataDirs.set(router, dataDir);
  return router;
}

async function openServed(router: TenantRouter, platform: PlatformHandle, code: string) {
  const tenant = await platform.stores.tenants.findByCode(code);
  const file = path.join(dataDirs.get(router)!, tenant!.dbFile);
  mkdirSync(path.dirname(file), { recursive: true });
  const { sqlite } = openSqliteConnection(file);
  bindTenantDatabase(sqlite, tenant!.id);
  sqlite.close();
  return router.backendFor(code);
}

async function seedTenant(platform: PlatformHandle, code: string): Promise<void> {
  const tenant = await createTenant(
    { id: `t-${code}`, code, nameAr: code, ownerEmail: `${code}@x.example`, now: T },
    platform.stores.tenants,
  );
  await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
}

function assertOpenableSqlite(file: string): void {
  const { sqlite } = openSqliteConnection(file);
  try {
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
  } finally {
    sqlite.close();
  }
}

function countFiles(dir: string): number {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

async function pollUntil(predicate: () => boolean, timeoutMs = 5_000, intervalMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("pollUntil: condition not met before deadline");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("runBackups", () => {
  it("writes the platform backup and one backup per OPEN tenant in a folder named by the tenant id, skipping a tenant never opened", async () => {
    const platform = await newPlatform();
    await seedTenant(platform, "cyag");
    await seedTenant(platform, "nile");
    const router = newRouter(platform);
    await openServed(router, platform, "cyag");

    const dir = tempDir("mezan-backup-dir-");
    await runBackups({ platform, router, dir, now: () => new Date(T) });

    const stamp = "2026-01-15T00-00-00.000Z";
    const platformFile = path.join(dir, "backups", "platform", `${stamp}.sqlite`);
    const cyagFile = path.join(dir, "backups", "tenants", "t-cyag", `${stamp}.sqlite`);

    expect(existsSync(platformFile)).toBe(true);
    expect(existsSync(cyagFile)).toBe(true);
    expect(readdirSync(path.join(dir, "backups")).sort()).toEqual(["platform", "tenants"]);
    expect(readdirSync(path.join(dir, "backups", "tenants"))).toEqual(["t-cyag"]);

    assertOpenableSqlite(platformFile);
    assertOpenableSqlite(cyagFile);

    const { sqlite: platformCopy } = openSqliteConnection(platformFile);
    const plan = platformCopy.prepare("SELECT code FROM plan WHERE code = ?").get("core") as { code: string } | undefined;
    expect(plan?.code).toBe("core");
    platformCopy.close();

    const { sqlite: tenantCopy } = openSqliteConnection(cyagFile);
    const tables = tenantCopy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account'").all();
    expect(tables).toHaveLength(1);
    tenantCopy.close();
  });

  describe("when one open tenant cannot be backed up", () => {
    async function threeOpen(): Promise<{ platform: PlatformHandle; router: TenantRouter }> {
      const platform = await newPlatform();
      const router = newRouter(platform);
      for (const code of ["alpha", "beta", "gamma"]) {
        await seedTenant(platform, code);
        await openServed(router, platform, code);
      }
      return { platform, router };
    }

    const failingFor = (router: TenantRouter, tenantId: string, failure: Error): TenantRouter => ({
      ...router,
      openBackendOf: async (id) => {
        if (id === tenantId) throw failure;
        return router.openBackendOf(id);
      },
    });

    const backedUp = (dir: string): string[] => readdirSync(path.join(dir, "backups", "tenants")).sort();

    it("does not fail the run for a tenant that closed while it was being backed up", async () => {
      const { platform, router } = await threeOpen();
      const dir = tempDir("mezan-backup-dir-");
      const closingMidBackup: TenantRouter = {
        ...router,
        openBackendOf: async (id) => {
          if (id !== "t-beta") return router.openBackendOf(id);
          await router.evict(id);
          throw new Error("The database connection is not open");
        },
      };

      await expect(runBackups({ platform, router: closingMidBackup, dir, now: () => new Date(T) })).resolves.toEqual({ skipped: [] });
      expect(backedUp(dir)).toEqual(["t-alpha", "t-gamma"]);
    });

    it("skips a tenant whose books are refused, says which and why, and still backs up the tenants after it", async () => {
      const { platform, router } = await threeOpen();
      const dir = tempDir("mezan-backup-dir-");
      const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const run = await runBackups({ platform, router: failingFor(router, "t-beta", new TenantDbFileDisownedError("t-beta", "tenants/t-beta.db")), dir, now: () => new Date(T) });

      expect(run.skipped).toEqual([{ tenantId: "t-beta", code: "beta", reason: "TENANT_DB_FILE_DISOWNED" }]);
      expect(backedUp(dir)).toEqual(["t-alpha", "t-gamma"]);
      expect(warned).toHaveBeenCalledTimes(1);
      warned.mockRestore();
    });

    it("backs up the tenants after one that failed for any other reason, and only then reports the run as failed, naming the tenant", async () => {
      const { platform, router } = await threeOpen();
      const dir = tempDir("mezan-backup-dir-");
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const failed = await runBackups({ platform, router: failingFor(router, "t-beta", new Error("disk went away")), dir, now: () => new Date(T) }).catch((err: unknown) => err);

      expect(backedUp(dir)).toEqual(["t-alpha", "t-gamma"]);
      expect(failed).toBeInstanceOf(Error);
      expect((failed as Error).message).toContain("beta: disk went away");
      logged.mockRestore();
    });
  });

  it("never lets a tenant's backup land in the platform's folder, whatever the tenant is called", async () => {
    const platform = await newPlatform();
    const tenant = await createTenant({ id: "t-odd", code: "platform", nameAr: "منشأة", ownerEmail: "o@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    const router = newRouter(platform);
    await openServed(router, platform, "platform");
    const dir = tempDir("mezan-backup-dir-");

    await runBackups({ platform, router, dir, now: () => new Date(T) });

    const platformFile = path.join(dir, "backups", "platform", "2026-01-15T00-00-00.000Z.sqlite");
    const { sqlite: copy } = openSqliteConnection(platformFile);
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tenant'").all()).toHaveLength(1);
    copy.close();
    expect(readdirSync(path.join(dir, "backups", "platform")).filter((f) => f.endsWith(".sqlite"))).toHaveLength(1);
    expect(existsSync(path.join(dir, "backups", "tenants", "t-odd", "2026-01-15T00-00-00.000Z.sqlite"))).toBe(true);
  });

  it("does not keep an idle tenant open: a backup leaves its idle clock alone", async () => {
    const platform = await newPlatform();
    await seedTenant(platform, "idle");
    let now = Date.parse(T);
    const router = newRouter(platform, () => new Date(now));
    await openServed(router, platform, "idle");
    now += 20 * 60_000;
    await runBackups({ platform, router, dir: tempDir("mezan-backup-dir-"), now: () => new Date(now) });
    now += 11 * 60_000;
    await router.sweep();
    expect(router.openTenants()).toEqual([]);
  });

  it("gives a company that re-registered a released code a backup folder of its own", async () => {
    const platform = await newPlatform();
    await seedTenant(platform, "shared");
    const router = newRouter(platform);
    await openServed(router, platform, "shared");
    const dir = tempDir("mezan-backup-dir-");
    await runBackups({ platform, router, dir, now: () => new Date(T) });
    const first = await platform.stores.tenants.findByCode("shared");
    await platform.stores.tenants.compareAndSetStatus(first!, { ...first!, status: TenantStatusCode.Archived, code: "released-t-shared" });
    await router.evict("t-shared");
    const second = await createTenant({ id: "t-second", code: "shared", nameAr: "ثانية", ownerEmail: "n@x.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: second.id, now: T }, platform.stores.tenants);
    await openServed(router, platform, "shared");

    await runBackups({ platform, router, dir, now: () => new Date("2026-01-16T00:00:00.000Z") });

    expect(readdirSync(path.join(dir, "backups", "tenants")).sort()).toEqual(["t-second", "t-shared"]);
    expect(readdirSync(path.join(dir, "backups", "tenants", "t-shared")).filter((f) => f.endsWith(".sqlite"))).toEqual(["2026-01-15T00-00-00.000Z.sqlite"]);
    expect(readdirSync(path.join(dir, "backups", "tenants", "t-second")).filter((f) => f.endsWith(".sqlite"))).toEqual(["2026-01-16T00-00-00.000Z.sqlite"]);
  });

  describe("a backup folder kept under the tenant's code by an earlier build", () => {
    async function legacyWorld(files: Record<string, string>) {
      const platform = await newPlatform();
      await seedTenant(platform, "cyag");
      const router = newRouter(platform);
      await openServed(router, platform, "cyag");
      const dir = tempDir("mezan-backup-dir-");
      const legacy = path.join(dir, "backups", "cyag");
      mkdirSync(legacy, { recursive: true });
      for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(legacy, name), bytes);
      return { platform, router, dir, legacy, adopted: path.join(dir, "backups", "tenants", "t-cyag") };
    }

    it("moves the tenant's own backups into the id folder and leaves in place every file older than the tenant, which belonged to an earlier holder of the code", async () => {
      const w = await legacyWorld({
        "2025-12-01T00-00-00.000Z.sqlite": "AN EARLIER COMPANY",
        "2026-01-15T00-00-00.000Z.sqlite": "OURS AT CREATION",
        "2026-01-20T00-00-00.000Z.sqlite": "OURS LATER",
        "verify.jsonl": "{}",
      });

      await runBackups({ platform: w.platform, router: w.router, dir: w.dir, now: () => new Date("2026-02-01T00:00:00.000Z") });

      expect(readdirSync(w.legacy).sort()).toEqual(["2025-12-01T00-00-00.000Z.sqlite", "verify.jsonl"]);
      expect(readFileSync(path.join(w.legacy, "2025-12-01T00-00-00.000Z.sqlite"), "utf8")).toBe("AN EARLIER COMPANY");
      expect(readFileSync(path.join(w.adopted, "2026-01-15T00-00-00.000Z.sqlite"), "utf8")).toBe("OURS AT CREATION");
      expect(readFileSync(path.join(w.adopted, "2026-01-20T00-00-00.000Z.sqlite"), "utf8")).toBe("OURS LATER");
      expect(existsSync(path.join(w.adopted, "2026-02-01T00-00-00.000Z.sqlite"))).toBe(true);
    });

    it("never overwrites a backup already in the id folder, and a second run changes nothing", async () => {
      const w = await legacyWorld({ "2026-01-20T00-00-00.000Z.sqlite": "LEGACY COPY" });
      mkdirSync(w.adopted, { recursive: true });
      writeFileSync(path.join(w.adopted, "2026-01-20T00-00-00.000Z.sqlite"), "ALREADY HERE");

      await runBackups({ platform: w.platform, router: w.router, dir: w.dir, now: () => new Date("2026-02-01T00:00:00.000Z") });
      await runBackups({ platform: w.platform, router: w.router, dir: w.dir, now: () => new Date("2026-02-02T00:00:00.000Z") });

      expect(readFileSync(path.join(w.adopted, "2026-01-20T00-00-00.000Z.sqlite"), "utf8")).toBe("ALREADY HERE");
      expect(readFileSync(path.join(w.legacy, "2026-01-20T00-00-00.000Z.sqlite"), "utf8")).toBe("LEGACY COPY");
    });
  });

  it("keeps the newest `keep` backups per folder and deletes the rest", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    let clock = new Date(T).getTime();
    for (let i = 0; i < 4; i += 1) {
      await runBackups({ platform, router, dir, now: () => new Date(clock), keep: 2 });
      clock += 60_000;
    }

    // `verify.jsonl` lives beside the archives and is deliberately NOT a
    // backup: `pruneOldBackups` filters to `.sqlite` before it deletes
    // anything, so retention is counted over the same set here.
    const folder = path.join(dir, "backups", "platform");
    const files = readdirSync(folder).filter((f) => f.endsWith(".sqlite")).sort();
    expect(files).toHaveLength(2);
    expect(files).toEqual([
      "2026-01-15T00-02-00.000Z.sqlite",
      "2026-01-15T00-03-00.000Z.sqlite",
    ]);
    // Retention must never carry the verification log away with the archives.
    expect(readdirSync(folder)).toContain("verify.jsonl");
  });

  it("defaults keep to 12", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    let clock = new Date(T).getTime();
    for (let i = 0; i < 13; i += 1) {
      await runBackups({ platform, router, dir, now: () => new Date(clock), verify: verifyBackupFile });
      clock += 60_000;
    }

    const files = readdirSync(path.join(dir, "backups", "platform")).filter((f) => f.endsWith(".sqlite"));
    expect(files).toHaveLength(12);
  });

  it("leaves no .tmp files behind on success", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    await runBackups({ platform, router, dir, now: () => new Date(T) });

    const files = readdirSync(path.join(dir, "backups", "platform"));
    expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
  });
});

describe("startBackupTimer", () => {
  it("runs once immediately without waiting for the interval", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    const stop = startBackupTimer({ platform, router, dir, now: () => new Date(T), intervalMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(existsSync(path.join(dir, "backups", "platform"))).toBe(true);
    stop();
  });

  it("repeats on the injected interval, and stop() ends further runs", async () => {
    // Real timers, deliberately: `runBackups` drives better-sqlite3's OWN
    // internal `setImmediate` backup loop and real filesystem I/O, neither of
    // which vitest's fake-timer clock advances.
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");
    const platformDir = path.join(dir, "backups", "platform");

    let clock = new Date(T).getTime();
    const stop = startBackupTimer({ platform, router, dir, now: () => new Date(clock), intervalMs: 20 });
    await pollUntil(() => countFiles(platformDir) >= 1);

    clock += 60_000;
    await pollUntil(() => countFiles(platformDir) >= 2);

    await stop();
    const countAfterStop = countFiles(platformDir);
    clock += 60_000;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(countFiles(platformDir)).toBe(countAfterStop);
  });

  it("skips a tick while the previous run is still going, so two runs never overlap", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    let started = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const verify = async (file: string): Promise<BackupVerifyRecord> => {
      started += 1;
      await held;
      return { at: T, file, outcome: BackupVerifyOutcome.Ok, ms: 0, report: "" };
    };
    const stop = startBackupTimer({ platform, router, dir: tempDir("mezan-backup-dir-"), now: () => new Date(T), intervalMs: 10, verify });
    await pollUntil(() => started >= 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(started).toBe(1);
    release();
    await stop();
  });

  it("unrefs its timer so it never keeps the process alive on its own", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const stop = startBackupTimer({ platform, router, dir, now: () => new Date(T), intervalMs: 60_000 });
    const created = setIntervalSpy.mock.results[setIntervalSpy.mock.results.length - 1]?.value as NodeJS.Timeout;
    expect(created.hasRef()).toBe(false);
    stop();
    setIntervalSpy.mockRestore();
  });

  it("reports a failed run through onError instead of throwing", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const parent = tempDir("mezan-backup-dir-");
    // A regular FILE where a directory is expected: mkdirSync underneath it
    // reliably fails with ENOTDIR, giving runBackups something real to reject on.
    const blockedDir = path.join(parent, "blocked");
    writeFileSync(blockedDir, "not a directory");

    const onError = vi.fn();
    const stop = startBackupTimer({
      platform,
      router,
      dir: blockedDir,
      now: () => new Date(T),
      intervalMs: 5_000,
      onError,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

describe("createBackupScheduler", () => {
  it("matches the cloud-app `{ start(): () => void }` seam, and start() begins the same timer", async () => {
    const platform = await newPlatform();
    const router = newRouter(platform);
    const dir = tempDir("mezan-backup-dir-");

    const scheduler = createBackupScheduler({ platform, router, dir, now: () => new Date(T), intervalMs: 5_000 });
    const stop = scheduler.start();
    expect(typeof stop).toBe("function");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(existsSync(path.join(dir, "backups", "platform"))).toBe(true);
    stop();
  });
});
