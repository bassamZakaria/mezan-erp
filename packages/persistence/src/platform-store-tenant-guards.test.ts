import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { InvalidTenantError, TenantStatusCode, type Tenant } from "@mezan/domain";
import { createSqlitePlatformStores } from "./platform-store.js";

const NOW = "2026-10-13T10:00:00.000Z";
const LATER = "2026-10-13T11:00:00.000Z";

function tenant(id: string, code: string, dbFile = `tenants/${id}.db`): Tenant {
  return {
    id, code, nameAr: "شركة", nameEn: null, ownerEmail: `o@${code}.example`, status: TenantStatusCode.Provisioning,
    ownerUserId: null, ownerContactVerified: true, dbFile, createdAt: NOW, updatedAt: NOW,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("one database file per tenant", () => {
  it("refuses a second tenant that would name a file another tenant's row already names, in Arabic", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant("t-a", "alpha", "tenants/shared.db"));

    const refused = await stores.tenants.save(tenant("t-b", "bravo", "tenants/shared.db")).catch((err: unknown) => err);

    expect(refused).toBeInstanceOf(InvalidTenantError);
    expect((refused as Error).message).toContain("ملف قاعدة بيانات هذه المنشأة مسجّل لمنشأة أخرى");
    expect((await stores.tenants.list()).map((row) => row.id)).toEqual(["t-a"]);
  });

  it("never repoints a row at a file another tenant's row names", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant("t-a", "alpha"));
    await stores.tenants.save(tenant("t-b", "bravo"));

    expect(await stores.tenants.setDbFile("t-b", "tenants/t-b.db", "tenants/t-a.db")).toBe(false);

    expect((await stores.tenants.findById("t-b"))?.dbFile).toBe("tenants/t-b.db");
  });

  it("refuses to start on a platform database where two rows already name one file, and names both rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-platform-dup-"));
    dirs.push(dir);
    const file = path.join(dir, "platform.db");
    const first = createSqlitePlatformStores(file);
    await first.tenants.save(tenant("t-a", "alpha"));
    await first.tenants.save(tenant("t-b", "bravo"));
    first.close();
    const raw = new Database(file);
    raw.exec("DROP INDEX idx_tenant_db_file");
    raw.exec("UPDATE tenant SET db_file = 'tenants/alpha.db'");
    raw.close();

    expect(() => createSqlitePlatformStores(file)).toThrow(/tenants\/alpha\.db.*t-a.*t-b/s);

    const untouched = new Database(file);
    expect(untouched.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_tenant_db_file'").all()).toEqual([]);
    untouched.close();
  });
});

describe("a tenant's status and code move only from the state the writer read", () => {
  it("writes nothing when the stored status is no longer the one read", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    const read = tenant("t-a", "alpha");
    await stores.tenants.save({ ...read, status: TenantStatusCode.Archived, code: "released-t-a" });

    const moved = await stores.tenants.compareAndSetStatus(read, { ...read, status: TenantStatusCode.Active, updatedAt: LATER });

    expect(moved).toBe(false);
    expect(await stores.tenants.findById("t-a")).toMatchObject({ status: TenantStatusCode.Archived, code: "released-t-a", updatedAt: NOW });
  });

  it("writes nothing when the stored code is no longer the one read", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    const read = tenant("t-a", "alpha");
    await stores.tenants.save({ ...read, code: "renamed" });

    const moved = await stores.tenants.compareAndSetStatus(read, { ...read, status: TenantStatusCode.Active, updatedAt: LATER });

    expect(moved).toBe(false);
    expect(await stores.tenants.findById("t-a")).toMatchObject({ status: TenantStatusCode.Provisioning, code: "renamed" });
  });

  it("moves the row that is still as it was read", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    const read = tenant("t-a", "alpha");
    await stores.tenants.save(read);

    expect(await stores.tenants.compareAndSetStatus(read, { ...read, status: TenantStatusCode.Active, updatedAt: LATER })).toBe(true);
    expect(await stores.tenants.findById("t-a")).toMatchObject({ status: TenantStatusCode.Active, updatedAt: LATER });
  });
});
