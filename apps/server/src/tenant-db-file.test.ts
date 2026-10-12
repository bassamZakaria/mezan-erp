import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import { createTenant, releaseTenant, tenantDbFile, TenantStatusCode, type Tenant } from "@mezan/domain";
import { provisionTenant } from "./provision-tenant.js";
import { settleTenantDbFile, TenantDbFileConflictError } from "./tenant-db-file.js";
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

describe("a tenant database stored under its code", () => {
  it("is copied to the file named by the tenant id with its WAL and SHM siblings, the row follows, and only then is the old file removed", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-old", "olden");
    for (const [suffix, bytes] of [["", "MAIN"], ["-wal", "WAL"], ["-shm", "SHM"]] as const) writeFileSync(path.join(dataDir, `tenants/olden.db${suffix}`), bytes);

    const settled = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(settled.dbFile).toBe("tenants/t-old.db");
    expect((await platform.stores.tenants.findById("t-old"))?.dbFile).toBe("tenants/t-old.db");
    expect(filesIn(dataDir)).toEqual(["t-old.db", "t-old.db-shm", "t-old.db-wal"]);
    expect(readFileSync(path.join(dataDir, "tenants/t-old.db"), "utf8")).toBe("MAIN");
    expect(readFileSync(path.join(dataDir, "tenants/t-old.db-wal"), "utf8")).toBe("WAL");
    expect(readFileSync(path.join(dataDir, "tenants/t-old.db-shm"), "utf8")).toBe("SHM");
  });

  it("does nothing the second time", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-twice", "twice");
    writeFileSync(path.join(dataDir, "tenants/twice.db"), "MAIN");
    const first = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);
    const before = filesIn(dataDir);

    expect(await settleTenantDbFile(platform.stores.tenants, dataDir, first)).toBe(first);

    expect(filesIn(dataDir)).toEqual(before);
  });

  it("finishes a rename that stopped after the copy: the same bytes at both names are adopted, not copied again", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-half", "halfway");
    writeFileSync(path.join(dataDir, "tenants/halfway.db"), "MAIN");
    writeFileSync(path.join(dataDir, "tenants/t-half.db"), "MAIN");

    const settled = await settleTenantDbFile(platform.stores.tenants, dataDir, tenant);

    expect(settled.dbFile).toBe("tenants/t-half.db");
    expect(filesIn(dataDir)).toEqual(["t-half.db"]);
  });

  it("refuses when a different file already sits at the id name, and touches neither file nor the row", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-clash", "clash");
    writeFileSync(path.join(dataDir, "tenants/clash.db"), "THE REAL BOOKS");
    writeFileSync(path.join(dataDir, "tenants/t-clash.db"), "SOMETHING ELSE");

    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).rejects.toBeInstanceOf(TenantDbFileConflictError);

    expect(readFileSync(path.join(dataDir, "tenants/clash.db"), "utf8")).toBe("THE REAL BOOKS");
    expect(readFileSync(path.join(dataDir, "tenants/t-clash.db"), "utf8")).toBe("SOMETHING ELSE");
    expect((await platform.stores.tenants.findById("t-clash"))?.dbFile).toBe("tenants/clash.db");
  });

  it("refuses when a stray WAL sits at the id name with no source to match it", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-stray", "stray");
    writeFileSync(path.join(dataDir, "tenants/stray.db"), "MAIN");
    writeFileSync(path.join(dataDir, "tenants/t-stray.db-wal"), "ORPHAN");

    await expect(settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).rejects.toBeInstanceOf(TenantDbFileConflictError);

    expect(existsSync(path.join(dataDir, "tenants/stray.db"))).toBe(true);
    expect((await platform.stores.tenants.findById("t-stray"))?.dbFile).toBe("tenants/stray.db");
  });

  it("only renames the row of a tenant whose database was never created", async () => {
    const { dataDir, platform } = await world();
    const tenant = await storedByCode(platform, "t-new", "neverup");

    expect((await settleTenantDbFile(platform.stores.tenants, dataDir, tenant)).dbFile).toBe("tenants/t-new.db");

    expect(filesIn(dataDir)).toEqual([]);
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
