import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createSessionRegistry } from "@mezan/api";
import { createTenant, activateTenant, archiveTenant, suspendTenant, startSubscription, changePlan } from "@mezan/domain";
import type { SessionDTO } from "@mezan/contracts";
import { createTenantRouter, type TenantRouter } from "./tenant-router.js";
import { TENANT_HEADER } from "./tenant-resolver.js";

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

function newRouter(
  platform: PlatformHandle,
  opts: {
    tenantDomain?: string;
    trustForwardedHost?: boolean;
    allowTenantHeader?: boolean;
    idleMs?: number;
    ttlMs?: number;
    now?: () => Date;
  } = {},
): { router: TenantRouter; opened: BackendHandle[] } {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-tenant-router-"));
  dirs.push(dataDir);
  const opened: BackendHandle[] = [];
  const router = createTenantRouter({
    platform,
    dataDir,
    tenantDomain: opts.tenantDomain,
    trustForwardedHost: opts.trustForwardedHost,
    allowTenantHeader: opts.allowTenantHeader,
    idleMs: opts.idleMs,
    ttlMs: opts.ttlMs,
    sweepEveryMs: 0,
    now: opts.now ?? (() => new Date(T)),
    openBackend: async (_code, _dbPath, resolvers) => {
      const handle = await createBackend({
        dbPath: ":memory:",
        resolveEntitlements: () => resolvers.resolveEntitlements(),
        resolveLicenseState: () => resolvers.resolveLicenseState(),
      });
      const spied: BackendHandle = { ...handle, close: vi.fn(handle.close) };
      opened.push(spied);
      return spied;
    },
  });
  routers.push(router);
  return { router, opened };
}

async function bootstrapAdmin(router: TenantRouter, code: string): Promise<string> {
  const res = await router.app.fetch(
    new Request("http://ignored/bootstrap/admin", {
      method: "POST",
      headers: { "content-type": "application/json", [TENANT_HEADER]: code },
      body: JSON.stringify({ nameAr: "المدير", email: `owner-${code}@example.com`, pin: "123456" }),
    }),
  );
  expect(res.status).toBe(201);
  const session = (await res.json()) as SessionDTO;
  return session.token;
}

describe("createTenantRouter", () => {
  describe("GET /platform/resolve", () => {
    it("reports mode subdomain and exists true when the host names a live tenant — never its name", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "cyag.mezan.test" } }));
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ mode: "subdomain", exists: true });
      expect(body).not.toContain("سياج");
    });

    it("reports mode code and exists false when the host does not name one and no header is sent", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "localhost" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "code", exists: false });
    });

    it("reports exists true for the tenant named by the header — never its name", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
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
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { [TENANT_HEADER]: code } }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { exists: unknown }).exists).toBe(false);
    });
  });

  describe("GET /tenant", () => {
    it("refuses with 400 TENANT_REQUIRED when no code is given", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" });
    });

    it("refuses with 404 TENANT_NOT_FOUND for an unknown code", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "ghost" } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" });
    });

    it.each(["old", "new"])("refuses with 404 TENANT_NOT_FOUND for tenant %s (archived/provisioning)", async (code) => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: code } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "TENANT_NOT_FOUND" });
    });

    it("dispatches to the tenant's own backend for a live tenant", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(200);
      /** The backend's own seeded settings name the company, independent of the platform tenant's `nameAr`. */
      expect(await res.json()).toEqual({ name: "Cyag" });
    });
  });

  describe("tenant isolation", () => {
    it("keeps each tenant's data in its own backend", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

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
      const { router } = newRouter(platform);

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
      const { router } = newRouter(platform);
      const parent = new Hono();
      parent.route("/api", router.app);

      const res = await parent.fetch(new Request("http://ignored/api/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ name: "Cyag" });
    });
  });

  describe("close", () => {
    it("closes every backend it opened", async () => {
      const platform = await seedPlatform();
      const { router, opened } = newRouter(platform);

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
      const { router } = newRouter(platform);

      await expect(router.backendFor("old")).rejects.toThrow();
    });

    it("refuses an archived tenant even after its backend was already cached", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

      await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "susp" } }));
      await archiveTenant({ id: "t-susp", now: T }, platform.stores.tenants);

      await expect(router.backendFor("susp")).rejects.toThrow();
    });

    it("opens a provisioning tenant's own backend even though the public dispatcher 404s on it", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

      const backend = await router.backendFor("new");
      expect(backend.app).toBeTruthy();

      const dispatchRes = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "new" } }));
      expect(dispatchRes.status).toBe(404);
    });
  });

  describe("openTenants", () => {
    it("lists only codes with a currently cached backend, and drops one closed", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

      expect(router.openTenants()).toEqual([]);

      await router.backendFor("cyag");
      await router.backendFor("nile");
      expect(router.openTenants().sort()).toEqual(["cyag", "nile"]);

      await router.close();
      expect(router.openTenants()).toEqual([]);
    });
  });

  describe("dispatch preserves encoded path segments", () => {
    function stubRouter(platform: PlatformHandle): { router: TenantRouter; captured: string[] } {
      const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-tenant-router-stub-"));
      dirs.push(dataDir);
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
        openBackend: async () => ({ app: stub, sessions: createSessionRegistry(), backupTo: vi.fn(), drain: vi.fn(), close: vi.fn() }),
      });
      routers.push(router);
      return { router, captured };
    }

    it("forwards a %2F-escaped path segment undecoded, direct and nested under a parent mount", async () => {
      const platform = await seedPlatform();
      const { router, captured } = stubRouter(platform);

      await router.app.fetch(new Request("http://ignored/customers/a%2Fb", { headers: { [TENANT_HEADER]: "cyag" } }));

      const parent = new Hono();
      parent.route("/api", router.app);
      await parent.fetch(new Request("http://ignored/api/customers/a%2Fb", { headers: { [TENANT_HEADER]: "cyag" } }));

      expect(captured).toEqual(["/customers/a%2Fb", "/customers/a%2Fb"]);
    });
  });

  describe("errors", () => {
    it("answers 500 INTERNAL, in Arabic, for an unexpected thrown error", async () => {
      const platform = await seedPlatform();
      const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-tenant-router-err-"));
      dirs.push(dataDir);
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        openBackend: async () => { throw new Error("boom"); },
      });
      routers.push(router);

      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "INTERNAL", message: "حدث خطأ غير متوقع" });
    });

    it("maps a TENANT_NOT_FOUND thrown from opening the backend to the 404 body", async () => {
      const platform = await seedPlatform();
      const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-tenant-router-err2-"));
      dirs.push(dataDir);
      const router = createTenantRouter({
        platform,
        dataDir,
        sweepEveryMs: 0,
        now: () => new Date(T),
        openBackend: async () => { throw new Error("TENANT_NOT_FOUND"); },
      });
      routers.push(router);

      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "cyag" } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" });
    });
  });

  describe("a suspended tenant", () => {
    it("still dispatches reads (200) but has its writes refused by the licence gate", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

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

    it("still lets /bootstrap/admin through — it is allowlisted and self-closing", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);

      const res = await router.app.fetch(
        new Request("http://ignored/bootstrap/admin", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: "susp" },
          body: JSON.stringify({ nameAr: "المدير", email: "owner-susp@example.com", pin: "123456" }),
        }),
      );
      expect(res.status).toBe(201);
    });
  });

  describe("cache eviction", () => {
    it("rebuilds a tenant's resolver after its backend is evicted for being idle", async () => {
      const platform = await seedPlatform();
      let t = new Date(T).getTime();
      const { router } = newRouter(platform, { idleMs: 1000, ttlMs: 60_000, now: () => new Date(t) });

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
    const signIn = (router: TenantRouter, code: string, username: string, forwardedFor: string, pin = "000000") =>
      router.app.fetch(
        new Request("http://ignored/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: code, "x-forwarded-for": forwardedFor },
          body: JSON.stringify({ username, pin }),
        }),
      );

    it("holds an address after thirty failures across tenants and accounts, before the tenant is asked again", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { trustForwardedHost: true });
      await bootstrapAdmin(router, "cyag");
      await bootstrapAdmin(router, "nile");
      for (let i = 0; i < 31; i += 1) {
        expect((await signIn(router, i % 2 === 0 ? "cyag" : "nile", `ghost${i}@example.com`, "203.0.113.9")).status).toBe(401);
      }

      const held = await signIn(router, "cyag", "owner-cyag@example.com", "203.0.113.9", "123456");
      const elsewhere = await signIn(router, "cyag", "owner-cyag@example.com", "198.51.100.4", "123456");

      expect(held.status).toBe(429);
      expect(await held.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS", message: expect.stringContaining("محاولات دخول كثيرة") });
      expect(held.headers.get("retry-after")).toBe("60");
      expect(elsewhere.status).toBe(200);
    }, 120_000);

    it("ignores a forwarded address it was not told to trust", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      await bootstrapAdmin(router, "cyag");
      for (let i = 0; i < 31; i += 1) await signIn(router, "cyag", `ghost${i}@example.com`, "203.0.113.9");

      expect((await signIn(router, "cyag", "owner-cyag@example.com", "203.0.113.9", "123456")).status).toBe(200);
    }, 120_000);
  });
});
