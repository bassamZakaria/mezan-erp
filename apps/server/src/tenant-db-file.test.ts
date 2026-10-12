import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import { activateTenant, createTenant, releaseTenant, tenantDbFile, TenantStatusCode, type Tenant } from "@mezan/domain";
import { holdSqliteFile, openSqliteConnection } from "@mezan/persistence";
import { provisionTenant } from "./provision-tenant.js";
import {
  settleTenantDbFile,
  sha256OfFile,
  TenantDbFileBusyError,
  TenantDbFileConflictError,
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
