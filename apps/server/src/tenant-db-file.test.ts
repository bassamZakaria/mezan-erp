import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, SEED_ADMIN_PIN, type PlatformHandle } from "@mezan/backend";
import { activateTenant, createTenant, releaseTenant, tenantDbFile, TenantStatusCode, type Tenant } from "@mezan/domain";
import { bindTenantDatabase, holdSqliteFile, openSqliteConnection, readTenantBooksIdentity, SqliteFileBusyError } from "@mezan/persistence";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { harnessEnv, HARNESS_OWNER_EMAIL, HARNESS_OWNER_PASSWORD, proxiedRequest, type SendInit } from "./cloud-harness.js";
import type { CloudEnv } from "./env.js";
import { provisionTenant } from "./provision-tenant.js";
import {
  settleTenantDbFile,
  sha256OfFile,
  TenantDbFileBusyError,
  TenantDbFileConflictError,
  TenantDbFileForeignError,
  TenantDbFileMissingError,
  TenantDbFileSharedError,
} from "./tenant-db-file.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";

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
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-dbfile-"));
  dirs.push(dataDir);
  mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
  const platform = await createPlatform({ dbPath: path.join(dataDir, "platform.db"), now });
  platforms.push(platform);
  return { dataDir, platform };
}

async function storedByCode(platform: PlatformHandle, id: string, code: string): Promise<Tenant> {
  const tenant = await createTenant({ id, code, nameAr: "شركة قديمة", ownerEmail: `o@${code}.example`, now: T }, platform.stores.tenants);
  const legacy = `tenants/${code}.db`;
  expect(await platform.stores.tenants.setDbFile(tenant.id, tenant.dbFile, legacy)).toBe(true);
  return { ...tenant, dbFile: legacy };
}

function filesIn(dataDir: string): string[] {
  return readdirSync(path.join(dataDir, "tenants")).sort();
}

interface Books {
  exec(sql: string): unknown;
  prepare(sql: string): { all(): unknown[] };
  close(): unknown;
}

function connect(file: string): Books {
  const { sqlite } = openSqliteConnection(file);
  sqlite.exec("CREATE TABLE IF NOT EXISTS inv(n INTEGER)");
  return sqlite;
}

function books(file: string, rows: readonly number[]): void {
  const db = connect(file);
  for (const n of rows) db.exec(`INSERT INTO inv VALUES (${n})`);
  db.close();
}

function rowsOf(file: string): number[] {
  const db = connect(file);
  const rows = (db.prepare("SELECT n FROM inv ORDER BY n").all() as { n: number }[]).map((row) => row.n);
  db.close();
  return rows;
}

describe("a tenant database stored under its code", () => {
  it("is folded into one file, copied to the name of the tenant id, the row follows, and only then is the old file removed", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-old", "olden");
    books(path.join(dataDir, "tenants/olden.db"), [1, 2]);

    const settled = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(settled.dbFile).toBe("tenants/t-old.db");
    expect((await platform.stores.tenants.findById("t-old"))?.dbFile).toBe("tenants/t-old.db");
    expect(filesIn(dataDir)).toEqual(["t-old.db"]);
    expect(rowsOf(path.join(dataDir, "tenants/t-old.db"))).toEqual([1, 2]);
  });

  it("does nothing the second time", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-twice", "twice");
    books(path.join(dataDir, "tenants/twice.db"), [1]);
    const first = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);
    const before = filesIn(dataDir);

    expect(await settleTenantDbFile(platform.stores.tenants, dataDir, first)).toBe(first);

    expect(filesIn(dataDir)).toEqual(before);
  });

  it("finishes a rename that stopped after the copy: the same bytes at both names are adopted, not copied again", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-half", "halfway");
    books(path.join(dataDir, "tenants/halfway.db"), [1]);
    holdSqliteFile(path.join(dataDir, "tenants/halfway.db")).release();
    copyFileSync(path.join(dataDir, "tenants/halfway.db"), path.join(dataDir, "tenants/t-half.db"));
    const copies: string[] = [];

    const settled = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant, { copyFile: async (from) => void copies.push(from) });

    expect(settled.dbFile).toBe("tenants/t-half.db");
    expect(copies).toEqual([]);
    expect(filesIn(dataDir)).toEqual(["t-half.db"]);
  });

  it("refuses when a different file already sits at the id name, and touches neither file nor the row", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-clash", "clash");
    books(path.join(dataDir, "tenants/clash.db"), [1]);
    books(path.join(dataDir, "tenants/t-clash.db"), [2]);

    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).rejects.toBeInstanceOf(TenantDbFileConflictError);

    expect(rowsOf(path.join(dataDir, "tenants/clash.db"))).toEqual([1]);
    expect(rowsOf(path.join(dataDir, "tenants/t-clash.db"))).toEqual([2]);
    expect((await platform.stores.tenants.findById("t-clash"))?.dbFile).toBe("tenants/clash.db");
  });

  it("hashes a conflicting pair once, and again only after one of the files changes", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-cache", "cached");
    books(path.join(dataDir, "tenants/cached.db"), [1]);
    books(path.join(dataDir, "tenants/t-cache.db"), [2]);
    const hashed: string[] = [];
    const io = { sha256Of: (file: string) => (hashed.push(path.basename(file)), sha256OfFile(file)) };

    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io)).rejects.toBeInstanceOf(TenantDbFileConflictError);
    const first = hashed.splice(0);
    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io)).rejects.toBeInstanceOf(TenantDbFileConflictError);
    const second = hashed.splice(0);
    books(path.join(dataDir, "tenants/t-cache.db"), Array.from({ length: 2000 }, (_, n) => n));
    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io)).rejects.toBeInstanceOf(TenantDbFileConflictError);

    expect(first.sort()).toEqual(["cached.db", "t-cache.db"]);
    expect(second).toEqual([]);
    expect(hashed.sort()).toEqual(["cached.db", "t-cache.db"]);
  });

  it("refuses when a stray WAL sits at the id name with no source to match it", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-stray", "stray");
    books(path.join(dataDir, "tenants/stray.db"), [1]);
    writeFileSync(path.join(dataDir, "tenants/t-stray.db-wal"), "ORPHAN");

    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).rejects.toBeInstanceOf(TenantDbFileConflictError);

    expect(existsSync(path.join(dataDir, "tenants/stray.db"))).toBe(true);
    expect((await platform.stores.tenants.findById("t-stray"))?.dbFile).toBe("tenants/stray.db");
  });

  it("only renames the row of a tenant still being provisioned whose database was never created", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-new", "neverup");

    expect((await settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).dbFile).toBe("tenants/t-new.db");

    expect(filesIn(dataDir)).toEqual([]);
  });

  it("refuses an active tenant whose database file is missing, and leaves the row naming it", async () => {
    const { dataDir, platform } = await world();
    await storedByCode(platform, "t-gone", "missing");
    const active = await activateTenant({ id: "t-gone", now: T }, platform.stores.tenants);

    const refused = await settleTenantDbFile(platform.stores.tenants, dataDir, active).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(TenantDbFileMissingError);
    expect((await platform.stores.tenants.findById("t-gone"))?.dbFile).toBe("tenants/missing.db");
    expect(filesIn(dataDir)).toEqual([]);
  });

  it("follows an active tenant's file that already sits at the id name when the old one is gone", async () => {
    const { dataDir, platform } = await world();
    await storedByCode(platform, "t-moved", "moved");
    const active = await activateTenant({ id: "t-moved", now: T }, platform.stores.tenants);
    books(path.join(dataDir, "tenants/t-moved.db"), [5]);

    expect((await settleTenantDbFile(platform.stores.tenants, dataDir, active)).dbFile).toBe("tenants/t-moved.db");

    expect(rowsOf(path.join(dataDir, "tenants/t-moved.db"))).toEqual([5]);
  });

  it("refuses while another tenant's row names the same file, and moves nothing", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-one", "sharer");
    books(path.join(dataDir, "tenants/sharer.db"), [7]);
    const twin: Tenant = { ...tenant, id: "t-two", code: "sharez" };
    const tenants = {
      findById: (id: string) => platform.stores.tenants.findById(id),
      setDbFile: (id: string, from: string, to: string) => platform.stores.tenants.setDbFile(id, from, to),
      list: async () => [tenant, twin],
    };

    await expect(settleTenantDbFile(tenants, dataDir, tenant)).rejects.toBeInstanceOf(TenantDbFileSharedError);

    expect(filesIn(dataDir)).toEqual(["sharer.db"]);
    expect((await platform.stores.tenants.findById("t-one"))?.dbFile).toBe("tenants/sharer.db");
  });

  it("refuses while another connection has the old file open, so a write made there afterwards is never lost", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-busy", "busy");
    const old = connect(path.join(dataDir, "tenants/busy.db"));
    old.exec("INSERT INTO inv VALUES (1)");

    const refused = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant, { waitMs: 50 }).catch((err: unknown) => err);
    old.exec("INSERT INTO inv VALUES (2)");
    old.close();
    const settled = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(refused).toBeInstanceOf(TenantDbFileBusyError);
    expect(rowsOf(path.join(dataDir, settled.dbFile))).toEqual([1, 2]);
    expect(filesIn(dataDir)).toEqual(["t-busy.db"]);
  });

  it("keeps the old file to itself for as long as it is being copied: nothing else can take it or write to it until the row has moved", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-held", "held");
    const from = path.join(dataDir, "tenants/held.db");
    books(from, [1]);
    const duringTheCopy: unknown[] = [];
    const taken = (): unknown => {
      try {
        holdSqliteFile(from, { waitMs: 50 }).release();
        return "taken";
      } catch (err) {
        return err;
      }
    };
    const tenants = {
      findById: (id: string) => platform.stores.tenants.findById(id),
      list: () => platform.stores.tenants.list(),
      setDbFile: (id: string, was: string, to: string) => (duringTheCopy.push(taken()), platform.stores.tenants.setDbFile(id, was, to)),
    };

    const settled = await settleTenantDbFile(tenants, dataDir, tenant, {
      copyFile: async (source, to) => {
        duringTheCopy.push(taken());
        copyFileSync(source, to);
        duringTheCopy.push(taken());
      },
    });

    expect(duringTheCopy).toHaveLength(3);
    for (const attempt of duringTheCopy) expect(attempt).toBeInstanceOf(SqliteFileBusyError);
    expect(rowsOf(path.join(dataDir, settled.dbFile))).toEqual([1]);
  });

  it("removes the old file only after the row names the new one, and keeps it when the row does not move", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-order", "ordered");
    const from = path.join(dataDir, "tenants/ordered.db");
    books(from, [1]);
    const seen: boolean[] = [];
    const tenants = {
      findById: (id: string) => platform.stores.tenants.findById(id),
      list: () => platform.stores.tenants.list(),
      setDbFile: async () => (seen.push(existsSync(from)), false),
    };

    await expect(settleTenantDbFile(tenants, dataDir, tenant)).rejects.toThrow("changed while it was being renamed");

    expect(seen).toEqual([true]);
    expect(rowsOf(from)).toEqual([1]);
  });

  it("throws away a copy whose bytes do not match the source, and leaves the row and the old file alone", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-bad", "badcopy");
    books(path.join(dataDir, "tenants/badcopy.db"), [1]);

    await expect(
      settleTenantDbFile(platform.stores.tenants, dataDir, tenant, { copyFile: async (_from, to) => writeFileSync(to, "TRUNCATED") }),
    ).rejects.toThrow("did not match its source");

    expect(filesIn(dataDir)).toEqual(["badcopy.db"]);
    expect((await platform.stores.tenants.findById("t-bad"))?.dbFile).toBe("tenants/badcopy.db");
    expect(rowsOf(path.join(dataDir, "tenants/badcopy.db"))).toEqual([1]);
  });
});

describe("a stale copy left under the code after the row already names the id file", () => {
  it("is removed when its bytes are the same as the tenant's database", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-stale", code: "stale", nameAr: "شركة", ownerEmail: "o@stale.example", now: T }, platform.stores.tenants);
    books(path.join(dataDir, "tenants/t-stale.db"), [1]);
    holdSqliteFile(path.join(dataDir, "tenants/t-stale.db")).release();
    copyFileSync(path.join(dataDir, "tenants/t-stale.db"), path.join(dataDir, "tenants/stale.db"));

    expect(await settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).toBe(tenant);

    expect(filesIn(dataDir)).toEqual(["t-stale.db"]);
  });

  it("is left alone and reported once when its bytes differ", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-differ", code: "differ", nameAr: "شركة", ownerEmail: "o@differ.example", now: T }, platform.stores.tenants);
    books(path.join(dataDir, "tenants/t-differ.db"), [1]);
    books(path.join(dataDir, "tenants/differ.db"), [2]);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);
    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(rowsOf(path.join(dataDir, "tenants/differ.db"))).toEqual([2]);
    expect(warned.mock.calls.filter(([line]) => String(line).includes("t-differ"))).toHaveLength(1);
    warned.mockRestore();
  });

  it("is hashed once while its bytes differ, and again only after one of the two files changes", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-seen", code: "seen", nameAr: "شركة", ownerEmail: "o@seen.example", now: T }, platform.stores.tenants);
    books(path.join(dataDir, "tenants/t-seen.db"), [1]);
    books(path.join(dataDir, "tenants/seen.db"), [2]);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hashed: string[] = [];
    const io = { sha256Of: (file: string) => (hashed.push(path.basename(file)), sha256OfFile(file)) };

    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io);
    const first = hashed.splice(0);
    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io);
    const second = hashed.splice(0);
    books(path.join(dataDir, "tenants/t-seen.db"), Array.from({ length: 2000 }, (_, n) => n));
    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant, io);

    expect(first.sort()).toEqual(["seen.db", "t-seen.db"]);
    expect(second).toEqual([]);
    expect(hashed.sort()).toEqual(["seen.db", "t-seen.db"]);
    expect(rowsOf(path.join(dataDir, "tenants/seen.db"))).toEqual([2]);
    expect(warned.mock.calls.filter(([line]) => String(line).includes("t-seen"))).toHaveLength(1);
    warned.mockRestore();
  });

  it("is removed on a later open once its bytes have become the same as the tenant's database", async () => {
    const { dataDir, platform } = await world();
    const tenant = await createTenant({ id: "t-later", code: "later", nameAr: "شركة", ownerEmail: "o@later.example", now: T }, platform.stores.tenants);
    books(path.join(dataDir, "tenants/t-later.db"), [1]);
    books(path.join(dataDir, "tenants/later.db"), [2]);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);
    holdSqliteFile(path.join(dataDir, "tenants/t-later.db")).release();
    copyFileSync(path.join(dataDir, "tenants/t-later.db"), path.join(dataDir, "tenants/later.db"));
    await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(filesIn(dataDir)).toEqual(["t-later.db"]);
    warned.mockRestore();
  });

  it("is never touched while another tenant's row names it", async () => {
    const { dataDir, platform } = await world();
    const released = await storedByCode(platform, "t-first", "reused");
    books(path.join(dataDir, "tenants/reused.db"), [1]);
    await releaseTenant({ id: released.id, now: T }, platform.stores.tenants);
    const next = await createTenant({ id: "t-next", code: "reused", nameAr: "شركة", ownerEmail: "n@reused.example", now: T }, platform.stores.tenants);
    copyFileSync(path.join(dataDir, "tenants/reused.db"), path.join(dataDir, "tenants/t-next.db"));

    await settleTenantDbFile(platform.stores.tenants, dataDir, next);

    expect(filesIn(dataDir)).toEqual(["reused.db", "reused.db-shm", "reused.db-wal", "t-next.db"].filter((name) => existsSync(path.join(dataDir, "tenants", name))));
    expect(existsSync(path.join(dataDir, "tenants/reused.db"))).toBe(true);
  });
});

describe("a served tenant whose database is not at the id name any more", () => {
  async function served(platform: PlatformHandle, id: string, code: string): Promise<Tenant> {
    await createTenant({ id, code, nameAr: "شركة قائمة", ownerEmail: `o@${code}.example`, now: T }, platform.stores.tenants);
    return activateTenant({ id, now: T }, platform.stores.tenants);
  }

  it("is refused when the file is gone, and nothing is created in its place", async () => {
    const { dataDir, platform } = await world();
    const active = await served(platform, "t-lost", "lost");

    const refused = await settleTenantDbFile(platform.stores.tenants, dataDir, active).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(TenantDbFileMissingError);
    expect((await platform.stores.tenants.findById("t-lost"))?.dbFile).toBe("tenants/t-lost.db");
    expect(filesIn(dataDir)).toEqual([]);
  });

  it.each([
    ["an empty file", Buffer.alloc(0)],
    ["a file that is not a database", Buffer.from("this is not a database, and it is longer than the hundred bytes a database header takes up on disk, so only its first bytes tell")],
    ["a file cut off inside the database header", Buffer.from("SQLite format 3\0")],
  ])("is refused when %s sits at the id name, and the file is left as it was", async (_label, bytes) => {
    const { dataDir, platform } = await world();
    const active = await served(platform, "t-blank", "blank");
    const file = path.join(dataDir, "tenants/t-blank.db");
    writeFileSync(file, bytes);

    const refused = await settleTenantDbFile(platform.stores.tenants, dataDir, active).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(TenantDbFileMissingError);
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(filesIn(dataDir)).toEqual(["t-blank.db"]);
  });

  it("is served when its database is there", async () => {
    const { dataDir, platform } = await world();
    const active = await served(platform, "t-here", "here");
    books(path.join(dataDir, "tenants/t-here.db"), [3]);

    expect((await settleTenantDbFile(platform.stores.tenants, dataDir, active)).dbFile).toBe("tenants/t-here.db");
  });

  it("leaves a tenant still being provisioned to have its database created on the first open", async () => {
    const { dataDir, platform } = await world();
    const provisioning = await createTenant({ id: "t-fresh", code: "fresh", nameAr: "شركة جديدة", ownerEmail: "o@fresh.example", now: T }, platform.stores.tenants);

    expect((await settleTenantDbFile(platform.stores.tenants, dataDir, provisioning)).dbFile).toBe("tenants/t-fresh.db");
  });
});

const harnessDirs: string[] = [];
const apps: CloudApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of harnessDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot(env: CloudEnv) {
  const app = await createCloudApp(env);
  apps.push(app);
  const send = async (pathname: string, init: SendInit = {}) => {
    const res = await app.root.fetch(proxiedRequest(pathname, init));
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const login = await send("/api/platform/auth/login", { method: "POST", body: JSON.stringify({ email: HARNESS_OWNER_EMAIL, password: HARNESS_OWNER_PASSWORD }) });
  return { app, send, platformToken: String(login.json?.["token"]) };
}

type Booted = Awaited<ReturnType<typeof boot>>;

const NOT_IN_PLACE = "ملف بيانات المنشأة ليس في مكانه المتوقع. تواصل مع الدعم.";
const ATTACKER = { nameAr: "مهاجم", nameEn: "Attacker", email: "attacker@evil.example", pin: "246813", companyName: "شركة النيل" };

describe("a served company whose database file was removed from the server", () => {
  const MISSING = { error: "TENANT_DB_FILE_MISSING", message: NOT_IN_PLACE };

  it.each([
    ["removed", (file: string) => rmSync(file)],
    ["emptied", (file: string) => writeFileSync(file, "")],
  ])("cannot be signed in to, is not offered for setup and cannot be claimed once the file is %s; its platform row is untouched", async (_label, damage) => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const created = await first.send("/api/platform/tenants", {
      method: "POST", token: first.platformToken,
      body: JSON.stringify({ code: "nile", nameAr: "شركة النيل", ownerEmail: "owner@nile.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true }),
    });
    expect(created.status).toBe(201);
    const tenantId = String((created.json?.["tenant"] as Record<string, unknown>)["id"]);
    const adminPin = String(created.json?.["adminPin"]);
    const credentials = JSON.stringify({ username: "owner@nile.example", pin: adminPin });
    expect((await first.send("/api/auth/login", { method: "POST", tenant: "nile", body: credentials })).status).toBe(200);
    const rowOf = async (from: Booted) => (await from.send(`/api/platform/tenants/${tenantId}`, { token: from.platformToken })).json?.["tenant"];
    const before = await rowOf(first);
    await first.app.close();
    const file = path.join(env.platformDir, tenantDbFile(tenantId));
    for (const suffix of ["-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
    damage(file);

    const second = await boot(env);
    const login = await second.send("/api/auth/login", { method: "POST", tenant: "nile", body: credentials });
    const status = await second.send("/api/bootstrap/status", { tenant: "nile" });
    const claim = await second.send("/api/bootstrap/admin", { method: "POST", tenant: "nile", body: JSON.stringify(ATTACKER) });
    const attacker = await second.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: ATTACKER.email, pin: ATTACKER.pin }) });

    expect(login).toEqual({ status: 503, json: MISSING });
    expect(status.status).toBe(503);
    expect(status.json?.["claimed"]).not.toBe(false);
    expect(claim.status).not.toBe(201);
    expect(claim.json?.["permissions"]).toBeUndefined();
    expect(attacker.status).not.toBe(200);
    expect(await rowOf(second)).toEqual(before);
    expect(existsSync(file) ? readFileSync(file).length : 0).toBe(0);
  });
});

describe("a served company whose database file does not hold its own books", () => {
  const FOREIGN = { error: "TENANT_DB_FILE_FOREIGN", message: NOT_IN_PLACE };
  const UNREADABLE = { error: "TENANT_DB_FILE_UNREADABLE", message: NOT_IN_PLACE };
  const SIBLINGS = ["-wal", "-shm"] as const;

  interface Company {
    readonly code: string;
    readonly tenantId: string;
    readonly file: string;
    readonly credentials: string;
  }

  async function company(on: Booted, env: CloudEnv, code: string): Promise<Company> {
    const created = await on.send("/api/platform/tenants", {
      method: "POST", token: on.platformToken,
      body: JSON.stringify({ code, nameAr: `شركة ${code}`, ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true }),
    });
    expect(created.status).toBe(201);
    const tenantId = String((created.json?.["tenant"] as Record<string, unknown>)["id"]);
    const credentials = JSON.stringify({ username: `owner@${code}.example`, pin: String(created.json?.["adminPin"]) });
    expect((await on.send("/api/auth/login", { method: "POST", tenant: code, body: credentials })).status).toBe(200);
    return { code, tenantId, file: path.join(env.platformDir, tenantDbFile(tenantId)), credentials };
  }

  const rowOf = async (from: Booted, tenantId: string) => (await from.send(`/api/platform/tenants/${tenantId}`, { token: from.platformToken })).json?.["tenant"];
  const signIn = (on: Booted, as: Company, under = as.code) => on.send("/api/auth/login", { method: "POST", tenant: under, body: as.credentials });
  const siblingsOf = (file: string): string[] => SIBLINGS.filter((suffix) => existsSync(`${file}${suffix}`));

  function replace(file: string, write: (file: string) => void): Buffer {
    for (const suffix of ["", ...SIBLINGS]) rmSync(`${file}${suffix}`, { force: true });
    write(file);
    return readFileSync(file);
  }

  function emptyDatabase(journalMode: string): (file: string) => void {
    return (file) => {
      const { sqlite } = openSqliteConnection(file);
      sqlite.exec("CREATE TABLE scratch(x); DROP TABLE scratch;");
      sqlite.pragma(`journal_mode = ${journalMode}`);
      sqlite.close();
    };
  }

  function inBooks<T>(file: string, read: (sqlite: ReturnType<typeof openSqliteConnection>["sqlite"]) => T): T {
    const { sqlite } = openSqliteConnection(file);
    try {
      return read(sqlite);
    } finally {
      sqlite.close();
    }
  }

  const bindingOf = (file: string) => inBooks(file, (sqlite) => sqlite.prepare("SELECT tenant_id, bound_at FROM tenant_binding").all());

  async function everyWayIn(on: Booted, victim: Company) {
    return {
      login: await signIn(on, victim),
      status: await on.send("/api/bootstrap/status", { tenant: victim.code }),
      seed: await on.send("/api/bootstrap/seed", { method: "POST", tenant: victim.code }),
      claim: await on.send("/api/bootstrap/admin", { method: "POST", tenant: victim.code, body: JSON.stringify(ATTACKER) }),
      attacker: await on.send("/api/auth/login", { method: "POST", tenant: victim.code, body: JSON.stringify({ username: ATTACKER.email, pin: ATTACKER.pin }) }),
      seedAdmin: await on.send("/api/auth/login", { method: "POST", tenant: victim.code, body: JSON.stringify({ username: "admin@cyag.example", pin: SEED_ADMIN_PIN }) }),
    };
  }

  it.each([
    ["an empty SQLite database", emptyDatabase("DELETE"), FOREIGN],
    ["an empty SQLite database left in WAL mode", emptyDatabase("WAL"), FOREIGN],
    ["a database header followed by nothing but zeros", (file: string) => writeFileSync(file, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)])), UNREADABLE],
  ])("is refused in Arabic by every route when %s is put in its place: nothing is seeded, nobody signs in, and the file is left byte for byte", async (_label, write, refusal) => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const victim = await company(first, env, "nile");
    const before = await rowOf(first, victim.tenantId);
    await first.app.close();
    const planted = replace(victim.file, write);

    const second = await boot(env);
    const answers = await everyWayIn(second, victim);

    for (const answer of Object.values(answers)) expect(answer).toEqual({ status: 503, json: refusal });
    expect(readFileSync(victim.file).equals(planted)).toBe(true);
    expect(siblingsOf(victim.file)).toEqual([]);
    expect(await rowOf(second, victim.tenantId)).toEqual(before);
  });

  it("is refused when another company's database is copied over its own: that company's owner does not sign in under this company's code", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const victim = await company(first, env, "nile");
    const other = await company(first, env, "delta");
    const before = await rowOf(first, victim.tenantId);
    await first.app.close();
    const planted = replace(victim.file, (file) => copyFileSync(other.file, file));

    const second = await boot(env);
    const answers = await everyWayIn(second, victim);
    const otherUnderVictim = await signIn(second, other, victim.code);
    const otherUnderItsOwn = await signIn(second, other);

    for (const answer of [...Object.values(answers), otherUnderVictim]) expect(answer).toEqual({ status: 503, json: FOREIGN });
    expect(otherUnderItsOwn.status).toBe(200);
    expect(readFileSync(victim.file).equals(planted)).toBe(true);
    expect(await rowOf(second, victim.tenantId)).toEqual(before);
  });

  it("binds a company's database to its tenant id while it is being provisioned", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const cloud = await boot(env);
    const fresh = await company(cloud, env, "nile");
    await cloud.app.close();

    expect(readTenantBooksIdentity(fresh.file).boundTenantId).toBe(fresh.tenantId);
  });

  describe("written by a build that did not bind databases yet", () => {
    async function unbound(env: CloudEnv, platformRow?: string, booksChange = ""): Promise<Company> {
      const first = await boot(env);
      const legacy = await company(first, env, "nile");
      await first.app.close();
      inBooks(legacy.file, (sqlite) => sqlite.exec(`DROP TABLE tenant_binding; ${booksChange}`));
      if (platformRow) inBooks(path.join(env.platformDir, "platform.db"), (sqlite) => sqlite.prepare(`UPDATE tenant SET ${platformRow} WHERE id = ?`).run(legacy.tenantId));
      expect(readTenantBooksIdentity(legacy.file).boundTenantId).toBeNull();
      return legacy;
    }

    it.each([
      ["its owner is linked on the platform by id", undefined],
      ["the platform still knows its owner by e-mail only", "owner_user_id = NULL"],
    ])("is bound once on its first open when %s, and keeps working with that same binding afterwards", async (_label, platformRow) => {
      const env = harnessEnv({}, {}, harnessDirs);
      const legacy = await unbound(env, platformRow);

      const second = await boot(env);
      expect((await signIn(second, legacy)).status).toBe(200);
      await second.app.close();
      const bound = bindingOf(legacy.file);

      const third = await boot(env);
      expect((await signIn(third, legacy)).status).toBe(200);
      await third.app.close();

      expect(bound).toEqual([{ tenant_id: legacy.tenantId, bound_at: expect.any(String) }]);
      expect(bindingOf(legacy.file)).toEqual(bound);
    });

    it.each([
      ["the owner the platform recorded by id is not an account in it", "owner_user_id = 'somebody-else'", ""],
      ["the owner the platform recorded by e-mail is nobody's address in it", "owner_user_id = NULL, owner_email = 'nobody@nile.example'", ""],
      ["the owner the platform recorded by e-mail is not a company admin in it", "owner_user_id = NULL", "UPDATE user SET is_company_admin = 0"],
      ["the owner the platform recorded by e-mail is a deactivated account in it", "owner_user_id = NULL", "UPDATE user SET status = 'inactive'"],
    ])("is refused and left unbound when %s", async (_label, platformRow, booksChange) => {
      const env = harnessEnv({}, {}, harnessDirs);
      const legacy = await unbound(env, platformRow, booksChange);
      const planted = readFileSync(legacy.file);

      const second = await boot(env);
      const answer = await signIn(second, legacy);
      await second.app.close();

      expect(answer).toEqual({ status: 503, json: FOREIGN });
      expect(readFileSync(legacy.file).equals(planted)).toBe(true);
    });
  });

  it("never seeds a served company's database, even one that is bound to it and holds nothing else: no account exists to sign in with", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const emptied = await company(first, env, "nile");
    await first.app.close();
    replace(emptied.file, (file) => inBooks(file, (sqlite) => bindTenantDatabase(sqlite, emptied.tenantId)));

    const second = await boot(env);
    const answers = await everyWayIn(second, emptied);
    await second.app.close();

    const NOT_SEEDED = { users: 0, branches: 0, warehouses: 0, taxRates: 0, fiscalPeriods: 0 };
    expect(answers.seed.json).toMatchObject(NOT_SEEDED);
    expect(answers.status.json).toMatchObject({ ...NOT_SEEDED, claimed: true });
    expect([answers.login.status, answers.attacker.status, answers.seedAdmin.status]).toEqual([401, 401, 401]);
    expect(answers.claim.status).toBe(409);
    expect(inBooks(emptied.file, (sqlite) => sqlite.prepare("SELECT COUNT(*) AS n FROM user").get())).toEqual({ n: 0 });
  });

  it("keeps the seed route closed on a served company's database whose chart of accounts was emptied under it", async () => {
    const { dataDir } = await world();
    const dbPath = path.join(dataDir, "tenants/t-bare.db");
    const backend = await createBackend({ dbPath, tenantBinding: "t-bare", seedWhenEmpty: false });
    inBooks(dbPath, (sqlite) => sqlite.exec("DELETE FROM account"));

    const seeded = (await (await backend.app.fetch(new Request("http://tenant.internal/bootstrap/seed", { method: "POST" }))).json()) as Record<string, unknown>;
    await backend.drain();
    backend.close();

    expect(seeded).toMatchObject({ accounts: 0, users: 0, branches: 0 });
  });

  it("is refused when its own database carries another tenant's binding", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const rebound = await company(first, env, "nile");
    await first.app.close();
    inBooks(rebound.file, (sqlite) => sqlite.exec("UPDATE tenant_binding SET tenant_id = 'another-tenant'"));

    const second = await boot(env);
    const answer = await signIn(second, rebound);
    await second.app.close();

    expect(answer).toEqual({ status: 503, json: FOREIGN });
    expect(bindingOf(rebound.file)).toEqual([{ tenant_id: "another-tenant", bound_at: expect.any(String) }]);
  });

  it("is refused while it is still being provisioned when the file waiting under its name is bound to another tenant", async () => {
    const { dataDir, platform } = await world();
    await createTenant({ id: "t-new", code: "newco", nameAr: "شركة جديدة", ownerEmail: "o@newco.example", now: T }, platform.stores.tenants);
    inBooks(path.join(dataDir, "tenants/t-new.db"), (sqlite) => bindTenantDatabase(sqlite, "t-other"));
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(router);

    const refused = await router.backendOf("t-new").catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(TenantDbFileForeignError);
    expect(readTenantBooksIdentity(path.join(dataDir, "tenants/t-new.db"))).toEqual({ boundTenantId: "t-other", claimed: false, users: [] });
  });

  it("is refused when a freshly seeded database nobody ever claimed is put in its place, even though the platform's recorded owner address is the seed account's", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const victim = await company(first, env, "nile");
    await first.app.close();
    for (const suffix of ["", ...SIBLINGS]) rmSync(`${victim.file}${suffix}`, { force: true });
    const seeded = await createBackend({ dbPath: victim.file });
    await seeded.drain();
    seeded.close();
    inBooks(path.join(env.platformDir, "platform.db"), (sqlite) => sqlite.prepare("UPDATE tenant SET owner_user_id = NULL, owner_email = 'admin@cyag.example' WHERE id = ?").run(victim.tenantId));

    const second = await boot(env);
    const seedAdmin = await second.send("/api/auth/login", { method: "POST", tenant: victim.code, body: JSON.stringify({ username: "admin@cyag.example", pin: SEED_ADMIN_PIN }) });
    await second.app.close();

    expect(seedAdmin).toEqual({ status: 503, json: FOREIGN });
    expect(readTenantBooksIdentity(victim.file).boundTenantId).toBeNull();
  });

  it("answers the same 503 when the database turns out to be corrupt only once it is opened for use", async () => {
    const { dataDir, platform } = await world();
    await createTenant({ id: "t-torn", code: "torn", nameAr: "شركة قائمة", ownerEmail: "o@torn.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: "t-torn", now: T }, platform.stores.tenants);
    inBooks(path.join(dataDir, "tenants/t-torn.db"), (sqlite) => bindTenantDatabase(sqlite, "t-torn"));
    const router = createTenantRouter({
      platform, dataDir, sweepEveryMs: 0, now,
      openBackend: async () => {
        throw Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" });
      },
    });
    routers.push(router);

    const res = await router.app.fetch(new Request("http://ignored/bootstrap/status", { headers: { [TENANT_HEADER]: "torn" } }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(UNREADABLE);
  });
});

describe("a database opened with no tenant to bind it to, as the desktop and its LAN tills open theirs", () => {
  it("is seeded, is claimed by its first owner once, and is never given a tenant binding", async () => {
    const { dataDir } = await world();
    const dbPath = path.join(dataDir, "mezan.db");
    const backend = await createBackend({ dbPath });
    const claim = (email: string) =>
      backend.app.fetch(new Request("http://desktop/bootstrap/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...ATTACKER, email }) }));

    const before = (await (await backend.app.fetch(new Request("http://desktop/bootstrap/status"))).json()) as Record<string, unknown>;
    const first = await claim("owner@shop.example");
    const second = await claim("other@shop.example");
    await backend.drain();
    backend.close();

    expect(before).toMatchObject({ claimed: false });
    expect(before["accounts"]).toBeGreaterThan(0);
    expect([first.status, second.status]).toEqual([201, 409]);
    expect(readTenantBooksIdentity(dbPath).boundTenantId).toBeNull();
  });
});

describe("opening a tenant stored under its code", () => {
  async function login(router: TenantRouter, code: string, pin: string | null): Promise<number> {
    const res = await router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: code },
        body: JSON.stringify({ username: `o@${code}.example`, pin }),
      }),
    );
    return res.status;
  }

  it("moves the books to the id name on the first open, and the owner still signs in to the same books", async () => {
    const { dataDir, platform } = await world();
    const first = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(first);
    const provisioned = await provisionTenant(
      { code: "legacy", nameAr: "شركة قديمة", ownerEmail: "o@legacy.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true },
      { platform, router: first, now },
    );
    await first.close();
    const { tenant } = provisioned;
    expect(tenant.dbFile).toBe(tenantDbFile(tenant.id));
    renameSync(path.join(dataDir, tenant.dbFile), path.join(dataDir, "tenants/legacy.db"));
    expect(await platform.stores.tenants.setDbFile(tenant.id, tenant.dbFile, "tenants/legacy.db")).toBe(true);

    const second = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(second);

    expect(await login(second, "legacy", provisioned.adminPin)).toBe(200);
    expect((await platform.stores.tenants.findById(tenant.id))?.dbFile).toBe(tenantDbFile(tenant.id));
    expect(existsSync(path.join(dataDir, "tenants/legacy.db"))).toBe(false);
    expect(existsSync(path.join(dataDir, tenantDbFile(tenant.id)))).toBe(true);
  });

  async function legacyTenant(dataDir: string, platform: PlatformHandle, code: string) {
    const first = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(first);
    const provisioned = await provisionTenant(
      { code, nameAr: "شركة قديمة", ownerEmail: `o@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true },
      { platform, router: first, now },
    );
    await first.close();
    const legacy = `tenants/${code}.db`;
    renameSync(path.join(dataDir, provisioned.tenant.dbFile), path.join(dataDir, legacy));
    expect(await platform.stores.tenants.setDbFile(provisioned.tenant.id, provisioned.tenant.dbFile, legacy)).toBe(true);
    return { ...provisioned, legacy };
  }

  it("answers 503 in Arabic, and repoints nothing, when a served company's database file is missing", async () => {
    const { dataDir, platform } = await world();
    const { tenant, legacy, adminPin } = await legacyTenant(dataDir, platform, "vanish");
    rmSync(path.join(dataDir, legacy));
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(router);

    const res = await router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST", headers: { "content-type": "application/json", [TENANT_HEADER]: "vanish" }, body: JSON.stringify({ username: "o@vanish.example", pin: adminPin }),
      }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "TENANT_DB_FILE_MISSING", message: "ملف بيانات المنشأة ليس في مكانه المتوقع. تواصل مع الدعم." });
    expect((await platform.stores.tenants.findById(tenant.id))?.dbFile).toBe(legacy);
    expect(existsSync(path.join(dataDir, tenantDbFile(tenant.id)))).toBe(false);
  });

  it("answers a retryable 503 in Arabic while the old file is open elsewhere, and serves the same books once it is free", async () => {
    const { dataDir, platform } = await world();
    const { legacy, adminPin } = await legacyTenant(dataDir, platform, "inuse");
    const elsewhere = openSqliteConnection(path.join(dataDir, legacy)).sqlite;
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now, dbFileWaitMs: 50 });
    routers.push(router);
    const attempt = () =>
      router.app.fetch(
        new Request("http://ignored/auth/login", {
          method: "POST", headers: { "content-type": "application/json", [TENANT_HEADER]: "inuse" }, body: JSON.stringify({ username: "o@inuse.example", pin: adminPin }),
        }),
      );

    const busy = await attempt();
    elsewhere.close();
    const free = await attempt();

    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(await busy.json()).toEqual({ error: "TENANT_DB_FILE_BUSY", message: "بيانات المنشأة قيد النقل الآن. أعد المحاولة بعد لحظات." });
    expect(free.status).toBe(200);
  });

  it("gives a company that re-registers a released code a database of its own, never the released company's", async () => {
    const { dataDir, platform } = await world();
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now });
    routers.push(router);
    const old = await provisionTenant(
      { code: "shared", nameAr: "الشركة الأولى", ownerEmail: "o@shared.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true },
      { platform, router, now },
    );
    await platform.stores.tenants.compareAndSetStatus(old.tenant, { ...old.tenant, status: TenantStatusCode.Provisioning });
    await releaseTenant({ id: old.tenant.id, now: T }, platform.stores.tenants);

    const fresh = await provisionTenant(
      { code: "shared", nameAr: "الشركة الثانية", ownerEmail: "new@shared.example", ownerNameAr: "مالك آخر", planId: "PLAN-CORE", billingCycle: "monthly", trial: true },
      { platform, router, now },
    );

    expect(fresh.tenant.id).not.toBe(old.tenant.id);
    expect(fresh.tenant.dbFile).not.toBe(old.tenant.dbFile);
    expect(fresh.adminPin).not.toBeNull();
    expect(await login(router, "shared", old.adminPin)).toBe(401);
    const signedIn = await router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: "shared" },
        body: JSON.stringify({ username: "new@shared.example", pin: fresh.adminPin }),
      }),
    );
    expect(signedIn.status).toBe(200);
  });
});
