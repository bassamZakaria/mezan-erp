import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { activateTenant, createTenant } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createTenantRouter, type TenantRouter } from "./tenant-router.js";
import { createBackupScheduler, runBackups, startBackupTimer } from "./backup-scheduler.js";
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

function newRouter(platform: PlatformHandle): TenantRouter {
  const dataDir = tempDir("mezan-backup-router-");
  const router = createTenantRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now: () => new Date(T),
    openBackend: () => createBackend({ dbPath: ":memory:" }),
  });
  routers.push(router);
  return router;
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
  it("writes the platform backup and one backup per OPEN tenant, skipping a tenant never opened", async () => {
    const platform = await newPlatform();
    await seedTenant(platform, "cyag");
    await seedTenant(platform, "nile");
    const router = newRouter(platform);
    await router.backendFor("cyag");

    const dir = tempDir("mezan-backup-dir-");
    await runBackups({ platform, router, dir, now: () => new Date(T) });

    const stamp = "2026-01-15T00-00-00.000Z";
    const platformFile = path.join(dir, "backups", "platform", `${stamp}.sqlite`);
    const cyagFile = path.join(dir, "backups", "cyag", `${stamp}.sqlite`);

    expect(existsSync(platformFile)).toBe(true);
    expect(existsSync(cyagFile)).toBe(true);
    expect(existsSync(path.join(dir, "backups", "nile"))).toBe(false);

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
