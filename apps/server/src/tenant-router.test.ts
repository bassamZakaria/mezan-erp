import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createTenant, activateTenant, archiveTenant, startSubscription } from "@mezan/domain";
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

  return platform;
}

function newRouter(platform: PlatformHandle, opts: { tenantDomain?: string } = {}): { router: TenantRouter; opened: BackendHandle[] } {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-tenant-router-"));
  dirs.push(dataDir);
  const opened: BackendHandle[] = [];
  const router = createTenantRouter({
    platform,
    dataDir,
    tenantDomain: opts.tenantDomain,
    sweepEveryMs: 0,
    now: () => new Date(T),
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
    it("reports mode subdomain and the tenant when the host names it", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "cyag.mezan.test" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "subdomain", tenant: { code: "cyag", nameAr: "سياج", nameEn: null } });
    });

    it("reports mode code and no tenant when the host does not name one and no header is sent", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(new Request("http://ignored/platform/resolve", { headers: { host: "localhost" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "code", tenant: null });
    });

    it("reports the tenant named by the header", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform, { tenantDomain: "mezan.test" });
      const res = await router.app.fetch(
        new Request("http://ignored/platform/resolve", { headers: { host: "localhost", [TENANT_HEADER]: "nile" } }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "code", tenant: { code: "nile", nameAr: "النيل", nameEn: null } });
    });
  });

  describe("GET /tenant", () => {
    it("refuses with 400 TENANT_REQUIRED when no code is given", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant"));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "TENANT_REQUIRED" });
    });

    it("refuses with 404 TENANT_NOT_FOUND for an unknown code", async () => {
      const platform = await seedPlatform();
      const { router } = newRouter(platform);
      const res = await router.app.fetch(new Request("http://ignored/tenant", { headers: { [TENANT_HEADER]: "ghost" } }));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "TENANT_NOT_FOUND" });
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
});
