import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TenantBackupDrillOutcome, TenantBackupRefusal } from "@mezan/contracts";
import type { Tenant } from "@mezan/domain";
import { createSessionRegistry, DEFAULT_SESSION_LIMITS } from "@mezan/api";
import { bindTenantDatabase, createSqliteSessionStore, openSqliteConnection } from "@mezan/persistence";
import { decryptFile } from "../../desktop/src/backup/portable-export.js";
import { restoreBackup } from "../../desktop/src/backup/restore-service.js";
import { inspectBackupFile } from "./backup-verify-core.js";
import { inspectBackupOffThread, tenantBackupFolder } from "./backup-scheduler.js";
import { createTenantBackups, EXPORTS_FOLDER } from "./tenant-backups.js";

const T = new Date("2026-01-15T00:00:00.000Z");
const PASSPHRASE = "a long enough passphrase";
const dirs: string[] = [];
const closers: Array<() => void> = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const tenantOf = (id: string): Tenant => ({ id, code: id, status: "active" }) as unknown as Tenant;

function liveBooks(dir: string, tenantId: string, rows: number, boundTo: string | null = tenantId) {
  const file = path.join(dir, `${tenantId}-live.sqlite`);
  const { sqlite } = openSqliteConnection(file);
  sqlite.exec(`CREATE TABLE invoice (id TEXT PRIMARY KEY, total TEXT); CREATE TABLE empty_one (id TEXT)`);
  for (let i = 0; i < rows; i += 1) sqlite.prepare(`INSERT INTO invoice VALUES (?, ?)`).run(`${tenantId}-${i}`, "10.00");
  if (boundTo) bindTenantDatabase(sqlite, boundTo);
  closers.push(() => sqlite.close());
  return { sqlite, backupTo: (destination: string) => sqlite.backup(destination).then(() => undefined) };
}

function service(dir: string, books: Record<string, ReturnType<typeof liveBooks>>, ttlMs?: number) {
  const svc = createTenantBackups({
    dir,
    now: () => T,
    ttlMs,
    inspect: inspectBackupFile,
    router: { backendOf: async (id: string) => books[id] as never },
  });
  closers.push(() => svc.close());
  return svc;
}

const tokenOf = (downloadPath: string) => downloadPath.split("/").pop()!;
const exportFiles = (dir: string) => readdirSync(path.join(dir, EXPORTS_FOLDER));

async function drain(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(body).arrayBuffer());
}

describe("a tenant's backup export", () => {
  it("is an archive the desktop edition's own import decrypts and restores, row for row", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 3) });

    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });
    const taken = await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) });
    const encrypted = path.join(dir, "download.mezanbak.enc");
    writeFileSync(encrypted, await drain(taken!.body));

    expect(offer.fileName).toMatch(/\.mezanbak\.enc$/);
    expect(offer.bytes).toBe(taken!.bytes);
    expect(offer.totalRows).toBeGreaterThanOrEqual(3);
    const plain = path.join(dir, "plain.tar.gz");
    await expect(decryptFile(encrypted, plain, "not the passphrase")).rejects.toThrow();
    await decryptFile(encrypted, plain, PASSPHRASE);
    const target = path.join(dir, "desktop", "mezan.sqlite");
    const restored = await restoreBackup({ archivePath: plain, targetDbPath: target, workDir: path.join(dir, "work") });
    const { sqlite } = openSqliteConnection(target);
    closers.push(() => sqlite.close());
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM invoice`).get() as { n: number }).n).toBe(3);
    expect(restored.manifest.tables.invoice).toBe(3);
  });

  it("leaves no plaintext behind: only the encrypted file waits, and it is gone after the one download", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1) });

    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });

    const waiting = exportFiles(dir);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatch(/^[0-9a-f-]{36}\.enc$/);
    const taken = await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) });
    await drain(taken!.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exportFiles(dir)).toEqual([]);
    expect(await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) })).toBeNull();
  });

  it("never serves one tenant's export to another tenant's link, or to a guessed token", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1), other: liveBooks(dir, "other", 1) });
    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });
    const token = tokenOf(offer.downloadPath);

    const crossed = await svc.takeExport({ tenant: tenantOf("other"), token });
    const guessed = await svc.takeExport({ tenant: tenantOf("acme"), token: "x".repeat(43) });
    const own = await svc.takeExport({ tenant: tenantOf("acme"), token });

    expect(crossed).toBeNull();
    expect(guessed).toBeNull();
    expect(own).not.toBeNull();
    await drain(own!.body);
  });

  it("deletes an export nobody collects once its time is up", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1) }, 30);
    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });
    expect(exportFiles(dir)).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(exportFiles(dir)).toEqual([]);
    expect(await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) })).toBeNull();
  });

  it("replaces a tenant's earlier unclaimed export instead of piling them up", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1) });

    const first = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });
    await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });

    expect(exportFiles(dir)).toHaveLength(1);
    expect(await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(first.downloadPath) })).toBeNull();
  });

  it("refuses a database bound to a different tenant, and a short passphrase, and writes nothing", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1, "someone-else") });

    await expect(svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE })).rejects.toMatchObject({ code: TenantBackupRefusal.ExportFailed });
    await expect(svc.exportTenant({ tenant: tenantOf("acme"), passphrase: "short" })).rejects.toMatchObject({ code: TenantBackupRefusal.ExportFailed });
    expect(exportFiles(dir)).toEqual([]);
  });

  it("clears exports and work folders a previous process left behind past their time, and leaves a younger instance's files alone", () => {
    const dir = tempDir("mezan-export-");
    const exports = path.join(dir, EXPORTS_FOLDER);
    mkdirSync(path.join(exports, "work-stale"), { recursive: true });
    mkdirSync(path.join(exports, "work-live"), { recursive: true });
    writeFileSync(path.join(exports, "left-over.enc"), "x");
    writeFileSync(path.join(exports, "another-instance.enc"), "x");
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const stale of ["left-over.enc", "work-stale"]) utimesSync(path.join(exports, stale), longAgo, longAgo);

    service(dir, {});

    expect(exportFiles(dir).sort()).toEqual(["another-instance.enc", "work-live"]);
  });

  it("closes the stream and removes the file when the taker abandons the download before reading it", async () => {
    const dir = tempDir("mezan-export-");
    const svc = service(dir, { acme: liveBooks(dir, "acme", 1) });
    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });

    const taken = await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) });
    await taken!.body.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(exportFiles(dir)).toEqual([]);
  });

  it("leaves the sign-in log, the sessions and the lease table empty in the exported database, and untouched in the live one", async () => {
    const dir = tempDir("mezan-export-");
    const books = liveBooks(dir, "acme", 2);
    const live = books.sqlite;
    live.exec(`CREATE TABLE sign_in_attempt (scope TEXT, key TEXT, failures INTEGER); CREATE TABLE resource_lease (lease_key TEXT PRIMARY KEY, owner TEXT, expires_at INTEGER)`);
    live.prepare(`INSERT INTO sign_in_attempt VALUES ('account', 'ali@example.eg', 3)`).run();
    live.prepare(`INSERT INTO resource_lease VALUES ('hr-punch:u1', 'o', 1)`).run();
    const sessions = createSessionRegistry(Date.now, DEFAULT_SESSION_LIMITS, createSqliteSessionStore(live));
    const first = await sessions.issueDeviceBound({ userId: "u1", permissions: ["*"], roleCode: null, branchScope: "*", warehouseScope: "*" }, "41.33.10.10");
    await sessions.issueDeviceBound({ userId: "u2", permissions: ["*"], roleCode: null, branchScope: "*", warehouseScope: "*" }, "41.33.10.10", first.deviceSecret);
    const svc = service(dir, { acme: books });

    const offer = await svc.exportTenant({ tenant: tenantOf("acme"), passphrase: PASSPHRASE });
    const taken = await svc.takeExport({ tenant: tenantOf("acme"), token: tokenOf(offer.downloadPath) });
    const encrypted = path.join(dir, "out.enc");
    writeFileSync(encrypted, await drain(taken!.body));
    const plain = path.join(dir, "plain.tar.gz");
    await decryptFile(encrypted, plain, PASSPHRASE);
    const target = path.join(dir, "desktop", "mezan.sqlite");
    await restoreBackup({ archivePath: plain, targetDbPath: target, workDir: path.join(dir, "work") });
    const { sqlite: exported } = openSqliteConnection(target);
    closers.push(() => exported.close());
    expect(exported.prepare(`SELECT count(*) AS n FROM sign_in_attempt`).get()).toEqual({ n: 0 });
    expect(exported.prepare(`SELECT count(*) AS n FROM resource_lease`).get()).toEqual({ n: 0 });
    expect(exported.prepare(`SELECT count(*) AS n FROM auth_session`).get()).toEqual({ n: 0 });
    expect(exported.prepare(`SELECT count(*) AS n FROM auth_session_displaced`).get()).toEqual({ n: 0 });
    expect(live.prepare(`SELECT count(*) AS n FROM auth_session`).get()).toEqual({ n: 1 });
    expect(live.prepare(`SELECT count(*) AS n FROM auth_session_displaced`).get()).toEqual({ n: 1 });
    expect(exported.prepare(`SELECT count(*) AS n FROM invoice`).get()).toEqual({ n: 2 });
    expect(live.prepare(`SELECT count(*) AS n FROM sign_in_attempt`).get()).toEqual({ n: 1 });
    expect(live.prepare(`SELECT count(*) AS n FROM resource_lease`).get()).toEqual({ n: 1 });
  });
});

describe("a tenant's restore drill", () => {
  function storedBackup(dir: string, tenantId: string, name: string, rows: number, boundTo: string | null = tenantId): string {
    const folder = tenantBackupFolder(dir, tenantId);
    mkdirSync(folder, { recursive: true });
    const file = path.join(folder, name);
    const { sqlite } = openSqliteConnection(file);
    sqlite.exec(`CREATE TABLE invoice (id TEXT PRIMARY KEY); CREATE TABLE empty_one (id TEXT)`);
    for (let i = 0; i < rows; i += 1) sqlite.prepare(`INSERT INTO invoice VALUES (?)`).run(`i${i}`);
    if (boundTo) bindTenantDatabase(sqlite, boundTo);
    sqlite.close();
    return file;
  }

  it("restores the newest stored backup into a scratch copy and reports counts, leaving the stored file untouched", async () => {
    const dir = tempDir("mezan-drill-");
    storedBackup(dir, "acme", "2026-01-01T00-00-00.000Z.sqlite", 1);
    const newest = storedBackup(dir, "acme", "2026-01-02T00-00-00.000Z.sqlite", 4);
    const before = readdirSync(path.dirname(newest));
    const svc = service(dir, {});

    const result = await svc.drill({ tenant: tenantOf("acme") });

    expect(result).toMatchObject({ file: "2026-01-02T00-00-00.000Z.sqlite", outcome: TenantBackupDrillOutcome.Pass, report: "ok", emptyTables: 1 });
    expect(result.largestTables[0]).toEqual({ name: "invoice", rows: 4 });
    expect(readdirSync(path.dirname(newest))).toEqual(before);
    expect(existsSync(path.join(dir, "acme-live.sqlite"))).toBe(false);
  });

  it("drills the chosen backup, and refuses a name that is not one of the tenant's own files", async () => {
    const dir = tempDir("mezan-drill-");
    storedBackup(dir, "acme", "2026-01-01T00-00-00.000Z.sqlite", 1);
    storedBackup(dir, "other", "secret.sqlite", 1);
    const svc = service(dir, {});

    const chosen = await svc.drill({ tenant: tenantOf("acme"), file: "2026-01-01T00-00-00.000Z.sqlite" });
    const traversal = svc.drill({ tenant: tenantOf("acme"), file: "../../other/secret.sqlite" });

    expect(chosen.file).toBe("2026-01-01T00-00-00.000Z.sqlite");
    await expect(traversal).rejects.toMatchObject({ code: TenantBackupRefusal.BackupNotFound });
  });

  it("fails the drill for a corrupt backup and for one that belongs to another tenant", async () => {
    const dir = tempDir("mezan-drill-");
    const corrupt = storedBackup(dir, "acme", "2026-01-01T00-00-00.000Z.sqlite", 1);
    writeFileSync(corrupt, "this is not a database file at all, not even close");
    storedBackup(dir, "foreign", "2026-01-01T00-00-00.000Z.sqlite", 1, "someone-else");
    const svc = service(dir, {});

    const broken = await svc.drill({ tenant: tenantOf("acme") });
    const foreign = await svc.drill({ tenant: tenantOf("foreign") });

    expect(broken.outcome).toBe(TenantBackupDrillOutcome.Fail);
    expect(foreign).toMatchObject({ outcome: TenantBackupDrillOutcome.Fail, report: "the backup is bound to another tenant" });
  });

  it("says so when a tenant has no stored backup", async () => {
    const svc = service(tempDir("mezan-drill-"), {});

    await expect(svc.drill({ tenant: tenantOf("acme") })).rejects.toMatchObject({ code: TenantBackupRefusal.NoBackup });
    expect(await svc.list(tenantOf("acme"))).toEqual([]);
  });

  it("inspects in a forked process too, which is how the console runs it", async () => {
    const dir = tempDir("mezan-drill-");
    const file = storedBackup(dir, "acme", "2026-01-01T00-00-00.000Z.sqlite", 2);

    const inspection = await inspectBackupOffThread(file);

    expect(inspection).toMatchObject({ report: "ok", boundTenantId: "acme", tables: { invoice: 2, empty_one: 0 } });
  });
});
