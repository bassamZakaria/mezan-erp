import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { openSqliteConnection } from "@mezan/persistence";
import { SubscriptionStatusCode } from "@mezan/contracts";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { TenantStatusCode, type Subscription } from "@mezan/domain";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { createSignupRoutes } from "./signup-routes.js";
import { reachable } from "./cloud-harness.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter } from "./tenant-router.js";
import { COMPANY_NAME_MAX_LENGTH } from "@mezan/domain";
import { parseEnv } from "./env.js";

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
  Archive = "archive",
  Resume = "resume",
}

interface VerifyBody {
  readonly tenant: { readonly id: string; readonly code: string; readonly status: string };
  readonly adminEmail: string;
  readonly adminPin: string | null;
  readonly alreadyVerified: boolean;
}

async function boot(): Promise<CloudApp> {
  const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-signup-platform-"));
  dirs.push(platformDir);
  const app = await createCloudApp(
    {
      ...parseEnv({}),
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

function signupBody(code: string, nameAr: string): Record<string, string> {
  return { code, nameAr, ownerEmail: `owner@${code}.example`, ownerNameAr: "سارة", planId: "PLAN-CORE", billingCycle: "monthly" };
}

async function platformBearer(app: CloudApp): Promise<string> {
  const login = await post(app, "/api/platform/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  expect(login.status).toBe(200);
  return ((await login.json()) as { token: string }).token;
}

async function startAndReadToken(app: CloudApp, code: string, nameAr = "متجر الياسمين"): Promise<string> {
  const started = await post(app, "/api/signup", signupBody(code, nameAr));
  expect(started.status).toBe(201);
  const { devVerifyUrl } = (await started.json()) as { devVerifyUrl: string };
  return new URL(devVerifyUrl).searchParams.get("token") ?? "";
}

async function moveTenant(app: CloudApp, tenantId: string, transition: TenantTransition): Promise<void> {
  const login = await post(app, "/api/platform/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  expect(login.status).toBe(200);
  const { token } = (await login.json()) as { token: string };
  const moved = await app.root.fetch(
    new Request(`http://cloud.internal/api/platform/tenants/${tenantId}/${transition}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(moved.status).toBe(200);
}

async function listedTenantCodes(app: CloudApp): Promise<string[]> {
  const login = await post(app, "/api/platform/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  const { token } = (await login.json()) as { token: string };
  const listed = await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants", { headers: { authorization: `Bearer ${token}` } }));
  return ((await listed.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code);
}

describe("self-serve signup routes", () => {
  it("answers a signup posted to /api/signup itself, not the tenant router's TENANT_REQUIRED", async () => {
    const app = await boot();
    const res = await post(app, "/api/signup", {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("provisions on the first verification and hands over a six-digit PIN once", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const res = await post(app, "/api/signup/verify", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { code: string; status: string }; adminPin: string | null; alreadyVerified: boolean };
    expect(body.tenant).toMatchObject({ code: "yasmin", status: "active" });
    expect(body.adminPin).toMatch(/^\d{6}$/);
    expect(body.alreadyVerified).toBe(false);
  });

  it("answers a link opened a second time as already verified, with no PIN — never TENANT_CODE_TAKEN for the owner's own account", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const first = (await (await post(app, "/api/signup/verify", { token })).json()) as { adminPin: string };

    const again = await post(app, "/api/signup/verify", { token });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { tenant: { code: string }; adminEmail: string; adminPin: string | null; alreadyVerified: boolean };
    expect(body).toMatchObject({ tenant: { code: "yasmin" }, adminEmail: "owner@yasmin.example", adminPin: null, alreadyVerified: true });

    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "yasmin" },
        body: JSON.stringify({ username: "owner@yasmin.example", pin: first.adminPin }),
      }),
    );
    expect(login.status).toBe(200);
  });

  it("answers a signup posted with a trailing slash the same as one without", async () => {
    const app = await boot();
    const res = await post(app, "/api/signup/", {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("carries the body of a signup posted with a trailing slash through to a real signup", async () => {
    const app = await boot();
    const started = await post(app, "/api/signup/", {
      code: "slashed",
      nameAr: "متجر الشرطة",
      ownerEmail: "owner@slashed.example",
      ownerNameAr: "سلمى",
      planId: "PLAN-CORE",
      billingCycle: "monthly",
    });
    expect(started.status).toBe(201);
    const { devVerifyUrl } = (await started.json()) as { devVerifyUrl: string };
    const token = new URL(devVerifyUrl).searchParams.get("token") ?? "";

    const verified = await post(app, "/api/signup/verify", { token });

    expect(verified.status).toBe(200);
    expect(((await verified.json()) as VerifyBody).tenant).toMatchObject({ code: "slashed", status: "active" });
  });

  it("provisions once when the same link is posted twice at the same moment, and never tells the owner their code is taken", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");

    const answers = await Promise.all([post(app, "/api/signup/verify", { token }), post(app, "/api/signup/verify", { token })]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    const pins = bodies.map((body) => body.adminPin).filter((pin): pin is string => pin !== null);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatch(/^\d{6}$/);
    expect(bodies.map((body) => body.alreadyVerified).sort()).toEqual([false, true]);
    expect(bodies.map((body) => body.tenant.status)).toEqual(["active", "active"]);
    expect(new Set(bodies.map((body) => body.tenant.id)).size).toBe(1);
    expect((await listedTenantCodes(app)).filter((code) => code === "yasmin")).toHaveLength(1);

    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "yasmin" },
        body: JSON.stringify({ username: "owner@yasmin.example", pin: pins[0] }),
      }),
    );
    expect(login.status).toBe(200);
  });

  it("still answers already verified, with no PIN, for a tenant the operator has suspended", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const first = (await (await post(app, "/api/signup/verify", { token })).json()) as VerifyBody;
    await moveTenant(app, first.tenant.id, TenantTransition.Suspend);

    const again = await post(app, "/api/signup/verify", { token });

    expect(again.status).toBe(200);
    expect((await again.json()) as VerifyBody).toMatchObject({ tenant: { code: "yasmin", status: "suspended" }, adminPin: null, alreadyVerified: true });
  });

  it("does not call an archived tenant an activated account", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const first = (await (await post(app, "/api/signup/verify", { token })).json()) as VerifyBody;
    await moveTenant(app, first.tenant.id, TenantTransition.Archive);

    const again = await post(app, "/api/signup/verify", { token });

    expect(again.status).toBe(400);
    const body = (await again.json()) as { error: string; alreadyVerified?: boolean; tenant?: unknown };
    expect(body.error).toBe("SIGNUP_TOKEN_INVALID");
    expect(body.alreadyVerified).toBeUndefined();
    expect(body.tenant).toBeUndefined();
  });

  it("refuses at signup a company name longer than the claim accepts, instead of burning the link on a tenant that can never be claimed", async () => {
    const app = await boot();

    const refused = await post(app, "/api/signup", signupBody("toolong", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)));

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
    expect(await listedTenantCodes(app)).not.toContain("toolong");
  });

  it("activates a tenant whose company name is exactly as long as the claim accepts", async () => {
    const app = await boot();
    const longest = "ش".repeat(COMPANY_NAME_MAX_LENGTH);
    const token = await startAndReadToken(app, "longest", `  ${longest}  `);

    const verified = await post(app, "/api/signup/verify", { token });

    expect(verified.status).toBe(200);
    const body = (await verified.json()) as VerifyBody;
    expect(body.tenant.status).toBe("active");
    expect(body.adminPin).toMatch(/^\d{6}$/);
    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "longest" },
        body: JSON.stringify({ username: "owner@longest.example", pin: body.adminPin }),
      }),
    );
    expect(((await login.json()) as { tenantName: string }).tenantName).toBe(longest);
  });

  it.each([
    ["a right-to-left override", "شركة \u202Eevil"],
    ["a directional isolate", "شركة \u2066evil\u2069"],
    ["a line break", "شركة\nالنيل"],
    ["a control character", "شركة\u0007النيل"],
  ])("refuses a company name carrying %s at signup", async (_what, nameAr) => {
    const app = await boot();

    const refused = await post(app, "/api/signup", signupBody("crafted", nameAr));

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("keeps the joiners Arabic-script names are written with", async () => {
    const app = await boot();

    const accepted = await post(app, "/api/signup", signupBody("joiner", "می\u200Cخواهم للتجارة"));

    expect(accepted.status).toBe(201);
  });

  it.each([
    ["longer than the claim accepts", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)],
    ["carrying a right-to-left override", "شركة \u202Eevil"],
  ])("refuses a tenant created in the console with a name %s, and creates nothing", async (_what, nameAr) => {
    const app = await boot();
    const token = await platformBearer(app);

    const refused = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...signupBody("console", nameAr), trial: true }),
      }),
    );

    expect(refused.status).toBe(400);
    expect(await listedTenantCodes(app)).not.toContain("console");
  });

  it.each([
    ["shorter than any token this server issues", "not-a-real-token"],
    ["well-formed but never issued", "A".repeat(43)],
    ["missing", undefined],
  ])("tells the holder of a link whose token is %s that the link is not valid, in Arabic", async (_what, token) => {
    const app = await boot();
    const res = await post(app, "/api/signup/verify", { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "SIGNUP_TOKEN_INVALID", message: "رابط التفعيل غير صالح" });
  });
});

function cloudLogin(app: CloudApp, code: string, pin: string): Promise<Response> {
  return Promise.resolve(
    app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": code },
        body: JSON.stringify({ username: `owner@${code}.example`, pin }),
      }),
    ),
  );
}

function resetOwnerPin(app: CloudApp, tenantId: string, bearer: string | null): Promise<Response> {
  return Promise.resolve(
    app.root.fetch(
      new Request(`http://cloud.internal/api/platform/tenants/${tenantId}/owner-pin/reset`, {
        method: "POST",
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }),
    ),
  );
}

describe("a trailing slash on an /api route", () => {
  it("reaches the same platform, signup and tenant routes, with the request body intact", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify/", { token: await startAndReadToken(app, "slashes") })).json()) as VerifyBody;
    expect(first.tenant).toMatchObject({ code: "slashes", status: "active" });

    const platformLogin = await post(app, "/api/platform/auth/login/", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(platformLogin.status).toBe(200);
    const bearer = ((await platformLogin.json()) as { token: string }).token;

    const tenants = await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants/", { headers: { authorization: `Bearer ${bearer}` } }));
    expect(tenants.status).toBe(200);
    expect(((await tenants.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code)).toContain("slashes");

    const plans = await app.root.fetch(new Request("http://cloud.internal/api/signup/plans/"));
    expect(plans.status).toBe(200);
    expect(((await plans.json()) as unknown[]).length).toBeGreaterThan(0);

    const tenantLoginAnswer = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "slashes" },
        body: JSON.stringify({ username: "owner@slashes.example", pin: first.adminPin }),
      }),
    );
    expect(tenantLoginAnswer.status).toBe(200);
    const session = ((await tenantLoginAnswer.json()) as { token: string }).token;

    const customers = await app.root.fetch(
      new Request("http://cloud.internal/api/customers/?pageSize=5", { headers: { authorization: `Bearer ${session}`, "x-mezan-tenant": "slashes" } }),
    );
    expect(customers.status).toBe(200);
  });

  it("still refuses a tenant route that carries no session, slash or not", async () => {
    const app = await boot();
    await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "closed") });

    const customers = await app.root.fetch(new Request("http://cloud.internal/api/customers/", { headers: { "x-mezan-tenant": "closed" } }));

    expect(customers.status).toBe(401);
  });
});

describe("the platform owner resets a tenant owner's PIN", () => {
  it("issues a new PIN once, retires the old one and ends the owner's open sessions", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "locked") })).json()) as VerifyBody;
    const oldPin = first.adminPin ?? "";
    const session = ((await (await cloudLogin(app, "locked", oldPin)).json()) as { token: string }).token;
    const customers = () =>
      app.root.fetch(new Request("http://cloud.internal/api/customers", { headers: { authorization: `Bearer ${session}`, "x-mezan-tenant": "locked" } }));
    expect((await customers()).status).toBe(200);

    const reset = await resetOwnerPin(app, first.tenant.id, await platformBearer(app));

    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { adminEmail: string; adminPin: string };
    expect(body.adminEmail).toBe("owner@locked.example");
    expect(body.adminPin).toMatch(/^[0-9]{6}$/);
    expect(body.adminPin).not.toBe(oldPin);
    expect((await customers()).status).toBe(401);
    expect((await cloudLogin(app, "locked", oldPin)).status).toBe(401);
    expect((await cloudLogin(app, "locked", body.adminPin)).status).toBe(200);
  });

  it("resets the owner's PIN on a suspended tenant, where the new PIN is accepted once the tenant is resumed", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "paused") })).json()) as VerifyBody;
    const oldPin = first.adminPin ?? "";
    await moveTenant(app, first.tenant.id, TenantTransition.Suspend);

    const reset = await resetOwnerPin(app, first.tenant.id, await platformBearer(app));

    expect(reset.status).toBe(200);
    const { adminPin } = (await reset.json()) as { adminPin: string };
    expect(adminPin).toMatch(/^[0-9]{6}$/);
    expect(adminPin).not.toBe(oldPin);
    await moveTenant(app, first.tenant.id, TenantTransition.Resume);
    expect((await cloudLogin(app, "paused", oldPin)).status).toBe(401);
    expect((await cloudLogin(app, "paused", adminPin)).status).toBe(200);
  });

  it("is refused without a platform session, and for a tenant session", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "guarded") })).json()) as VerifyBody;
    const pin = first.adminPin ?? "";
    const tenantSession = ((await (await cloudLogin(app, "guarded", pin)).json()) as { token: string }).token;

    expect((await resetOwnerPin(app, first.tenant.id, null)).status).toBe(401);
    expect((await resetOwnerPin(app, first.tenant.id, tenantSession)).status).toBe(401);
    expect((await cloudLogin(app, "guarded", pin)).status).toBe(200);
  });

  it("is not reachable on the tenant's own API, with or without the tenant's admin session", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "inside") })).json()) as VerifyBody;
    const pin = first.adminPin ?? "";
    const tenantSession = ((await (await cloudLogin(app, "inside", pin)).json()) as { token: string }).token;

    for (const route of ["/api/owner-pin/reset", "/api/bootstrap/owner-pin", "/api/auth/owner-pin/reset"]) {
      const answer = await app.root.fetch(
        new Request(`http://cloud.internal${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${tenantSession}`, "x-mezan-tenant": "inside" },
          body: JSON.stringify({ email: "owner@inside.example", pin: "000000" }),
        }),
      );
      expect(answer.status, route).toBe(404);
    }
    expect((await cloudLogin(app, "inside", "000000")).status).toBe(401);
  });

  it("answers 404 for a tenant that does not exist", async () => {
    const app = await boot();
    expect((await resetOwnerPin(app, "no-such-tenant", await platformBearer(app))).status).toBe(404);
  });

  it("follows the owner to a new email changed inside the tenant, so the reset still reaches their account", async () => {
    const app = await boot();
    const linkToken = await startAndReadToken(app, "moved");
    const first = (await (await post(app, "/api/signup/verify", { token: linkToken })).json()) as VerifyBody;
    const session = ((await (await cloudLogin(app, "moved", first.adminPin ?? "")).json()) as { token: string }).token;
    const tenantHeaders = { authorization: `Bearer ${session}`, "x-mezan-tenant": "moved", "content-type": "application/json" };
    const users = (await (await app.root.fetch(new Request("http://cloud.internal/api/users", { headers: tenantHeaders }))).json()) as Record<string, unknown>[];
    const owner = users.find((user) => user["email"] === "owner@moved.example");
    const bearer = await platformBearer(app);
    const recordedOwner = async () =>
      ((await (await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants", { headers: { authorization: `Bearer ${bearer}` } }))).json()) as {
        tenant: { code: string; ownerEmail: string };
      }[]).find((row) => row.tenant.code === "moved")?.tenant.ownerEmail;

    const changed = await app.root.fetch(
      new Request(`http://cloud.internal/api/users/${String(owner?.["id"])}`, {
        method: "PUT",
        headers: tenantHeaders,
        body: JSON.stringify({ ...owner, email: " Sara@Moved-Shop.example " }),
      }),
    );

    expect(changed.status).toBe(200);
    expect(await recordedOwner()).toBe("sara@moved-shop.example");
    const reopened = await post(app, "/api/signup/verify", { token: linkToken });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()) as VerifyBody).toMatchObject({ adminEmail: "sara@moved-shop.example", adminPin: null, alreadyVerified: true });
    const reset = await resetOwnerPin(app, first.tenant.id, bearer);
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { adminEmail: string; adminPin: string };
    expect(body.adminEmail).toBe("sara@moved-shop.example");
    const signedIn = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "moved" },
        body: JSON.stringify({ username: "sara@moved-shop.example", pin: body.adminPin }),
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
    const router = createTenantRouter({ platform: { ...platform, stores: { ...platform.stores, tenants } }, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    routers.push(router);
    const { adminPin } = await provisionTenant(
      { code: "steady", nameAr: "ثابتة", ownerEmail: "owner@steady.example", ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false },
      { platform, router, now: () => new Date(T) },
    );
    router.invalidate("steady");
    const session = ((await (await tenantLogin(router, "steady", adminPin)).json()) as { token: string }).token;
    const call = (method: string, route: string, body?: unknown) =>
      Promise.resolve(
        router.app.fetch(
          new Request(`http://ignored${route}`, {
            method,
            headers: { authorization: `Bearer ${session}`, [TENANT_HEADER]: "steady", "content-type": "application/json" },
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
    const refused = await call("PUT", `/users/${String(owner?.["id"])}`, { ...owner, email: "new@steady.example" });

    expect(refused.status).toBe(200);
    expect((await platform.stores.tenants.findByCode("steady"))?.ownerEmail).toBe("owner@steady.example");
    const after = (await (await call("GET", "/users")).json()) as Record<string, unknown>[];
    expect(after.find((user) => user["id"] === owner?.["id"])?.["email"]).toBe("new@steady.example");
  });

  it("records the operator who retried a provision as the actor of the tenant's PIN reset", async () => {
    const app = await boot();
    const bearer = await platformBearer(app);
    const console_ = (route: string, body?: unknown) =>
      app.root.fetch(
        new Request(`http://cloud.internal/api/platform${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    const operator = (await (await console_("/auth/me")).json()) as { id: string };
    expect((await console_("/plans/PLAN-CORE/retire", {})).status).toBe(200);
    const failed = await console_("/tenants", { ...signupBody("retried", "منشأة أعيد تجهيزها"), trial: false });
    expect(failed.status).toBe(422);
    const { tenantId } = (await failed.json()) as { tenantId: string };

    const retried = await console_(`/tenants/${tenantId}/provision`, { planId: "PLAN-BUSINESS", billingCycle: "monthly" });

    expect(retried.status).toBe(200);
    const { adminPin } = (await retried.json()) as { adminPin: string };
    const session = ((await (await cloudLogin(app, "retried", adminPin)).json()) as { token: string }).token;
    const audit = await app.root.fetch(
      new Request("http://cloud.internal/api/audit?stream=security&action=OWNER_PIN_RESET", { headers: { authorization: `Bearer ${session}`, "x-mezan-tenant": "retried" } }),
    );
    expect(audit.status).toBe(200);
    const { events } = (await audit.json()) as { events: { action: string; actor: string }[] };
    expect(events.map((row) => row.actor)).toEqual([`platform:${operator.id}`]);
  });
});

interface SignupProcess {
  readonly signup: Hono;
  readonly router: TenantRouter;
}

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

type SignupStores = PlatformHandle["stores"];

interface SignupProcessOptions {
  readonly saveSubscription?: (save: SaveSubscription) => SaveSubscription;
  readonly now?: () => Date;
  readonly stores?: (stores: SignupStores) => Partial<SignupStores>;
  readonly provisionWaitMs?: number;
  readonly provisionHeartbeatMs?: number;
}

function signupProcess(platform: PlatformHandle, dataDir: string, options: SignupProcessOptions | SignupProcessOptions["saveSubscription"] = {}): SignupProcess {
  const { saveSubscription, now = () => new Date(T), stores, provisionWaitMs, provisionHeartbeatMs } = typeof options === "function" ? { saveSubscription: options } : options;
  const router = createTenantRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now,
    openBackend: async (_code, dbPath, resolvers) => {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      return createBackend({
        dbPath,
        resolveEntitlements: () => resolvers.resolveEntitlements(),
        resolveLicenseState: () => resolvers.resolveLicenseState(),
      });
    },
  });
  routers.push(router);
  const subscriptions = Object.create(platform.stores.subscriptions) as SignupStores["subscriptions"];
  if (saveSubscription) subscriptions.save = saveSubscription((subscription) => platform.stores.subscriptions.save(subscription));
  const withSubscriptions: SignupStores = saveSubscription ? { ...platform.stores, subscriptions } : platform.stores;
  const seen: PlatformHandle = { ...platform, stores: { ...withSubscriptions, ...stores?.(withSubscriptions) } };
  const signup = reachable(createSignupRoutes({ platform: seen, router, env: { ...parseEnv({}), platformDir: dataDir }, now, provisionWaitMs, provisionHeartbeatMs }));
  return { signup, router };
}

function deferred(): { readonly reached: Promise<void>; readonly promise: Promise<void>; arrive(): void; release(): void } {
  let release = (): void => undefined;
  let arrive = (): void => undefined;
  const promise = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  return { reached, promise, arrive, release };
}

function stallingAfterThePin(gate: ReturnType<typeof deferred>): (stores: SignupStores) => Partial<SignupStores> {
  return (stores) => {
    const subscriptions = Object.create(stores.subscriptions) as SignupStores["subscriptions"];
    subscriptions.findLiveByTenant = async (tenantId) => {
      gate.arrive();
      await gate.promise;
      return stores.subscriptions.findLiveByTenant(tenantId);
    };
    return { subscriptions };
  };
}

function send(app: Hono, route: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://signup.internal${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
  );
}

async function startOn(app: Hono, code: string): Promise<string> {
  const started = await send(app, "/", signupBody(code, "متجر الياسمين"));
  expect(started.status).toBe(201);
  return new URL(((await started.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
}

function tenantLogin(router: TenantRouter, code: string, pin: string | null): Promise<Response> {
  return Promise.resolve(
    router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: code },
        body: JSON.stringify({ username: `owner@${code}.example`, pin }),
      }),
    ),
  );
}

function failOnce(): (save: SaveSubscription) => SaveSubscription {
  let failed = false;
  return (save) => async (subscription) => {
    if (!failed) {
      failed = true;
      throw new Error("the platform database refused the subscription");
    }
    await save(subscription);
  };
}

describe("signup verification when provisioning fails or is shared between processes", () => {
  it("hands the owner a fresh PIN when the link is opened again after a provision that failed once the admin existed", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const { signup, router } = signupProcess(platform, dataDir, failOnce());
    const token = await startOn(signup, "retry");

    const first = await send(signup, "/verify", { token });
    expect(first.status).toBe(500);
    expect(((await first.json()) as { error: string }).error).toBe("TENANT_PROVISIONING_FAILED");

    const again = await send(signup, "/verify", { token });
    expect(again.status).toBe(200);
    const body = (await again.json()) as VerifyBody;
    expect(body.tenant.status).toBe("active");
    expect(body.adminPin).toMatch(/^\d{6}$/);
    expect(body.alreadyVerified).toBe(false);
    expect((await tenantLogin(router, "retry", body.adminPin)).status).toBe(200);

    const third = await send(signup, "/verify", { token });
    expect((await third.json()) as VerifyBody).toMatchObject({ adminPin: null, alreadyVerified: true });
    expect((await tenantLogin(router, "retry", body.adminPin)).status).toBe(200);
  });

  it("provisions a link once when two server processes on one platform database verify it at the same moment", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const one = signupProcess(platform, dataDir);
    const two = signupProcess(await openPlatform(dataDir), dataDir);
    const token = await startOn(one.signup, "twice");

    const answers = await Promise.all([send(one.signup, "/verify", { token }), send(two.signup, "/verify", { token })]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    const pins = bodies.map((body) => body.adminPin).filter((pin): pin is string => pin !== null);
    expect(pins).toHaveLength(1);
    expect(bodies.map((body) => body.alreadyVerified).sort()).toEqual([false, true]);
    expect(new Set(bodies.map((body) => body.tenant.id)).size).toBe(1);
    expect((await platform.stores.tenants.list()).filter((tenant) => tenant.code === "twice")).toHaveLength(1);
    expect((await tenantLogin(one.router, "twice", pins[0] ?? null)).status).toBe(200);
  });

  it("answers the provisioning failure itself when the tenant was archived while it failed, not an invalid link", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const { signup } = signupProcess(platform, dataDir, () => async (subscription) => {
      const tenant = await platform.stores.tenants.findById(subscription.tenantId);
      if (tenant) await platform.stores.tenants.save({ ...tenant, status: TenantStatusCode.Archived });
      throw new Error("the platform database refused the subscription");
    });
    const token = await startOn(signup, "masked");

    const answer = await send(signup, "/verify", { token });

    expect(answer.status).toBe(500);
    expect(((await answer.json()) as { error: string }).error).toBe("TENANT_PROVISIONING_FAILED");
  });
});

describe("a signup verification whose provisioning claim is contested", () => {
  const LATER = "2026-01-15T00:03:00.000Z";

  it("hands exactly one working PIN when a second process takes a stalled provision over and the first then wakes up", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const stalled = deferred();
    const takeover = deferred();
    const waiting = deferred();
    const first = signupProcess(platform, dataDir, {
      stores: (stores) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.provisioningClaimedAt = async (tokenHash) => {
          waiting.arrive();
          return stores.signupRequests.provisioningClaimedAt(tokenHash);
        };
        return { ...stallingAfterThePin(stalled)(stores), signupRequests };
      },
    });
    const second = signupProcess(await openPlatform(dataDir), dataDir, { now: () => new Date(LATER), stores: stallingAfterThePin(takeover) });
    const token = await startOn(first.signup, "contested");

    const slow = send(first.signup, "/verify", { token });
    await stalled.reached;
    const fast = send(second.signup, "/verify", { token });
    await takeover.reached;
    stalled.release();
    await Promise.race([slow, waiting.reached]);
    takeover.release();

    const answers = await Promise.all([slow, fast]);
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const pins = bodies.map((body) => body.adminPin).filter((pin): pin is string => pin !== null);
    expect(pins).toHaveLength(1);
    expect((await tenantLogin(second.router, "contested", pins[0] ?? null)).status).toBe(200);
    expect(bodies[0]).toMatchObject({ adminPin: null, alreadyVerified: true });
    expect(bodies[1]).toMatchObject({ alreadyVerified: false });
    expect((await platform.stores.subscriptions.listByTenant(bodies[1]?.tenant.id ?? "")).length).toBe(1);
  });

  it("never hands out a dead PIN when a holder freezes after its last claim check, just before it writes the PIN, and is superseded meanwhile", async () => {
    const EVEN_LATER = "2026-01-15T00:06:00.000Z";
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const firstStalled = deferred();
    const frozenBeforeThePin = deferred();
    const first = signupProcess(platform, dataDir, { stores: stallingAfterThePin(firstStalled) });
    let checks = 0;
    const second = signupProcess(await openPlatform(dataDir), dataDir, {
      now: () => new Date(LATER),
      stores: (stores) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.renewProvisioning = async (...args) => {
          const ours = await stores.signupRequests.renewProvisioning(...args);
          if ((checks += 1) === 1) {
            frozenBeforeThePin.arrive();
            await frozenBeforeThePin.promise;
          }
          return ours;
        };
        return { signupRequests };
      },
    });
    const third = signupProcess(await openPlatform(dataDir), dataDir, { now: () => new Date(EVEN_LATER) });
    const token = await startOn(first.signup, "frozen");

    const abandoned = send(first.signup, "/verify", { token });
    await firstStalled.reached;
    const superseded = send(second.signup, "/verify", { token });
    await frozenBeforeThePin.reached;
    const winner = await send(third.signup, "/verify", { token });
    frozenBeforeThePin.release();
    firstStalled.release();

    const answers = [await abandoned, await superseded, winner];
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    const pins = bodies.map((body) => body.adminPin).filter((pin): pin is string => pin !== null);
    expect(pins).toEqual([bodies[2]?.adminPin]);
    expect((await tenantLogin(third.router, "frozen", pins[0] ?? null)).status).toBe(200);
  });

  it("answers 503 with a retry hint to a second opener that outwaits a live provision, without writing to the platform database while it waits", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const stalled = deferred();
    const holder = signupProcess(platform, dataDir, { stores: stallingAfterThePin(stalled) });
    let claimAttempts = 0;
    let claimReads = 0;
    const waiter = signupProcess(await openPlatform(dataDir), dataDir, {
      provisionWaitMs: 400,
      stores: (stores) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.tryClaimProvisioning = async (...args) => {
          claimAttempts += 1;
          return stores.signupRequests.tryClaimProvisioning(...args);
        };
        signupRequests.provisioningClaimedAt = async (tokenHash) => {
          claimReads += 1;
          return stores.signupRequests.provisioningClaimedAt(tokenHash);
        };
        return { signupRequests };
      },
    });
    const token = await startOn(holder.signup, "patient");

    const held = send(holder.signup, "/verify", { token });
    await stalled.reached;
    const busy = await send(waiter.signup, "/verify", { token });

    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(await busy.json()).toEqual({ error: "SIGNUP_VERIFICATION_IN_PROGRESS", message: "جارٍ تفعيل الحساب الآن. أعد فتح الرابط بعد لحظات." });
    expect(claimAttempts).toBe(0);
    expect(claimReads).toBeGreaterThan(1);
    expect(claimReads).toBeLessThanOrEqual(5);

    stalled.release();
    const delivered = (await (await held).json()) as VerifyBody;
    expect(delivered.adminPin).toMatch(/^\d{6}$/);
    expect((await tenantLogin(holder.router, "patient", delivered.adminPin)).status).toBe(200);
    const reopened = await send(waiter.signup, "/verify", { token });
    expect((await reopened.json()) as VerifyBody).toMatchObject({ adminPin: null, alreadyVerified: true });
  });

  it("keeps a slow but living provision's claim, so a later opener waits instead of taking it over", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const stalled = deferred();
    const renewed = deferred();
    let holderClock = T;
    const holder = signupProcess(platform, dataDir, {
      now: () => new Date(holderClock),
      provisionHeartbeatMs: 10,
      stores: (stores) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.renewProvisioning = async (tokenHash, claimId, nowIso) => {
          const kept = await stores.signupRequests.renewProvisioning(tokenHash, claimId, nowIso);
          if (nowIso === LATER) renewed.arrive();
          return kept;
        };
        return { ...stallingAfterThePin(stalled)(stores), signupRequests };
      },
    });
    const later = signupProcess(await openPlatform(dataDir), dataDir, { now: () => new Date(LATER), provisionWaitMs: 100 });
    const token = await startOn(holder.signup, "living");

    const held = send(holder.signup, "/verify", { token });
    await stalled.reached;
    holderClock = LATER;
    await renewed.reached;
    const busy = await send(later.signup, "/verify", { token });

    expect(busy.status).toBe(503);
    stalled.release();
    const delivered = (await (await held).json()) as VerifyBody;
    expect(delivered).toMatchObject({ alreadyVerified: false });
    expect((await tenantLogin(holder.router, "living", delivered.adminPin)).status).toBe(200);
  });
});

describe("a verification link long after it was used", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("answers already activated for thirty days, then retires: no PIN, no account details, nothing provisioned or claimed", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    let clock = new Date(T).getTime();
    let claimAttempts = 0;
    const { signup, router } = signupProcess(platform, dataDir, {
      now: () => new Date(clock),
      stores: (stores) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.tryClaimProvisioning = async (...args) => {
          claimAttempts += 1;
          return stores.signupRequests.tryClaimProvisioning(...args);
        };
        return { signupRequests };
      },
    });
    const token = await startOn(signup, "aged");
    const first = (await (await send(signup, "/verify", { token })).json()) as VerifyBody;
    const tenantBefore = await platform.stores.tenants.findByCode("aged");

    clock += 30 * DAY_MS;
    const onTheLastDay = await send(signup, "/verify", { token });
    expect(onTheLastDay.status).toBe(200);
    expect((await onTheLastDay.json()) as VerifyBody).toMatchObject({ adminPin: null, alreadyVerified: true });
    const attemptsWhileValid = claimAttempts;

    clock += 1;
    const retired = await send(signup, "/verify", { token });

    expect(retired.status).toBe(410);
    expect(await retired.json()).toEqual({ error: "SIGNUP_ALREADY_ACTIVATED", message: "تم تفعيل هذا الحساب مسبقًا. سجّل الدخول برمز منشأتك وبريدك." });
    expect(claimAttempts).toBe(attemptsWhileValid);
    expect(await platform.stores.tenants.findByCode("aged")).toEqual(tenantBefore);
    expect((await platform.stores.subscriptions.listByTenant(first.tenant.id)).length).toBe(1);
    expect((await tenantLogin(router, "aged", first.adminPin)).status).toBe(200);
  });
});

describe("a stored subscription status this build does not know", () => {
  it("is shown as unknown on that tenant's row and its own billing card, while every other tenant still lists", async () => {
    const app = await boot();
    const odd = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "oddone") })).json()) as VerifyBody;
    await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "fineone") });
    const session = ((await (await cloudLogin(app, "oddone", odd.adminPin ?? "")).json()) as { token: string }).token;
    const raw = openSqliteConnection(path.join(dirs[dirs.length - 1] ?? "", "platform.db")).sqlite;
    raw.prepare("UPDATE subscription SET status = 'paused' WHERE tenant_id = ?").run(odd.tenant.id);
    raw.close();

    const listed = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/tenants", { headers: { authorization: `Bearer ${await platformBearer(app)}` } }),
    );

    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as { tenant: { code: string }; subscription: { status: string } | null }[];
    expect(Object.fromEntries(rows.map((row) => [row.tenant.code, row.subscription?.status]))).toEqual({
      oddone: SubscriptionStatusCode.Unknown,
      fineone: SubscriptionStatusCode.Trialing,
    });
    const billing = await app.root.fetch(
      new Request("http://cloud.internal/api/billing/subscription", { headers: { authorization: `Bearer ${session}`, "x-mezan-tenant": "oddone" } }),
    );
    expect(billing.status).toBe(200);
    expect(((await billing.json()) as { subscription: { status: string } }).subscription.status).toBe(SubscriptionStatusCode.Unknown);
  });

  it("is refused on the way in, so it can only arrive from outside the product", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    routers.push(router);
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

describe("the address a signup is counted against", () => {
  const STARTS_PER_SOURCE_PER_HOUR = 8;

  async function proxiedSignup(): Promise<Hono> {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const router = createTenantRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    routers.push(router);
    const env = { ...parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" }), platformDir: dataDir };
    return createSignupRoutes({ platform, router, env, now: () => new Date(T), sourceReporter: { unresolved: () => undefined, viewerMismatch: () => undefined } });
  }

  const startFrom = (app: Hono, chain: string | null) =>
    Promise.resolve(
      app.fetch(
        new Request("http://signup.internal/", {
          method: "POST",
          headers: { "content-type": "application/json", ...(chain === null ? {} : { "x-forwarded-for": chain }) },
          body: "{}",
        }),
      ),
    );

  it("throttles the hop the trusted proxy appended, however the caller rewrites the hops ahead of it", async () => {
    const app = await proxiedSignup();

    const statuses: number[] = [];
    for (let n = 0; n <= STARTS_PER_SOURCE_PER_HOUR; n += 1) statuses.push((await startFrom(app, `203.0.113.${n}, 41.33.10.10, 130.176.0.7`)).status);

    expect(statuses).toEqual([...Array.from({ length: STARTS_PER_SOURCE_PER_HOUR }, () => 400), 429]);
  });

  it("does not throttle a caller because another caller wrote its address first in the chain", async () => {
    const app = await proxiedSignup();
    for (let n = 0; n <= STARTS_PER_SOURCE_PER_HOUR; n += 1) await startFrom(app, "41.33.10.11, 41.33.10.10, 130.176.0.7");

    expect((await startFrom(app, "41.33.10.11, 130.176.0.7")).status).toBe(400);
  });

  it("refuses a request whose chain is too short to hold the caller's address, instead of counting it as the proxy", async () => {
    const app = await proxiedSignup();

    const refused = await startFrom(app, "130.176.0.7");
    const bare = await startFrom(app, null);

    expect([refused.status, bare.status]).toEqual([503, 503]);
    expect(await refused.json()).toMatchObject({ error: "SOURCE_UNRESOLVED", message: "تعذّر تحديد مصدر الطلب. حاول مرة أخرى بعد قليل." });
  });
});

