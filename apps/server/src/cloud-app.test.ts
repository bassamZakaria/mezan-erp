import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "hono";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNER_PASSWORD_FILE, createCloudApp, type CloudApp } from "./cloud-app.js";
import { parseEnv, type CloudEnv } from "./env.js";
import { RequestCapRefusal } from "./rate-limit.js";
import { DEVICE_BINDING_HEADER, DeviceBinding, PUBLIC_API_BASE_PATH } from "@mezan/contracts";
import { platformBearer, reachable, rememberPlatformDevice } from "./cloud-harness.js";

const PROXY_HOPS = 2;
const PROXIED = { MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: String(PROXY_HOPS) };
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
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><head><title>Mezan</title></head><body>مزان</body>");
  return dir;
}

function testEnv(overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    ...parseEnv(PROXIED),
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
  reachable(app.root, PROXY_HOPS);
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
  rememberPlatformDevice(body);
  return body.token;
}

async function provisionCyag(app: CloudApp, token: string): Promise<{ tenant: { dbFile: string }; adminEmail: string; adminPassword: string }> {
  const res = await app.root.fetch(
    new Request("http://cloud.internal/api/platform/tenants", {
      method: "POST",
      headers: { "content-type": "application/json", ...platformBearer(token) },
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
  return (await res.json()) as { tenant: { dbFile: string }; adminEmail: string; adminPassword: string };
}

describe("createCloudApp", () => {
  describe("the general /api request cap", () => {
    const capped = () => boot(testEnv({ apiRequestsPerAddressPerMinute: 6, apiRequestsPerSessionPerMinute: 3 }));
    const get = (app: CloudApp, path: string, headers: Record<string, string> = {}) => app.root.fetch(new Request(`http://cloud.internal${path}`, { headers }));
    const capRefused = async (res: Response) => res.status === 429 && ((await res.json()) as { error?: string }).error === RequestCapRefusal.TooManyRequests;

    it("refuses a session token past its cap, with Retry-After, and serves another token from the same address", async () => {
      const app = await capped();
      for (let i = 0; i < 3; i += 1) expect(await capRefused(await get(app, "/api/platform/resolve", { authorization: "Bearer flood" }))).toBe(false);
      const refused = await get(app, "/api/platform/resolve", { authorization: "Bearer flood" });
      expect(refused.headers.get("retry-after")).not.toBeNull();
      expect(await capRefused(refused)).toBe(true);
      expect(await capRefused(await get(app, "/api/platform/resolve", { authorization: "Bearer other" }))).toBe(false);
    });

    it("caps a browser that holds only a session cookie", async () => {
      const app = await capped();
      const login = await app.root.fetch(
        new Request("http://cloud.internal/api/platform/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [DEVICE_BINDING_HEADER]: DeviceBinding.Cookie },
          body: JSON.stringify({ email: "owner@mezan.local", password: "owner-password-123" }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      for (let i = 0; i < 3; i += 1) expect(await capRefused(await get(app, "/api/platform/resolve", { cookie }))).toBe(false);
      expect(await capRefused(await get(app, "/api/platform/resolve", { cookie }))).toBe(true);
    });

    it("refuses an address past its cap whatever token it sends, and serves another address", async () => {
      const app = await capped();
      for (let i = 0; i < 6; i += 1) await get(app, "/api/platform/resolve");
      expect(await capRefused(await get(app, "/api/platform/resolve", { authorization: "Bearer fresh" }))).toBe(true);
      expect(await capRefused(await get(app, "/api/platform/resolve", { "x-forwarded-for": "41.33.99.99, 10.0.0.1" }))).toBe(false);
    });

    it("leaves the public API to its own per-key limit", async () => {
      const app = await capped();
      for (let i = 0; i < 6; i += 1) await get(app, "/api/platform/resolve");
      const publicApi = await get(app, `${PUBLIC_API_BASE_PATH}/customers`, { authorization: "Bearer mzn_not-a-key" });
      expect(publicApi.status).toBe(401);
    });
  });

  it("answers GET /healthz with 200", async () => {
    const app = await boot(testEnv());
    const res = await app.root.fetch(new Request("http://cloud.internal/healthz"));
    expect(res.status).toBe(200);
  });

  it("serves the privacy and account-deletion pages signed out, before authMiddleware and outside the SPA", async () => {
    const authMiddleware = async (c: Context) => c.text("Unauthorized", 401);
    const app = await boot(testEnv({ webDist: webDistFixture(), supportEmail: "support@mezan.test" }), { authMiddleware });
    for (const path of ["/legal/privacy", "/legal/privacy?lang=en", "/legal/account-deletion", "/legal/account-deletion?lang=en"]) {
      const res = await app.root.fetch(new Request(`http://cloud.internal${path}`));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("support@mezan.test");
      expect(html).not.toContain("مزان</body>");
    }
    expect((await app.root.fetch(new Request("http://cloud.internal/"))).status).toBe(401);
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

  it("generates the owner password once, writes it to a file only the server user can read, and never logs it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = testEnv({ platformOwnerPassword: undefined });
    const app = await boot(env);
    const file = path.join(env.platformDir, OWNER_PASSWORD_FILE);
    const generated = readFileSync(file, "utf8").trim();
    expect(generated).toHaveLength(20);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join("\n");
    expect(logged).not.toContain(generated);
    expect(logged).toContain(OWNER_PASSWORD_FILE);

    const token = await platformLogin(app, "owner@mezan.local", generated);
    expect(token).toBeTruthy();
    logSpy.mockRestore();
    warnSpy.mockRestore();
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
        body: JSON.stringify({ username: provisioned.adminEmail, password: provisioned.adminPassword }),
      }),
    );
    expect(tenantLoginRes.status).toBe(200);
  });

  it("retries a tenant whose provisioning failed on a retired plan, through the route, ending active", async () => {
    const env = testEnv();
    const app = await boot(env);
    const token = await platformLogin(app, "owner@mezan.local", "owner-password-123");
    const authed = { "content-type": "application/json", ...platformBearer(token) };

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
    const retried = (await retryRes.json()) as { tenant: { status: string }; adminEmail: string; adminPassword: string | null };
    expect(retried.tenant.status).toBe("active");
    expect(retried.adminEmail).toBe("owner@retryco.example");
    expect(retried.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "retryco" },
        body: JSON.stringify({ username: "owner@retryco.example", password: retried.adminPassword }),
      }),
    );
    expect(login.status).toBe(200);
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
          body: JSON.stringify({ username: "a@b.example", password: "pw-123456" }),
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
          body: JSON.stringify({ username: "a@b.example", password: "pw-123456" }),
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
    reachable(app.root, PROXY_HOPS);

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

    it("lets browsers keep content-hashed assets for a year, but always re-checks the app page that names them", async () => {
      const env = testEnv();
      mkdirSync(path.join(env.webDist, "assets"));
      writeFileSync(path.join(env.webDist, "assets", "index-AbC123.js"), "export {};");
      writeFileSync(path.join(env.webDist, "favicon.svg"), "<svg/>");
      const app = await boot(env);
      const header = async (url: string) => (await app.root.fetch(new Request(`http://cloud.internal${url}`))).headers.get("cache-control");

      expect(await header("/assets/index-AbC123.js")).toBe("public, max-age=31536000, immutable");
      const gone = await app.root.fetch(new Request("http://cloud.internal/assets/index-OldHash.js"));
      expect(gone.status).toBe(404);
      expect(gone.headers.get("cache-control")).toBeNull();
      expect(await header("/favicon.svg")).toBeNull();
      expect(await header("/")).toBe("no-cache");
      expect(await header("/sales-invoices")).toBe("no-cache");
    });

    it("keeps content-hashed assets out of shared caches while the demo gate stands in front of them", async () => {
      const env = testEnv();
      mkdirSync(path.join(env.webDist, "assets"));
      writeFileSync(path.join(env.webDist, "assets", "index-AbC123.js"), "export {};");
      const app = await boot(env, { authMiddleware: async (_c: Context, next: () => Promise<void>) => next() });
      const res = await app.root.fetch(new Request("http://cloud.internal/assets/index-AbC123.js"));

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    });

    it("leaves / as the plain app page until MEZAN_PUBLIC_LANDING switches the landing page on", async () => {
      const app = await boot(testEnv());
      const home = await (await app.root.fetch(new Request("http://cloud.internal/"))).text();

      expect(home).not.toContain("mezan-site");
      expect(home).toContain("<title>Mezan</title>");
    });

    it("marks the page it serves at / as the cloud website, so the web app opens the landing page there", async () => {
      const app = await boot(testEnv({ publicLanding: true }));
      const home = await (await app.root.fetch(new Request("http://cloud.internal/"))).text();
      const unlock = await (await app.root.fetch(new Request("http://cloud.internal/unlock"))).text();

      expect(home).toContain('<meta name="mezan-site" content="cloud">');
      expect(home).toContain('<meta property="og:title"');
      expect(home).not.toContain("<title>Mezan</title>");
      expect(unlock).not.toContain("mezan-site");
    });

    it("keeps a tenant's own subdomain on the app, and shows the landing page only on the platform host", async () => {
      const app = await boot(testEnv({ publicLanding: true, tenantDomain: "mezan.test" }));
      const page = async (host: string, path = "/") => (await app.root.fetch(new Request(`http://${host}${path}`, { headers: { host } }))).text();

      expect(await page("mezan.test")).toContain("mezan-site");
      expect(await page("acme.mezan.test")).not.toContain("mezan-site");
      expect(await page("acme.mezan.test", "/sales-invoices")).not.toContain("mezan-site");
    });

    it("serves the unlock-link page uncached, with no referrer and without the script a deployment injects into every other page", async () => {
      const BEACON = '<script src="https://analytics.example/beacon.js"></script>';
      const app = await boot(testEnv(), { transformIndexHtml: (html) => html.replace("</body>", `${BEACON}</body>`) });
      const unlock = await app.root.fetch(new Request("http://cloud.internal/unlock"));
      const home = await app.root.fetch(new Request("http://cloud.internal/"));

      expect(unlock.status).toBe(200);
      const page = await unlock.text();
      expect(page).toContain("مزان");
      expect(page).not.toContain("analytics.example");
      expect(await home.text()).toContain("analytics.example");
      expect(unlock.headers.get("referrer-policy")).toBe("no-referrer");
      expect(unlock.headers.get("cache-control")).toBe("no-store");
      expect(home.headers.get("cache-control")).not.toBe("no-store");
    });

    it("serves the password-reset page uncached, with no referrer and without the injected script", async () => {
      const BEACON = '<script src="https://analytics.example/beacon.js"></script>';
      const app = await boot(testEnv(), { transformIndexHtml: (html) => html.replace("</body>", `${BEACON}</body>`) });
      const page = await app.root.fetch(new Request("http://cloud.internal/reset-password"));

      expect(page.status).toBe(200);
      expect(await page.text()).not.toContain("analytics.example");
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      expect(page.headers.get("cache-control")).toBe("no-store");
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

const PG_URL = process.env.MEZAN_TEST_PG_URL;
const PG_ADMIN_URL = process.env.MEZAN_TEST_PG_ADMIN_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the cloud's Postgres boot may not skip there.");

describe.skipIf(!PG_URL)("createCloudApp on Postgres", () => {
  it("boots the platform on its own schema, serves the owner, and finds the same owner after a restart", async () => {
    const database = `mezan_boot_${Date.now()}`;
    const admin = new pg.Client({ connectionString: PG_ADMIN_URL ?? PG_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    if (PG_ADMIN_URL) await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${new URL(PG_URL!).username} WITH GRANT OPTION`);
    const url = new URL(PG_URL!);
    url.pathname = `/${database}`;
    const env = testEnv({ postgres: { url: url.toString(), tenantDbSecret: "a".repeat(64), auditChainKey: "b".repeat(64) } });
    try {
      const first = await createCloudApp(env, { now: () => new Date(T) });
      reachable(first.root, PROXY_HOPS);
      expect((await first.readiness()).ready).toBe(true);
      expect(await platformLogin(first, "owner@mezan.local", "owner-password-123")).toBeTruthy();
      await first.close();

      const second = await createCloudApp({ ...env, platformOwnerPassword: undefined }, { now: () => new Date(T) });
      reachable(second.root, PROXY_HOPS);
      expect(await platformLogin(second, "owner@mezan.local", "owner-password-123")).toBeTruthy();
      await second.close();

      const stamp = new pg.Client({ connectionString: url.toString() });
      await stamp.connect();
      const { rows } = await stamp.query<{ value: string }>("SELECT value FROM platform.schema_meta WHERE key = 'schema_version'");
      await stamp.end();
      expect(rows[0]?.value).toMatch(/^\d+$/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.query("DROP ROLE IF EXISTS platform").catch((error: { code?: string }) => {
        if (error.code !== "2BP01") throw error;
      });
      await admin.end();
    }
  });
});
