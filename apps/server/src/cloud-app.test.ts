import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { parseEnv, type CloudEnv } from "./env.js";

const T = "2026-01-15T00:00:00.000Z";

const backendCloseSpies = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);
const dunningStopSpies = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);

vi.mock("@mezan/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mezan/backend")>();
  return {
    ...actual,
    createBackend: async (opts: Parameters<typeof actual.createBackend>[0]) => {
      const handle = await actual.createBackend(opts);
      const close = vi.fn(handle.close);
      backendCloseSpies.push(close);
      return { ...handle, close };
    },
  };
});

vi.mock("./dunning.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dunning.js")>();
  return {
    ...actual,
    startDunningTimer: (...args: Parameters<typeof actual.startDunningTimer>) => {
      const timer = actual.startDunningTimer(...args);
      const stop = vi.fn(timer.stop);
      dunningStopSpies.push(stop);
      return { stop };
    },
  };
});

const apps: CloudApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  backendCloseSpies.length = 0;
  dunningStopSpies.length = 0;
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function webDistFixture(): string {
  const dir = tempDir("mezan-cloud-web-");
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><body>مزان</body>");
  return dir;
}

function testEnv(overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    ...parseEnv({}),
    platformDir: tempDir("mezan-cloud-platform-"),
    webDist: webDistFixture(),
    platformOwnerEmail: "owner@mezan.local",
    platformOwnerPassword: "owner-password-123",
    ...overrides,
  };
}

async function boot(env: CloudEnv, options: Parameters<typeof createCloudApp>[1] = {}): Promise<CloudApp> {
  const app = await createCloudApp(env, { now: () => new Date(T), ...options });
  apps.push(app);
  return app;
}

async function platformLogin(app: CloudApp, email: string, password: string): Promise<string> {
  const res = await app.root.fetch(
    new Request("http://cloud.internal/api/platform/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function provisionCyag(app: CloudApp, token: string): Promise<{ tenant: { dbFile: string }; adminEmail: string; adminPin: string }> {
  const res = await app.root.fetch(
    new Request("http://cloud.internal/api/platform/tenants", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: "cyag",
        nameAr: "سياج",
        ownerEmail: "owner@cyag.example",
        ownerNameAr: "محمد الشهابي",
        planId: "PLAN-CORE",
        billingCycle: "monthly",
        trial: false,
      }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { tenant: { dbFile: string }; adminEmail: string; adminPin: string };
}

describe("createCloudApp", () => {
  it("answers GET /healthz with 200", async () => {
    const app = await boot(testEnv());
    const res = await app.root.fetch(new Request("http://cloud.internal/healthz"));
    expect(res.status).toBe(200);
  });

  it("answers /healthz before authMiddleware runs, even with a password configured", async () => {
    const authMiddleware = async (c: Context) => c.text("Unauthorized", 401);
    const app = await boot(testEnv(), { authMiddleware });
    const res = await app.root.fetch(new Request("http://cloud.internal/healthz"));
    expect(res.status).toBe(200);
  });

  it("answers GET /api/platform/resolve", async () => {
    const app = await boot(testEnv());
    const res = await app.root.fetch(new Request("http://cloud.internal/api/platform/resolve"));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("mode");
  });

  it("logs in the env-seeded platform owner", async () => {
    const app = await boot(testEnv());
    const token = await platformLogin(app, "owner@mezan.local", "owner-password-123");
    expect(token).toBeTruthy();
  });

  it("generates and prints the owner password once when none is configured", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = testEnv({ platformOwnerPassword: undefined });
    const app = await boot(env);
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toMatch(/owner password:/);
    const passwordLine = logSpy.mock.calls.map((c) => String(c[0])).find((line) => line.includes("owner password:"));
    const generated = passwordLine!.split("owner password:")[1]!.trim();
    expect(generated).toHaveLength(20);

    const token = await platformLogin(app, "owner@mezan.local", generated);
    expect(token).toBeTruthy();
    logSpy.mockRestore();
  });

  it("provisions a tenant on disk and lets its owner log in through /api", async () => {
    const env = testEnv();
    const app = await boot(env);
    const token = await platformLogin(app, "owner@mezan.local", "owner-password-123");
    const provisioned = await provisionCyag(app, token);

    expect(existsSync(path.join(env.platformDir, provisioned.tenant.dbFile))).toBe(true);

    const tenantLoginRes = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "cyag" },
        body: JSON.stringify({ username: provisioned.adminEmail, pin: provisioned.adminPin }),
      }),
    );
    expect(tenantLoginRes.status).toBe(200);
  });

  it("retries a tenant whose provisioning failed on a retired plan, through the route, ending active", async () => {
    const env = testEnv();
    const app = await boot(env);
    const token = await platformLogin(app, "owner@mezan.local", "owner-password-123");
    const authed = { "content-type": "application/json", authorization: `Bearer ${token}` };

    const doomedPlanRes = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/plans", {
        method: "POST",
        headers: authed,
        body: JSON.stringify({
          code: "doomed", nameAr: "محكوم عليها", nameEn: "Doomed", modules: ["sales"],
          seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1,
          priceMonthly: "0", priceYearly: "0", trialDays: 0, isPublic: true, sortOrder: 99,
        }),
      }),
    );
    expect(doomedPlanRes.status).toBe(201);
    const doomedPlan = (await doomedPlanRes.json()) as { id: string };
    const retireRes = await app.root.fetch(
      new Request(`http://cloud.internal/api/platform/plans/${doomedPlan.id}/retire`, { method: "POST", headers: authed }),
    );
    expect(retireRes.status).toBe(200);

    const createRes = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/tenants", {
        method: "POST",
        headers: authed,
        body: JSON.stringify({
          code: "retryco", nameAr: "شركة الإعادة", ownerEmail: "owner@retryco.example",
          ownerNameAr: "منى إبراهيم", planId: doomedPlan.id, billingCycle: "monthly", trial: false,
        }),
      }),
    );
    expect(createRes.status).toBe(422);
    const failure = (await createRes.json()) as { error: string; tenantId: string };
    expect(failure.error).toBe("TENANT_PROVISIONING_FAILED");
    expect(failure.tenantId).toBeTruthy();

    const retryRes = await app.root.fetch(
      new Request(`http://cloud.internal/api/platform/tenants/${failure.tenantId}/provision`, {
        method: "POST",
        headers: authed,
        body: JSON.stringify({ planId: "PLAN-CORE", billingCycle: "monthly", trial: false }),
      }),
    );
    expect(retryRes.status).toBe(200);
    const retried = (await retryRes.json()) as { tenant: { status: string }; adminEmail: string; adminPin: string | null };
    expect(retried.tenant.status).toBe("active");
    expect(retried.adminEmail).toBe("owner@retryco.example");
    // The admin account was already created on the first, failed attempt (before the retired plan blew up subscription start) — the retry finds it claimed and does not re-issue a PIN.
    expect(retried.adminPin).toBeNull();
  });

  describe("with MEZAN_ORIGIN_SECRET set", () => {
    it("refuses a request under /api/platform without the origin header", async () => {
      const app = await boot(testEnv({ originSecret: "top-secret" }));
      const res = await app.root.fetch(new Request("http://cloud.internal/api/platform/resolve"));
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: string }).toMatchObject({ error: "ORIGIN_REQUIRED" });
    });

    it("passes a request under /api/platform with the correct origin header", async () => {
      const app = await boot(testEnv({ originSecret: "top-secret" }));
      const res = await app.root.fetch(
        new Request("http://cloud.internal/api/platform/resolve", { headers: { "x-mezan-origin": "top-secret" } }),
      );
      expect(res.status).toBe(200);
    });

    it("refuses a request under /api without the origin header", async () => {
      const app = await boot(testEnv({ originSecret: "top-secret" }));
      const res = await app.root.fetch(
        new Request("http://cloud.internal/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mezan-tenant": "demo" },
          body: JSON.stringify({ username: "a@b.example", pin: "123456" }),
        }),
      );
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: string }).toMatchObject({ error: "ORIGIN_REQUIRED" });
    });

    it("passes a request under /api with the correct origin header", async () => {
      const app = await boot(testEnv({ originSecret: "top-secret" }));
      const res = await app.root.fetch(
        new Request("http://cloud.internal/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mezan-tenant": "demo", "x-mezan-origin": "top-secret" },
          body: JSON.stringify({ username: "a@b.example", pin: "123456" }),
        }),
      );
      // No tenant "demo" exists yet, but that is a 404 from the tenant router
      // — proof the origin guard let the request through to it.
      expect(res.status).toBe(404);
    });

    it("never gates /healthz", async () => {
      const app = await boot(testEnv({ originSecret: "top-secret" }));
      const res = await app.root.fetch(new Request("http://cloud.internal/healthz"));
      expect(res.status).toBe(200);
    });
  });

  it("calls the seedDemo seam once when MEZAN_SEED_DEMO is on, and not when off", async () => {
    const seedDemo = vi.fn(async () => undefined);
    await boot(testEnv({ seedDemo: true }), { seedDemo });
    expect(seedDemo).toHaveBeenCalledTimes(1);

    const seedDemoOff = vi.fn(async () => undefined);
    await boot(testEnv({ seedDemo: false }), { seedDemo: seedDemoOff });
    expect(seedDemoOff).not.toHaveBeenCalled();
  });

  it("starts the backups seam only when the interval is nonzero", async () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    await boot(testEnv({ backupIntervalMinutes: 15 }), { backups: { start } });
    expect(start).toHaveBeenCalledTimes(1);

    const start2 = vi.fn(() => vi.fn());
    await boot(testEnv({ backupIntervalMinutes: 0 }), { backups: { start: start2 } });
    expect(start2).not.toHaveBeenCalled();
  });

  it("close() is idempotent: called twice, it stops the timers once and closes every cached tenant backend once", async () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const env = testEnv();
    const app = await createCloudApp(env, { now: () => new Date(T), backups: { start } });

    const token = await platformLogin(app, "owner@mezan.local", "owner-password-123");
    await provisionCyag(app, token);
    expect(backendCloseSpies).toHaveLength(1);

    await app.close();
    await app.close();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(dunningStopSpies[0]).toHaveBeenCalledTimes(1);
    expect(backendCloseSpies[0]).toHaveBeenCalledTimes(1);
  });

  describe("static bundle", () => {
    it("serves the built web bundle at / with any injected transform applied, when present", async () => {
      const app = await boot(testEnv(), { transformIndexHtml: (html) => html.replace("مزان", "مزان-تجريبي") });
      const res = await app.root.fetch(new Request("http://cloud.internal/"));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("مزان-تجريبي");
    });

    it("answers a plain 404 JSON at / when no web bundle is present", async () => {
      const app = await boot(testEnv({ webDist: tempDir("mezan-cloud-no-web-") }));
      const res = await app.root.fetch(new Request("http://cloud.internal/"));
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toMatchObject({ error: "NOT_FOUND" });
    });

    it("still answers /healthz and /api/platform/resolve with no web bundle present", async () => {
      const app = await boot(testEnv({ webDist: tempDir("mezan-cloud-no-web-") }));
      expect((await app.root.fetch(new Request("http://cloud.internal/healthz"))).status).toBe(200);
      expect((await app.root.fetch(new Request("http://cloud.internal/api/platform/resolve"))).status).toBe(200);
    });
  });

  it("applies authMiddleware ahead of every non-health route", async () => {
    const authMiddleware = async (c: Context, next: () => Promise<void>) => {
      if (c.req.header("authorization") !== "Basic secret") return c.text("Unauthorized", 401);
      await next();
    };
    const app = await boot(testEnv(), { authMiddleware });
    const blocked = await app.root.fetch(new Request("http://cloud.internal/"));
    expect(blocked.status).toBe(401);
    const allowed = await app.root.fetch(new Request("http://cloud.internal/", { headers: { authorization: "Basic secret" } }));
    expect(allowed.status).toBe(200);
  });
});
