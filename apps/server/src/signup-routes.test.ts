import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { openSqliteConnection } from "@mezan/persistence";
import { SubscriptionStatusCode, type ProvisionResultDTO, type PublicPlanDTO } from "@mezan/contracts";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import { COMPANY_NAME_MAX_LENGTH, createTenant, InvalidTenantTransitionError, QuotaKind, startSubscription, TenantStatusCode, type Subscription } from "@mezan/domain";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { createSignupRoutes } from "./signup-routes.js";
import { platformBearer as bearerHeaders, reachable, rememberPlatformDevice } from "./cloud-harness.js";
import { provisionTenant, TenantProvisioningError, type ProvisionTenantCommand } from "./provision-tenant.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter, type TenantRouterOptions } from "./tenant-router.js";
import { parseEnv } from "./env.js";

function reachableRouter(options: TenantRouterOptions): TenantRouter {
  const router = createTenantRouter(options);
  reachable(router.app);
  return router;
}

const T = "2026-01-15T00:00:00.000Z";

const apps: CloudApp[] = [];
const dirs: string[] = [];
const routers: TenantRouter[] = [];
const platforms: PlatformHandle[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const router of routers.splice(0)) await router.close();
  for (const platform of platforms.splice(0)) platform.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OWNER_EMAIL = "owner@mezan.local";
const OWNER_PASSWORD = "owner-password-123";

enum TenantTransition {
  Suspend = "suspend",
  Resume = "resume",
}

async function boot(vars: Record<string, string> = {}): Promise<CloudApp> {
  const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-signup-platform-"));
  dirs.push(platformDir);
  const app = await createCloudApp(
    {
      ...parseEnv(vars),
      platformDir,
      webDist: path.join(platformDir, "no-web-dist"),
      backupIntervalMinutes: 0,
      platformOwnerEmail: OWNER_EMAIL,
      platformOwnerPassword: OWNER_PASSWORD,
    },
    { now: () => new Date(T) },
  );
  reachable(app.root);
  apps.push(app);
  return app;
}

function post(app: CloudApp, route: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.root.fetch(
      new Request(`http://cloud.internal${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function tenantBody(code: string, nameAr: string): ProvisionTenantCommand {
  return { code, nameAr, ownerEmail: `owner@${code}.example`, ownerNameAr: "سارة", planId: "PLAN-CORE", billingCycle: "monthly", trial: true };
}

async function platformBearer(app: CloudApp): Promise<string> {
  const login = await post(app, "/api/platform/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { token: string };
  rememberPlatformDevice(body);
  return body.token;
}

function platformCall(app: CloudApp, token: string, route: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...bearerHeaders(token), ...(init.body ? { "content-type": "application/json" } : {}) };
  return Promise.resolve(app.root.fetch(new Request(`http://cloud.internal/api/platform${route}`, { ...init, headers })));
}

async function createConsoleTenant(app: CloudApp, code: string, nameAr = "متجر الياسمين"): Promise<ProvisionResultDTO> {
  const created = await platformCall(app, await platformBearer(app), "/tenants", { method: "POST", body: JSON.stringify(tenantBody(code, nameAr)) });
  expect(created.status).toBe(201);
  return (await created.json()) as ProvisionResultDTO;
}

async function moveTenant(app: CloudApp, tenantId: string, transition: TenantTransition): Promise<void> {
  const moved = await platformCall(app, await platformBearer(app), `/tenants/${tenantId}/${transition}`, { method: "POST" });
  expect(moved.status).toBe(200);
}

async function listedTenantCodes(app: CloudApp): Promise<string[]> {
  const listed = await platformCall(app, await platformBearer(app), "/tenants");
  return ((await listed.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code);
}

describe("the public site's contact details", () => {
  it("answers the support email, phone and WhatsApp number the server was given, and nothing else", async () => {
    const app = await boot({ MEZAN_SUPPORT_EMAIL: "help@mezan.example", MEZAN_SUPPORT_PHONE: "+20 100 123 4567", MEZAN_WHATSAPP_NUMBER: "201001234567" });

    const res = await app.root.fetch(new Request("http://cloud.internal/api/signup/status"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contact: { email: "help@mezan.example", phone: "+20 100 123 4567", whatsapp: "201001234567" } });
  });

  it("answers null for every channel the server was not given", async () => {
    const app = await boot();

    const res = await app.root.fetch(new Request("http://cloud.internal/api/signup/status"));

    expect(await res.json()).toEqual({ contact: { email: null, phone: null, whatsapp: null } });
  });
});

describe("a sold-out package", () => {
  it("stays on the public list marked sold out", async () => {
    const app = await boot();
    const owner = await platformBearer(app);
    const plans = (await (await platformCall(app, owner, "/plans")).json()) as (Record<string, unknown> & { id: string; code: string; status: string })[];
    const core = plans.find((p) => p.id === "PLAN-CORE")!;
    const { id: _id, code: _code, status: _status, createdAt: _createdAt, features: _features, ...editable } = core;
    const marked = await platformCall(app, owner, "/plans/PLAN-CORE", { method: "PUT", body: JSON.stringify({ ...editable, soldOut: true }) });
    expect(marked.status).toBe(200);

    const listed = (await (await app.root.fetch(new Request("http://cloud.internal/api/signup/plans"))).json()) as { id: string; soldOut: boolean }[];
    expect(listed.find((p) => p.id === "PLAN-CORE")?.soldOut).toBe(true);
  });
});

describe("a tenant created in the console", () => {
  it("activates a tenant whose company name is exactly as long as the claim accepts", async () => {
    const app = await boot();
    const longest = "ش".repeat(COMPANY_NAME_MAX_LENGTH);

    const created = await createConsoleTenant(app, "longest", `  ${longest}  `);

    expect(created.tenant.status).toBe(TenantStatusCode.Active);
    expect(created.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "longest" },
        body: JSON.stringify({ username: "owner@longest.example", password: created.adminPassword }),
      }),
    );
    expect(((await login.json()) as { tenantName: string }).tenantName).toBe(longest);
  });

  it.each([
    ["longer than the claim accepts", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)],
    ["carrying a right-to-left override", "شركة \u202Eevil"],
  ])("refuses a tenant created in the console with a name %s, and creates nothing", async (_what, nameAr) => {
    const app = await boot();
    const token = await platformBearer(app);

    const refused = await platformCall(app, token, "/tenants", { method: "POST", body: JSON.stringify(tenantBody("console", nameAr)) });

    expect(refused.status).toBe(400);
    expect(await listedTenantCodes(app)).not.toContain("console");
  });
});

function cloudLogin(app: CloudApp, code: string, password: string): Promise<Response> {
  return Promise.resolve(
    app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": code },
        body: JSON.stringify({ username: `owner@${code}.example`, password }),
      }),
    ),
  );
}

const OWN_PASSWORD = "owner-chose-this-1";

async function signInChangingPassword(fetch: (request: Request) => Response | Promise<Response>, base: string, tenant: string, username: string, temporary: string): Promise<string> {
  const login = async (password: string) =>
    fetch(new Request(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json", [TENANT_HEADER]: tenant }, body: JSON.stringify({ username, password }) }));
  const { token } = (await (await login(temporary)).json()) as { token: string };
  const changed = await fetch(
    new Request(`${base}/profile/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, [TENANT_HEADER]: tenant },
      body: JSON.stringify({ currentPassword: temporary, newPassword: OWN_PASSWORD }),
    }),
  );
  expect(changed.status).toBe(204);
  return ((await (await login(OWN_PASSWORD)).json()) as { token: string }).token;
}

function cloudOwnerSession(app: CloudApp, code: string, temporary: string): Promise<string> {
  return signInChangingPassword((request) => app.root.fetch(request), "http://cloud.internal/api", code, `owner@${code}.example`, temporary);
}

function resetOwnerPassword(app: CloudApp, tenantId: string, bearer: string | null): Promise<Response> {
  return Promise.resolve(
    app.root.fetch(
      new Request(`http://cloud.internal/api/platform/tenants/${tenantId}/owner-password/reset`, {
        method: "POST",
        headers: bearer ? { ...bearerHeaders(bearer) } : {},
      }),
    ),
  );
}

describe("a trailing slash on an /api route", () => {
  it("reaches the same platform, signup and tenant routes, with the request body intact", async () => {
    const app = await boot();
    const platformLogin = await post(app, "/api/platform/auth/login/", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(platformLogin.status).toBe(200);
    const platformSession = (await platformLogin.json()) as { token: string };
    rememberPlatformDevice(platformSession);
    const bearer = platformSession.token;

    const created = await platformCall(app, bearer, "/tenants/", { method: "POST", body: JSON.stringify(tenantBody("slashes", "متجر الشرطة")) });
    expect(created.status).toBe(201);
    const first = (await created.json()) as ProvisionResultDTO;
    expect(first.tenant).toMatchObject({ code: "slashes", status: TenantStatusCode.Active });

    const tenants = await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants/", { headers: { ...bearerHeaders(bearer) } }));
    expect(tenants.status).toBe(200);
    expect(((await tenants.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code)).toContain("slashes");

    const plans = await app.root.fetch(new Request("http://cloud.internal/api/signup/plans/"));
    expect(plans.status).toBe(200);
    expect(((await plans.json()) as unknown[]).length).toBeGreaterThan(0);

    const tenantLoginAnswer = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "slashes" },
        body: JSON.stringify({ username: "owner@slashes.example", password: first.adminPassword }),
      }),
    );
    expect(tenantLoginAnswer.status).toBe(200);
    const session = await cloudOwnerSession(app, "slashes", first.adminPassword ?? "");

    const customers = await app.root.fetch(
      new Request("http://cloud.internal/api/customers/?pageSize=5", { headers: { ...bearerHeaders(session), "x-mezan-tenant": "slashes" } }),
    );
    expect(customers.status).toBe(200);
  });

  it("publishes each public plan's quotas so the pricing page can state the Free plan's invoice cap", async () => {
    const app = await boot();
    const plans = (await (await app.root.fetch(new Request("http://cloud.internal/api/signup/plans"))).json()) as PublicPlanDTO[];

    expect(plans.find((plan) => plan.code === "free")?.quotas).toEqual({ [QuotaKind.SalesInvoicesPerMonth]: 100, [QuotaKind.StorageMb]: 200 });
    expect(plans.find((plan) => plan.code === "core")?.quotas).toEqual({ [QuotaKind.StorageMb]: 2048 });
  });

  it("still refuses a tenant route that carries no session, slash or not", async () => {
    const app = await boot();
    await createConsoleTenant(app, "closed");

    const customers = await app.root.fetch(new Request("http://cloud.internal/api/customers/", { headers: { "x-mezan-tenant": "closed" } }));

    expect(customers.status).toBe(401);
  });
});

describe("the platform owner resets a tenant owner's password", () => {
  it("issues a new password once, retires the old one and ends the owner's open sessions", async () => {
    const app = await boot();
    const first = await createConsoleTenant(app, "locked");
    const session = await cloudOwnerSession(app, "locked", first.adminPassword ?? "");
    const oldPassword = OWN_PASSWORD;
    const customers = () =>
      app.root.fetch(new Request("http://cloud.internal/api/customers", { headers: { ...bearerHeaders(session), "x-mezan-tenant": "locked" } }));
    expect((await customers()).status).toBe(200);

    const reset = await resetOwnerPassword(app, first.tenant.id, await platformBearer(app));

    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { adminEmail: string; adminPassword: string };
    expect(body.adminEmail).toBe("owner@locked.example");
    expect(body.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(body.adminPassword).not.toBe(oldPassword);
    expect((await customers()).status).toBe(401);
    expect((await cloudLogin(app, "locked", oldPassword)).status).toBe(401);
    expect((await cloudLogin(app, "locked", body.adminPassword)).status).toBe(200);
    expect(body.adminPassword).not.toBe(first.adminPassword);
  });

  it("resets the owner's password on a suspended tenant, where the new password is accepted once the tenant is resumed", async () => {
    const app = await boot();
    const first = await createConsoleTenant(app, "paused");
    const oldPassword = first.adminPassword ?? "";
    await moveTenant(app, first.tenant.id, TenantTransition.Suspend);

    const reset = await resetOwnerPassword(app, first.tenant.id, await platformBearer(app));

    expect(reset.status).toBe(200);
    const { adminPassword } = (await reset.json()) as { adminPassword: string };
    expect(adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(adminPassword).not.toBe(oldPassword);
    await moveTenant(app, first.tenant.id, TenantTransition.Resume);
    expect((await cloudLogin(app, "paused", oldPassword)).status).toBe(401);
    expect((await cloudLogin(app, "paused", adminPassword)).status).toBe(200);
  });

  it("is refused without a platform session, and for a tenant session", async () => {
    const app = await boot();
    const first = await createConsoleTenant(app, "guarded");
    const password = first.adminPassword ?? "";
    const tenantSession = ((await (await cloudLogin(app, "guarded", password)).json()) as { token: string }).token;

    expect((await resetOwnerPassword(app, first.tenant.id, null)).status).toBe(401);
    expect((await resetOwnerPassword(app, first.tenant.id, tenantSession)).status).toBe(401);
    expect((await cloudLogin(app, "guarded", password)).status).toBe(200);
  });

  it("is not reachable on the tenant's own API, with or without the tenant's admin session", async () => {
    const app = await boot();
    const first = await createConsoleTenant(app, "inside");
    const tenantSession = await cloudOwnerSession(app, "inside", first.adminPassword ?? "");

    for (const route of ["/api/owner-password/reset", "/api/bootstrap/owner-password", "/api/auth/owner-password/reset"]) {
      const answer = await app.root.fetch(
        new Request(`http://cloud.internal${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...bearerHeaders(tenantSession), "x-mezan-tenant": "inside" },
          body: JSON.stringify({ email: "owner@inside.example", password: "pw-000000" }),
        }),
      );
      expect(answer.status, route).toBe(404);
    }
    expect((await cloudLogin(app, "inside", "pw-000000")).status).toBe(401);
    expect((await cloudLogin(app, "inside", OWN_PASSWORD)).status).toBe(200);
  });

  it("answers 404 for a tenant that does not exist", async () => {
    const app = await boot();
    expect((await resetOwnerPassword(app, "no-such-tenant", await platformBearer(app))).status).toBe(404);
  });

  it("follows the owner to a new email changed inside the tenant, so the reset still reaches their account", async () => {
    const app = await boot();
    const first = await createConsoleTenant(app, "moved");
    const session = await cloudOwnerSession(app, "moved", first.adminPassword ?? "");
    const tenantHeaders = { ...bearerHeaders(session), "x-mezan-tenant": "moved", "content-type": "application/json" };
    const users = (await (await app.root.fetch(new Request("http://cloud.internal/api/users", { headers: tenantHeaders }))).json()) as Record<string, unknown>[];
    const owner = users.find((user) => user["email"] === "owner@moved.example");
    const bearer = await platformBearer(app);
    const recordedOwner = async () =>
      ((await (await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants", { headers: { ...bearerHeaders(bearer) } }))).json()) as {
        tenant: { code: string; ownerEmail: string };
      }[]).find((row) => row.tenant.code === "moved")?.tenant.ownerEmail;

    const changed = await app.root.fetch(
      new Request(`http://cloud.internal/api/users/${String(owner?.["id"])}`, {
        method: "PUT",
        headers: tenantHeaders,
        body: JSON.stringify({ ...owner, email: " Sara@Moved-Shop.example ", currentPassword: OWN_PASSWORD }),
      }),
    );

    expect(changed.status).toBe(200);
    expect(await recordedOwner()).toBe("sara@moved-shop.example");
    const reset = await resetOwnerPassword(app, first.tenant.id, bearer);
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { adminEmail: string; adminPassword: string };
    expect(body.adminEmail).toBe("sara@moved-shop.example");
    const signedIn = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "moved" },
        body: JSON.stringify({ username: "sara@moved-shop.example", password: body.adminPassword }),
      }),
    );
    expect(signedIn.status).toBe(200);
    const rows = await (await openPlatform(dirs[dirs.length - 1] ?? "")).audit.query("security");
    expect(rows.filter((row) => row.action === "TENANT_OWNER_EMAIL_CHANGED")).toMatchObject([
      { entityId: first.tenant.id, severity: "CRITICAL", details: { code: "moved", before: "owner@moved.example", after: "sara@moved-shop.example" } },
    ]);
  });

  it("leaves the recorded owner alone when another user's email changes, and keeps the owner's saved change when the platform cannot record it", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    let refuseSave = false;
    const tenants = Object.create(platform.stores.tenants) as PlatformHandle["stores"]["tenants"];
    tenants.compareAndSetOwner = async (before, after, sideEffect) => {
      if (refuseSave) throw new Error("the platform database refused the tenant");
      return platform.stores.tenants.compareAndSetOwner(before, after, sideEffect);
    };
    const router = reachableRouter({ platform: { ...platform, stores: { ...platform.stores, tenants } }, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    routers.push(router);
    const { adminPassword } = await provisionTenant(
      { code: "steady", nameAr: "ثابتة", ownerEmail: "owner@steady.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T) },
    );
    router.invalidate("steady");
    const session = await signInChangingPassword((request) => router.app.fetch(request), "http://ignored", "steady", "owner@steady.example", adminPassword ?? "");
    const call = (method: string, route: string, body?: unknown) =>
      Promise.resolve(
        router.app.fetch(
          new Request(`http://ignored${route}`, {
            method,
            headers: { ...bearerHeaders(session), [TENANT_HEADER]: "steady", "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        ),
      );
    const users = (await (await call("GET", "/users")).json()) as Record<string, unknown>[];
    const owner = users.find((user) => user["email"] === "owner@steady.example");
    const roles = (await (await call("GET", "/roles")).json()) as { id: string }[];
    const clerk = await call("POST", "/users", {
      nameAr: "موظف", nameEn: null, email: "clerk@steady.example", phone: null, roleId: roles[0]?.id, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", password: "clerk-password-1",
      acknowledge: true, reason: "اختبار",
    });
    expect(clerk.status).toBe(201);
    const clerkRow = (await clerk.json()) as Record<string, unknown>;

    expect((await call("PUT", `/users/${String(clerkRow["id"])}`, { ...clerkRow, email: "clerk2@steady.example" })).status).toBe(200);
    expect((await platform.stores.tenants.findByCode("steady"))?.ownerEmail).toBe("owner@steady.example");

    refuseSave = true;
    const refused = await call("PUT", `/users/${String(owner?.["id"])}`, { ...owner, email: "new@steady.example", currentPassword: OWN_PASSWORD });

    expect(refused.status).toBe(200);
    expect((await platform.stores.tenants.findByCode("steady"))?.ownerEmail).toBe("owner@steady.example");
    const after = (await (await call("GET", "/users")).json()) as Record<string, unknown>[];
    expect(after.find((user) => user["id"] === owner?.["id"])?.["email"]).toBe("new@steady.example");
  });

  it("records the operator who retried a provision as the actor of the tenant's password reset", async () => {
    const app = await boot();
    const bearer = await platformBearer(app);
    const console_ = (route: string, body?: unknown) =>
      app.root.fetch(
        new Request(`http://cloud.internal/api/platform${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", ...bearerHeaders(bearer) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    const operator = (await (await console_("/auth/me")).json()) as { id: string };
    expect((await console_("/plans/PLAN-CORE/retire", {})).status).toBe(200);
    const failed = await console_("/tenants", { ...tenantBody("retried", "منشأة أعيد تجهيزها"), trial: false });
    expect(failed.status).toBe(422);
    const { tenantId } = (await failed.json()) as { tenantId: string };

    const retried = await console_(`/tenants/${tenantId}/provision`, { planId: "PLAN-BUSINESS", billingCycle: "monthly" });

    expect(retried.status).toBe(200);
    const { adminPassword } = (await retried.json()) as { adminPassword: string };
    const session = await cloudOwnerSession(app, "retried", adminPassword);
    const audit = await app.root.fetch(
      new Request("http://cloud.internal/api/audit?stream=security&action=OWNER_PIN_RESET", { headers: { ...bearerHeaders(session), "x-mezan-tenant": "retried" } }),
    );
    expect(audit.status).toBe(200);
    const { events } = (await audit.json()) as { events: { action: string; actor: string }[] };
    expect(events.map((row) => row.actor)).toEqual([`platform:${operator.id}`, `platform:${operator.id}`]);
  });
});

type SaveSubscription = (subscription: Subscription) => Promise<void>;

function platformDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-signup-shared-"));
  dirs.push(dataDir);
  return dataDir;
}

async function openPlatform(dataDir: string): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: path.join(dataDir, "platform.db"), now: () => new Date(T) });
  platforms.push(platform);
  return platform;
}

function tenantRouter(platform: PlatformHandle, dataDir: string): TenantRouter {
  const router = reachableRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
  routers.push(router);
  return router;
}

describe("releasing a tenant stuck in provisioning", () => {
  const subscriptionsDown: SaveSubscription = async () => {
    throw new Error("the platform database refused the subscription");
  };

  async function stuckTenant(code: string) {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = tenantRouter(platform, dataDir);
    const subscriptions = Object.create(platform.stores.subscriptions) as PlatformHandle["stores"]["subscriptions"];
    subscriptions.save = subscriptionsDown;
    const broken: PlatformHandle = { ...platform, stores: { ...platform.stores, subscriptions } };
    await expect(provisionTenant(tenantBody(code, "متجر الياسمين"), { platform: broken, router, now: () => new Date(T) })).rejects.toBeInstanceOf(TenantProvisioningError);
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant) throw new Error("the stuck tenant was not created");
    expect(tenant.status).toBe(TenantStatusCode.Provisioning);
    return { dataDir, platform, tenant, router };
  }

  it("archives it under a code of its own, leaves its database where it was, and frees the code for a new tenant that gets a new database", async () => {
    const { dataDir, platform, tenant, router } = await stuckTenant("freed");
    const oldFile = path.join(dataDir, tenant.dbFile);
    expect(existsSync(oldFile)).toBe(true);

    const released = await releaseProvisioningTenant({ platform, router, dataDir, now: () => new Date(T) }, { tenant, actorId: "op-1" });

    expect(released).toMatchObject({ id: tenant.id, status: TenantStatusCode.Archived, code: `released-${tenant.id}` });
    expect(existsSync(oldFile)).toBe(true);
    expect(released.dbFile).toBe(tenant.dbFile);
    expect(await platform.stores.tenants.findByCode("freed")).toBeNull();
    const rows = await platform.audit.query("security");
    expect(rows.filter((row) => row.action === "TENANT_RELEASED")).toMatchObject([
      { entityId: tenant.id, actor: "platform:op-1", details: { code: "freed", releasedAs: `released-${tenant.id}` } },
    ]);

    const again = await provisionTenant({ ...tenantBody("freed", "متجر جديد"), ownerEmail: "someone-new@freed.example" }, { platform, router, now: () => new Date(T) });
    expect(again.tenant).toMatchObject({ code: "freed", status: TenantStatusCode.Active });
    expect(again.tenant.id).not.toBe(tenant.id);
    expect((await platform.stores.tenants.findByCode("freed"))?.dbFile).not.toBe(tenant.dbFile);
    router.invalidate("freed");
    const token = await signInChangingPassword((request) => router.app.fetch(request), "http://ignored", "freed", "someone-new@freed.example", again.adminPassword ?? "");
    const users = (await (
      await router.app.fetch(
        new Request("http://ignored/users", { headers: { authorization: `Bearer ${token}`, [TENANT_HEADER]: "freed" } }),
      )
    ).json()) as { email: string }[];
    expect(users.map((user) => user.email)).toContain("someone-new@freed.example");
    expect(users.map((user) => user.email)).not.toContain("owner@freed.example");
  });

  it("refuses a tenant that is not provisioning, and leaves it exactly as it was", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = tenantRouter(platform, dataDir);
    await provisionTenant(tenantBody("live", "متجر الياسمين"), { platform, router, now: () => new Date(T) });
    const tenant = await platform.stores.tenants.findByCode("live");
    if (!tenant) throw new Error("the tenant was not created");

    await expect(releaseProvisioningTenant({ platform, router, dataDir, now: () => new Date(T) }, { tenant, actorId: "op-1" })).rejects.toBeInstanceOf(
      InvalidTenantTransitionError,
    );

    expect(await platform.stores.tenants.findByCode("live")).toEqual(tenant);
    expect(existsSync(path.join(dataDir, tenant.dbFile))).toBe(true);
  });

  it("cancels the subscription a stuck tenant had already been given", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = tenantRouter(platform, dataDir);
    const tenant = await createTenant({ id: "t-half", code: "half", nameAr: "نصف مجهزة", ownerEmail: "owner@half.example", now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-half", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);

    await releaseProvisioningTenant({ platform, router, dataDir, now: () => new Date(T) }, { tenant, actorId: "op-1" });

    expect(await platform.stores.subscriptions.findLiveByTenant(tenant.id)).toBeNull();
    expect((await platform.stores.subscriptions.listByTenant(tenant.id)).map((s) => s.status)).toEqual(["cancelled"]);
  });
});

describe("a stored subscription status this build does not know", () => {
  it("is shown as unknown on that tenant's row and its own billing card, while every other tenant still lists", async () => {
    const app = await boot();
    const odd = await createConsoleTenant(app, "oddone");
    await createConsoleTenant(app, "fineone");
    const session = await cloudOwnerSession(app, "oddone", odd.adminPassword ?? "");
    const raw = openSqliteConnection(path.join(dirs[dirs.length - 1] ?? "", "platform.db")).sqlite;
    raw.prepare("UPDATE subscription SET status = 'paused' WHERE tenant_id = ?").run(odd.tenant.id);
    raw.close();

    const listed = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/tenants", { headers: { ...bearerHeaders(await platformBearer(app)) } }),
    );

    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as { tenant: { code: string }; subscription: { status: string } | null }[];
    expect(Object.fromEntries(rows.map((row) => [row.tenant.code, row.subscription?.status]))).toEqual({
      oddone: SubscriptionStatusCode.Unknown,
      fineone: SubscriptionStatusCode.Trialing,
    });
    const billing = await app.root.fetch(
      new Request("http://cloud.internal/api/billing/subscription", { headers: { ...bearerHeaders(session), "x-mezan-tenant": "oddone" } }),
    );
    expect(billing.status).toBe(200);
    expect(((await billing.json()) as { subscription: { status: string } }).subscription.status).toBe(SubscriptionStatusCode.Unknown);
  });

  it("is refused on the way in, so it can only arrive from outside the product", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = tenantRouter(platform, dataDir);
    const { tenant } = await provisionTenant(
      { code: "strict", nameAr: "صارمة", ownerEmail: "owner@strict.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T) },
    );
    const live = await platform.stores.subscriptions.findLiveByTenant(tenant.id);

    await expect(platform.stores.subscriptions.save({ ...live!, status: "paused" as Subscription["status"] })).rejects.toThrow(/paused/);
    await expect(platform.stores.tenants.save({ ...tenant, status: "frozen" as typeof tenant.status })).rejects.toThrow(/frozen/);
    expect((await platform.stores.subscriptions.findLiveByTenant(tenant.id))?.status).toBe("active");
    expect((await platform.stores.tenants.findById(tenant.id))?.status).toBe("active");
  });
});

describe("the address an owner hand-over is counted against", () => {
  const HAND_OVERS_PER_SOURCE_PER_HOUR = 30;

  async function proxiedSignup(): Promise<Hono> {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = tenantRouter(platform, dataDir);
    const env = { ...parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" }), platformDir: dataDir };
    return createSignupRoutes({ platform, router, env, sourceReporter: { unresolved: () => undefined } });
  }

  const handOverFrom = (app: Hono, chain: string | null) =>
    Promise.resolve(
      app.fetch(
        new Request("http://signup.internal/owner-handover", {
          method: "POST",
          headers: { "content-type": "application/json", ...(chain === null ? {} : { "x-forwarded-for": chain }) },
          body: "{}",
        }),
      ),
    );

  it("throttles the hop the trusted proxy appended, however the caller rewrites the hops ahead of it", async () => {
    const app = await proxiedSignup();

    const statuses: number[] = [];
    for (let n = 0; n <= HAND_OVERS_PER_SOURCE_PER_HOUR; n += 1) statuses.push((await handOverFrom(app, `203.0.113.${n}, 41.33.10.10, 130.176.0.7`)).status);

    expect(statuses).toEqual([...Array.from({ length: HAND_OVERS_PER_SOURCE_PER_HOUR }, () => 400), 429]);
  });

  it("does not throttle a caller because another caller wrote its address first in the chain", async () => {
    const app = await proxiedSignup();
    for (let n = 0; n <= HAND_OVERS_PER_SOURCE_PER_HOUR; n += 1) await handOverFrom(app, "41.33.10.11, 41.33.10.10, 130.176.0.7");

    expect((await handOverFrom(app, "41.33.10.11, 130.176.0.7")).status).toBe(400);
  });

  it("refuses a request whose chain is too short to hold the caller's address, instead of counting it as the proxy", async () => {
    const app = await proxiedSignup();

    const refused = await handOverFrom(app, "130.176.0.7");
    const bare = await handOverFrom(app, null);

    expect([refused.status, bare.status]).toEqual([503, 503]);
    expect(await refused.json()).toMatchObject({ error: "SOURCE_UNRESOLVED", message: "تعذّر تحديد مصدر الطلب. حاول مرة أخرى بعد قليل." });
  });
});
