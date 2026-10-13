import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createSessionRegistry, createSourceThrottle, type SourceThrottle } from "@mezan/api";
import { createTenant, activateTenant, archiveTenant, suspendTenant, startSubscription, changePlan, LicenseReasonCode, tenantIsServed } from "@mezan/domain";
import { bindTenantDatabase, openSqliteConnection } from "@mezan/persistence";
import type { SessionDTO } from "@mezan/contracts";
import { createTenantRouter, type TenantRouter } from "./tenant-router.js";
import { TENANT_HEADER } from "./tenant-resolver.js";
import { originEnv, type CloudSource } from "./client-source.js";
import { reachable } from "./cloud-harness.js";

const T = new Date("2026-01-15T00:00:00.000Z").toISOString();

const platforms: PlatformHandle[] = [];
const dirs: string[] = [];
const routers: TenantRouter[] = [];
afterEach(async () => {
  for (const r of routers.splice(0)) await r.close();
  for (const p of platforms.splice(0)) p.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function seedPlatform() {
  const platform = await createPlatform({ dbPath: ":memory:" });
  platforms.push(platform);

  const cyag = await createTenant(
    { id: "t-cyag", code: "cyag", nameAr: "سياج", ownerEmail: "owner@cyag.example", now: T },
    platform.stores.tenants,
  );
  await activateTenant({ id: cyag.id, now: T }, platform.stores.tenants);
  await startSubscription(
    { id: "sub-cyag", tenantId: cyag.id, planId: "PLAN-ENTERPRISE", billingCycle: "monthly", now: T },
    platform.stores.subscriptions,
    platform.stores.plans,
  );

  const nile = await createTenant(
    { id: "t-nile", code: "nile", nameAr: "النيل", ownerEmail: "owner@nile.example", now: T },
    platform.stores.tenants,
  );
  await activateTenant({ id: nile.id, now: T }, platform.stores.tenants);
  await startSubscription(
    { id: "sub-nile", tenantId: nile.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T },
    platform.stores.subscriptions,
    platform.stores.plans,
  );

  const old = await createTenant(
    { id: "t-old", code: "old", nameAr: "قديمة", ownerEmail: "owner@old.example", now: T },
    platform.stores.tenants,
  );
  await activateTenant({ id: old.id, now: T }, platform.stores.tenants);
  await archiveTenant({ id: old.id, now: T }, platform.stores.tenants);

  await createTenant(
    { id: "t-new", code: "new", nameAr: "جديدة", ownerEmail: "owner@new.example", now: T },
    platform.stores.tenants,
  );

  const susp = await createTenant(
    { id: "t-susp", code: "susp", nameAr: "موقوفة", ownerEmail: "owner@susp.example", now: T },
    platform.stores.tenants,
  );
  await activateTenant({ id: susp.id, now: T }, platform.stores.tenants);
  await startSubscription(
    { id: "sub-susp", tenantId: susp.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T },
    platform.stores.subscriptions,
    platform.stores.plans,
  );
  await suspendTenant({ id: susp.id, now: T }, platform.stores.tenants);

  return platform;
}

async function dataDirWithBooks(platform: PlatformHandle, prefix: string): Promise<string> {
  const dataDir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dataDir);
  mkdirSync(path.join(dataDir, "tenants"), { recursive: true });
  for (const tenant of await platform.stores.tenants.list()) {
    if (!tenantIsServed(tenant)) continue;
    const { sqlite } = openSqliteConnection(path.join(dataDir, tenant.dbFile));
    bindTenantDatabase(sqlite, tenant.id);
    sqlite.close();
  }
  return dataDir;
}

async function newRouter(
  platform: PlatformHandle,
  opts: {
    tenantDomain?: string;
    trustForwardedHost?: boolean;
    trustedProxyHops?: number;
    trustViewerAddress?: boolean;
    signInSources?: SourceThrottle;
    allowTenantHeader?: boolean;
    idleMs?: number;
    ttlMs?: number;
    now?: () => Date;
    platformClaimGuard?: boolean;
  } = {},
): Promise<{ router: TenantRouter; opened: BackendHandle[] }> {
  const dataDir = await dataDirWithBooks(platform, "mezan-tenant-router-");
  const opened: BackendHandle[] = [];
  const router = createTenantRouter({
    platform,
    dataDir,
    tenantDomain: opts.tenantDomain,
    trustForwardedHost: opts.trustForwardedHost,
    clientSource: { trustedProxyHops: opts.trustedProxyHops ?? 0, trustViewerAddress: opts.trustViewerAddress === true, compareViewerAddress: false },
    allowTenantHeader: opts.allowTenantHeader,
    signInSources: opts.signInSources,
    idleMs: opts.idleMs,
    ttlMs: opts.ttlMs,
    sweepEveryMs: 0,
    now: opts.now ?? (() => new Date(T)),
    openBackend: async (_code, _dbPath, resolvers, hooks) => {
      const handle = await createBackend({
        dbPath: ":memory:",
        resolveEntitlements: () => resolvers.resolveEntitlements(),
        resolveLicenseState: () => resolvers.resolveLicenseState(),
        ...(opts.platformClaimGuard ? { claimedElsewhere: hooks.claimedElsewhere } : {}),
      });
      const spied: BackendHandle = { ...handle, close: vi.fn(handle.close) };
      opened.push(spied);
      return spied;
    },
  });
  routers.push(router);
  reachable(router.app, opts.trustedProxyHops ?? 0);
  return { router, opened };
}

async function bootstrapAdmin(router: TenantRouter, code: string): Promise<string> {
  const backend = await router.backendFor(code);
  const res = await backend.app.fetch(
    new Request("http://tenant.internal/bootstrap/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nameAr: "المدير", email: `owner-${code}@example.com`, pin: "123456", companyName: "متجر الاختبار" }),
    }),
  );
  expect(res.status).toBe(201);
  const signedIn = await router.app.fetch(
    new Request("http://ignored/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", [TENANT_HEADER]: code },
      body: JSON.stringify({ username: `owner-${code}@example.com`, pin: "123456" }),
    }),
  );
  expect(signedIn.status).toBe(200);
  const session = (await signedIn.json()) as SessionDTO;
  return session.token;
}

describe("createTenantRouter", () => {
  describe("GET /platform/resolve", () => {
    it("reports mode subdomain and exists true when the host names a live tenant — never its name", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "cyag.mezan.test" } }));
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ mode: "subdomain", exists: true });
      expect(body).not.toContain("سياج");
    });

    it("reports mode code and exists false when the host does not name one and no header is sent", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "localhost" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "code", exists: false });
    });

    it("reports exists true for the tenant named by the header — never its name", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(
        new Request("http://ignored/platform/resolve", { headers: { host: "localhost", [TENANT_HEADER]: "nile" } }),
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ mode: "code", exists: true });
      expect(body).not.toContain("النيل");
    });

    it.each(["new", "old"])("gives exists false for %s (provisioning/archived) even though the code is valid", async (code) => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { [TENANT_HEADER]: code } }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { exists: unknown }).exists).toBe(false);
    });
  });

  describe("GET /tenant", () => {
    it("refuses with 400 TENANT_REQUIRED when no code is given", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" });
    });

    it("refuses with 404 TENANT_NOT_FOUND for an unknown code", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "ghost" } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" });
    });

    it.each(["old", "new"])("refuses with 404 TENANT_NOT_FOUND for tenant %s (archived/provisioning)", async (code) => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: code } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "TENANT_NOT_FOUND" });
    });

    it("dispatches to the tenant's own backend for a live tenant", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(200);
      /** The backend's own seeded settings name the company, independent of the platform tenant's `nameAr`. */
      expect(await res.json()).toEqual({ name: "Cyag" });
    });
  });

  describe("tenant isolation", () => {
    it("keeps each tenant's data in its own backend", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      const cyagToken = await bootstrapAdmin(router, "cyag");
      const nileToken = await bootstrapAdmin(router, "nile");

      const createRes = await router.app.fetch(
        new Request("http://ignored/customers", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cyagToken}`,
            [TENANT_HEADER]: "cyag",
          },
          body: JSON.stringify({ id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة" }),
        }),
      );
      expect(createRes.status).toBe(201);

      const nileList = await router.app.fetch(
        new Request("http://ignored/customers", {
          headers: { authorization: `Bearer ${nileToken}`, [TENANT_HEADER]: "nile" },
        }),
      );
      expect(nileList.status).toBe(200);
      expect((await nileList.json()) as unknown[]).toEqual([]);

      const cyagList = await router.app.fetch(
        new Request("http://ignored/customers", {
          headers: { authorization: `Bearer ${cyagToken}`, [TENANT_HEADER]: "cyag" },
        }),
      );
      expect(cyagList.status).toBe(200);
      expect(((await cyagList.json()) as unknown[]).length).toBe(1);
    });
  });

  describe("module gate", () => {
    it("refuses an unlicensed module on a core plan tenant and allows it on a business/enterprise tenant", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      const cyagToken = await bootstrapAdmin(router, "cyag");
      const nileToken = await bootstrapAdmin(router, "nile");

      const nileRes = await router.app.fetch(
        new Request("http://ignored/crm/leads", {
          headers: { authorization: `Bearer ${nileToken}`, [TENANT_HEADER]: "nile" },
        }),
      );
      expect(nileRes.status).toBe(403);
      expect(await nileRes.json()).toMatchObject({ error: "MODULE_NOT_LICENSED" });

      const cyagRes = await router.app.fetch(
        new Request("http://ignored/crm/leads", {
          headers: { authorization: `Bearer ${cyagToken}`, [TENANT_HEADER]: "cyag" },
        }),
      );
      expect(cyagRes.status).toBe(200);
    });
  });

  describe("dispatch path stripping", () => {
    it("still reaches the tenant backend's own route when the router is nested under a parent mount", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      const parent = reachable(new Hono());
      parent.route("/api", router.app);

      const res = await parent.fetch(new Request("http://ignored/api/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ name: "Cyag" });
    });
  });

  describe("close", () => {
    it("closes every backend it opened", async () => {
      const platform = await seedPlatform();
      const { router, opened } = await newRouter(platform);

      await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "nile" } }));
      expect(opened.length).toBe(2);

      await router.close();
      for (const handle of opened) {
        expect(handle.close).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("backendFor", () => {
    it("refuses an archived tenant", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      await expect(router.backendFor("old")).rejects.toThrow();
    });

    it("refuses an archived tenant even after its backend was already cached", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "susp" } }));
      await archiveTenant({ id: "t-susp", now: T }, platform.stores.tenants);

      await expect(router.backendFor("susp")).rejects.toThrow();
    });

    it("opens a provisioning tenant's own backend even though the public dispatcher 404s on it", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      const backend = await router.backendFor("new");
      expect(backend.app).toBeTruthy();

      const dispatchRes = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "new" } }));
      expect(dispatchRes.status).toBe(404);
    });
  });

  describe("the connection a tenant's database is opened with", () => {
    it("may create the database of a tenant still being provisioned, and only opens an existing one for every tenant that was ever served", async () => {
      const platform = await seedPlatform();
      const dataDir = await dataDirWithBooks(platform, "mezan-tenant-router-conn-");
      const mustExist = new Map<string, boolean | undefined>();
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        connection: { exclusive: true },
        openBackend: async (code, _dbPath, resolvers, _hooks, connection) => {
          expect(connection.exclusive).toBe(true);
          mustExist.set(code, connection.fileMustExist);
          return createBackend({ dbPath: ":memory:", resolveEntitlements: () => resolvers.resolveEntitlements(), resolveLicenseState: () => resolvers.resolveLicenseState() });
        },
      });
      routers.push(router);

      await router.backendFor("new");
      await router.backendFor("cyag");
      await router.backendFor("susp");

      expect([...mustExist]).toEqual([["new", false], ["cyag", true], ["susp", true]]);
    });
  });

  describe("openTenants", () => {
    it("lists only tenants with a currently cached backend, by id and code, and drops one closed", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      expect(router.openTenants()).toEqual([]);

      await router.backendFor("cyag");
      await router.backendFor("nile");
      expect(router.openTenants().map((tenant) => tenant.code).sort()).toEqual(["cyag", "nile"]);
      for (const tenant of router.openTenants()) expect((await platform.stores.tenants.findByCode(tenant.code))?.id).toBe(tenant.id);

      await router.close();
      expect(router.openTenants()).toEqual([]);
    });
  });

  describe("dispatch preserves encoded path segments", () => {
    async function stubRouter(platform: PlatformHandle): Promise<{ router: TenantRouter; captured: string[] }> {
      const dataDir = await dataDirWithBooks(platform, "mezan-tenant-router-stub-");
      const captured: string[] = [];
      const stub = new Hono();
      stub.all("/*", (c) => {
        captured.push(new URL(c.req.raw.url).pathname);
        return c.json({ ok: true });
      });
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        openBackend: async () => ({ app: stub, audit: { append: vi.fn(), query: vi.fn() }, sessions: createSessionRegistry(), credentialsResetByAdministrator: vi.fn(), lockedAccounts: vi.fn(() => []), unlockAccount: vi.fn(async () => false), ownerAccount: vi.fn(async () => null), companyAdmins: vi.fn(async () => []), recordOwnerAssigned: vi.fn(), resetOwnerPin: vi.fn(), backupTo: vi.fn(), drain: vi.fn(), close: vi.fn() }),
      });
      routers.push(router);
      reachable(router.app);
      return { router, captured };
    }

    it("forwards a %2F-escaped path segment undecoded, direct and nested under a parent mount", async () => {
      const platform = await seedPlatform();
      const { router, captured } = await stubRouter(platform);

      await router.app.fetch(new Request("http://ignored/customers/a%2Fb", { headers: { [TENANT_HEADER]: "cyag" } }));

      const parent = reachable(new Hono());
      parent.route("/api", router.app);
      await parent.fetch(new Request("http://ignored/api/customers/a%2Fb", { headers: { [TENANT_HEADER]: "cyag" } }));

      expect(captured).toEqual(["/customers/a%2Fb", "/customers/a%2Fb"]);
    });
  });

  describe("errors", () => {
    it("answers 500 INTERNAL, in Arabic, for an unexpected thrown error", async () => {
      const platform = await seedPlatform();
      const dataDir = await dataDirWithBooks(platform, "mezan-tenant-router-err-");
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        openBackend: async () => { throw new Error("boom"); },
      });
      routers.push(router);
      reachable(router.app);

      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "INTERNAL", message: "حدث خطأ غير متوقع" });
    });

    it("maps a TENANT_NOT_FOUND thrown from opening the backend to the 404 body", async () => {
      const platform = await seedPlatform();
      const dataDir = await dataDirWithBooks(platform, "mezan-tenant-router-err2-");
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        openBackend: async () => { throw new Error("TENANT_NOT_FOUND"); },
      });
      routers.push(router);
      reachable(router.app);

      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" });
    });
  });

  describe("a suspended tenant", () => {
    it("still dispatches reads (200) but has its writes refused by the licence gate", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);

      const readRes = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "susp" } }));
      expect(readRes.status).toBe(200);

      const writeRes = await router.app.fetch(
        new Request("http://ignored/customers", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: "susp" },
          body: JSON.stringify({ id: "c-susp", code: "C000001", nameAr: "عميل" }),
        }),
      );
      expect(writeRes.status).toBe(403);
      expect(await writeRes.json()).toMatchObject({ error: "LICENSE_READ_ONLY" });
    });

    it.each(["/bootstrap/admin", "/bootstr%61p/admin"])("refuses an anonymous claim at %s: a served tenant has an owner on the platform, whatever its database holds", async (route) => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { platformClaimGuard: true });

      const res = await router.app.fetch(
        new Request(`http://ignored${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: "susp" },
          body: JSON.stringify({ nameAr: "المدير", email: "owner-susp@example.com", pin: "123456", companyName: "متجر الاختبار" }),
        }),
      );
      const status = await router.app.fetch(new Request("http://ignored/bootstrap/status", { headers: { [TENANT_HEADER]: "susp" } }));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "TENANT_ALREADY_PROVISIONED", message: "تم إعداد هذه المنشأة بالفعل. سجّل الدخول بحسابك." });
      expect(await status.json()).toMatchObject({ claimed: true, users: 1 });
    });

    it("leaves a tenant still being provisioned claimable by the platform's own provisioning, which reaches its backend directly", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { platformClaimGuard: true });

      const backend = await router.backendFor("new");
      const status = await backend.app.fetch(new Request("http://tenant.internal/bootstrap/status"));

      expect(await status.json()).toMatchObject({ claimed: false });
    });
  });

  describe("a stored status this build does not know", () => {
    async function filePlatform() {
      const dir = mkdtempSync(path.join(tmpdir(), "mezan-unknown-status-"));
      dirs.push(dir);
      const dbPath = path.join(dir, "platform.db");
      const platform = await createPlatform({ dbPath });
      platforms.push(platform);
      for (const code of ["frozen", "gone", "fine"]) {
        const tenant = await createTenant({ id: `t-${code}`, code, nameAr: `منشأة ${code}`, ownerEmail: `owner@${code}.example`, now: T }, platform.stores.tenants);
        await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
        await startSubscription({ id: `sub-${code}`, tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
      }
      const raw = openSqliteConnection(dbPath).sqlite;
      raw.prepare("UPDATE subscription SET status = 'frozen' WHERE id = 'sub-frozen'").run();
      raw.prepare("UPDATE tenant SET status = 'terminated' WHERE id = 't-gone'").run();
      raw.close();
      return platform;
    }

    const writeCustomer = (router: TenantRouter, code: string) =>
      router.app.fetch(
        new Request("http://ignored/customers", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: code },
          body: JSON.stringify({ id: `c-${code}`, code: "C000001", nameAr: "عميل" }),
        }),
      );

    it.each(["frozen", "gone"])("keeps %s readable, refuses its writes and names the reason in Arabic", async (code) => {
      const { router } = await newRouter(await filePlatform());

      const read = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: code } }));
      expect(read.status).toBe(200);
      const write = await writeCustomer(router, code);
      expect(write.status).toBe(403);
      expect(await write.json()).toMatchObject({ error: "LICENSE_READ_ONLY" });
      const license = await router.app.fetch(new Request("http://ignored/license/state", { headers: { [TENANT_HEADER]: code } }));
      expect(await license.json()).toMatchObject({
        state: "READ_ONLY", canWrite: false, reason: LicenseReasonCode.StatusUnknown, messageAr: "حالة الاشتراك غير معروفة — تواصل مع الدعم",
      });
    });

    it("answers the sign-in lookup the same way the router dispatches: both tenants exist", async () => {
      const { router } = await newRouter(await filePlatform());
      for (const code of ["frozen", "gone", "fine"]) {
        const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { [TENANT_HEADER]: code } }));
        expect(await res.json()).toMatchObject({ exists: true });
      }
    });

    it("leaves a tenant whose statuses are known writable", async () => {
      const { router } = await newRouter(await filePlatform());
      const write = await writeCustomer(router, "fine");
      expect(write.status).not.toBe(403);
    });

    it("still counts the unknown subscription as the tenant's one live subscription", async () => {
      const platform = await filePlatform();
      await expect(
        startSubscription({ id: "sub-second", tenantId: "t-frozen", planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans),
      ).rejects.toThrow();
    });
  });

  describe("cache eviction", () => {
    it("still sweeps an idle tenant after the console's list reconciled every open tenant's owner", async () => {
      const platform = await seedPlatform();
      let t = new Date(T).getTime();
      const { router } = await newRouter(platform, { idleMs: 1000, ttlMs: 60_000, now: () => new Date(t) });
      await router.backendFor("nile");
      expect(router.openTenants().map((tenant) => tenant.code)).toEqual(["nile"]);

      t += 900;
      await router.reconcileOpenOwners();
      t += 101;
      await router.sweep();

      expect(router.openTenants()).toEqual([]);
    });


    it("rebuilds a tenant's resolver after its backend is evicted for being idle", async () => {
      const platform = await seedPlatform();
      let t = new Date(T).getTime();
      const { router } = await newRouter(platform, { idleMs: 1000, ttlMs: 60_000, now: () => new Date(t) });

      const firstToken = await bootstrapAdmin(router, "nile");
      const staleRes = await router.app.fetch(
        new Request("http://ignored/crm/leads", { headers: { authorization: `Bearer ${firstToken}`, [TENANT_HEADER]: "nile" } }),
      );
      expect(staleRes.status).toBe(403);

      await changePlan({ id: "sub-nile", planId: "PLAN-BUSINESS", now: new Date(t).toISOString() }, platform.stores.subscriptions, platform.stores.plans);

      const stillStaleRes = await router.app.fetch(
        new Request("http://ignored/crm/leads", { headers: { authorization: `Bearer ${firstToken}`, [TENANT_HEADER]: "nile" } }),
      );
      expect(stillStaleRes.status).toBe(403);

      t += 1001;
      await router.sweep();

      const freshToken = await bootstrapAdmin(router, "nile");
      const freshRes = await router.app.fetch(
        new Request("http://ignored/crm/leads", { headers: { authorization: `Bearer ${freshToken}`, [TENANT_HEADER]: "nile" } }),
      );
      expect(freshRes.status).toBe(200);
    });
  });

  describe("tenant sign-in from one address", () => {
    interface From {
      readonly forwardedFor?: string;
      readonly viewer?: string;
      readonly pin?: string;
      readonly token?: string;
    }
    const send = (router: TenantRouter, code: string, method: string, path: string, from: From, body?: unknown) =>
      router.app.fetch(
        new Request(`http://ignored${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            [TENANT_HEADER]: code,
            ...(from.forwardedFor === undefined ? {} : { "x-forwarded-for": from.forwardedFor }),
            ...(from.viewer === undefined ? {} : { "cloudfront-viewer-address": from.viewer }),
            ...(from.token === undefined ? {} : { authorization: `Bearer ${from.token}` }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const signIn = (router: TenantRouter, code: string, username: string, forwardedFor: string, pin = "000000", viewer?: string) =>
      send(router, code, "POST", "/auth/login", { forwardedFor, viewer }, { username, pin });
    const EDGE = "130.176.0.7";

    it("holds an address after thirty failures in one tenant, and leaves it free in every other", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 1 });
      await bootstrapAdmin(router, "cyag");
      await bootstrapAdmin(router, "nile");
      for (let i = 0; i < 30; i += 1) {
        expect((await signIn(router, "cyag", `ghost${i}@example.com`, "203.0.113.9")).status).toBe(401);
      }
      expect((await signIn(router, "cyag", "ghost30@example.com", "203.0.113.9")).status).toBe(429);

      const held = await signIn(router, "cyag", "owner-cyag@example.com", "203.0.113.9", "123456");
      const elsewhere = await signIn(router, "cyag", "owner-cyag@example.com", "198.51.100.4", "123456");
      const otherTenant = await signIn(router, "nile", "owner-nile@example.com", "203.0.113.9", "123456");

      expect(held.status).toBe(429);
      expect(await held.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS", message: expect.stringContaining("محاولات دخول كثيرة") });
      expect(held.headers.get("retry-after")).toBe("60");
      expect(elsewhere.status).toBe(200);
      expect(otherTenant.status).toBe(200);
    }, 120_000);

    it("holds an address that sweeps across tenants before it has reached any one tenant's own limit", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 1, signInSources: createSourceThrottle(() => Date.parse(T), 40) });
      await bootstrapAdmin(router, "cyag");
      await bootstrapAdmin(router, "nile");
      const statuses: number[] = [];
      for (let i = 0; i < 25; i += 1) statuses.push((await signIn(router, "cyag", `ghost${i}@example.com`, "203.0.113.9")).status);
      for (let i = 0; i < 20; i += 1) statuses.push((await signIn(router, "nile", `ghost${i}@example.com`, "203.0.113.9")).status);

      expect(statuses.slice(0, 41)).toEqual(Array<number>(41).fill(401));
      expect(statuses.slice(41)).toEqual(Array<number>(4).fill(429));
      const held = await signIn(router, "nile", "owner-nile@example.com", "203.0.113.9", "123456");
      expect(held.status).toBe(429);
      expect(await held.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS" });
      expect((await signIn(router, "nile", "owner-nile@example.com", "198.51.100.4", "123456")).status).toBe(200);
    }, 120_000);

    it("ignores a forwarded address it was not told to trust", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform);
      await bootstrapAdmin(router, "cyag");
      for (let i = 0; i < 31; i += 1) await signIn(router, "cyag", `ghost${i}@example.com`, "203.0.113.9");

      const sameSocket = await signIn(router, "cyag", "owner-cyag@example.com", "198.51.100.4", "123456");
      const otherSocket = await router.app.fetch(
        new Request("http://ignored/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: "cyag", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ username: "owner-cyag@example.com", pin: "123456" }),
        }),
        originEnv("10.0.7.7" as CloudSource),
      );

      expect(sameSocket.status).toBe(429);
      expect(otherSocket.status).toBe(200);
    }, 120_000);

    it("refuses a caller with no address at all rather than treating it as the host's own console", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");

      const oneHopShort = await signIn(router, "cyag", "owner-cyag@example.com", EDGE, "123456");
      const notAnAddress = await signIn(router, "cyag", "owner-cyag@example.com", `unknown, ${EDGE}`, "123456");

      expect(oneHopShort.status).toBe(503);
      expect(await oneHopShort.json()).toMatchObject({ error: "SOURCE_UNRESOLVED", message: expect.stringContaining("مصدر الطلب") });
      expect(notAnAddress.status).toBe(503);
    }, 120_000);

    it("counts a client that rotates the hop it wrote itself as the one address it is", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");
      const statuses: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        statuses.push((await signIn(router, "cyag", `ghost${i}@example.com`, `10.9.0.${i}, 41.33.10.10, ${EDGE}`)).status);
      }

      expect(statuses.slice(0, 30)).toEqual(Array<number>(30).fill(401));
      expect(statuses.slice(30)).toEqual(Array<number>(10).fill(429));
    }, 120_000);

    it("does not hold an office because somebody else wrote its address ahead of their own", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");
      for (let i = 0; i < 31; i += 1) await signIn(router, "cyag", `ghost${i}@example.com`, `196.221.5.5, 41.33.10.10, ${EDGE}`);

      const office = await signIn(router, "cyag", "owner-cyag@example.com", `196.221.5.5, ${EDGE}`, "123456");
      const attacker = await signIn(router, "cyag", "owner-cyag@example.com", `41.33.10.10, ${EDGE}`, "123456");

      expect(office.status).toBe(200);
      expect(attacker.status).toBe(429);
    }, 120_000);

    it("leaves the owner able to sign in from the office after six wrong PINs sent from somewhere else", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");
      for (let i = 0; i < 6; i += 1) await signIn(router, "cyag", "owner-cyag@example.com", `41.33.10.10, ${EDGE}`, "111111");

      const office = await signIn(router, "cyag", "owner-cyag@example.com", `196.221.5.5, ${EDGE}`, "123456");
      const attacker = await signIn(router, "cyag", "owner-cyag@example.com", `41.33.10.10, ${EDGE}`, "123456");

      expect(office.status).toBe(200);
      expect(attacker.status).toBe(429);
      expect(await attacker.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS" });
    }, 120_000);

    it("refuses a tenant session presented from an address other than the one that signed in", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");
      const office = `196.221.5.5, ${EDGE}`;
      const session = (await (await signIn(router, "cyag", "owner-cyag@example.com", office, "123456")).json()) as SessionDTO;

      const fromTheOffice = await send(router, "cyag", "GET", "/item-brands", { forwardedFor: office, token: session.token });
      const stolen = await send(router, "cyag", "GET", "/item-brands", { forwardedFor: `41.33.10.10, ${EDGE}`, token: session.token });
      const afterwards = await send(router, "cyag", "GET", "/item-brands", { forwardedFor: office, token: session.token });

      expect(fromTheOffice.status).toBe(200);
      expect(stolen.status).toBe(401);
      expect(afterwards.status).toBe(401);
    }, 120_000);

    it("reads the address CloudFront set when told to trust it, whatever the forwarded chain says", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2, trustViewerAddress: true });
      await bootstrapAdmin(router, "cyag");
      for (let i = 0; i < 31; i += 1) await signIn(router, "cyag", `ghost${i}@example.com`, `10.9.0.${i}, ${EDGE}`, "000000", "41.33.10.10:50000");

      const held = await signIn(router, "cyag", "owner-cyag@example.com", `8.8.8.8, ${EDGE}`, "123456", "41.33.10.10:50123");
      const office = await signIn(router, "cyag", "owner-cyag@example.com", `8.8.8.8, ${EDGE}`, "123456", "196.221.5.5:50123");

      expect(held.status).toBe(429);
      expect(office.status).toBe(200);
    }, 120_000);

    it("signs the owner in within a second while a thousand sign-ins arrive from another address", async () => {
      const platform = await seedPlatform();
      const { router } = await newRouter(platform, { trustForwardedHost: true, trustedProxyHops: 2 });
      await bootstrapAdmin(router, "cyag");
      await signIn(router, "cyag", "owner-cyag@example.com", `196.221.5.5, ${EDGE}`, "123456");
      await signIn(router, "cyag", "nobody@example.com", `198.51.100.4, ${EDGE}`);

      const flood = Array.from({ length: 1000 }, (_, i) => signIn(router, "cyag", `ghost${i}@example.com`, `41.33.10.10, ${EDGE}`));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const started = performance.now();
      const owner = await signIn(router, "cyag", "owner-cyag@example.com", `196.221.5.5, ${EDGE}`, "123456");
      const ownerMs = performance.now() - started;
      const answers = await Promise.all(flood);

      expect(owner.status).toBe(200);
      expect(ownerMs).toBeLessThan(1000);
      const busy = answers.filter((answer) => answer.status === 503);
      const held = answers.filter((answer) => answer.status === 429);
      expect(busy.length + held.length).toBeGreaterThan(900);
      expect(await busy[0]!.json()).toMatchObject({ error: "SIGN_IN_BUSY", message: expect.stringContaining("مشغول") });
      expect(busy[0]!.headers.get("retry-after")).not.toBeNull();
      for (const answer of held.slice(0, 3)) expect(await answer.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS" });
      expect(answers.filter((answer) => ![401, 429, 503].includes(answer.status))).toEqual([]);
    }, 120_000);
  });
});
