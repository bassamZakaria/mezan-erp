import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { TenantDatabases } from "@mezan/persistence-postgres";
import type { Hono } from "hono";
import { openSqliteConnection } from "@mezan/persistence";
import { SubscriptionStatusCode, type PublicPlanDTO } from "@mezan/contracts";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { createTenant, InvalidTenantTransitionError, PlatformSettingKey, QuotaKind, SignupMode, startSubscription, TenantStatusCode, type Subscription } from "@mezan/domain";
import { releaseProvisioningTenant } from "./release-tenant.js";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { createSignupRoutes } from "./signup-routes.js";
import { platformBearer as bearerHeaders, reachable, rememberPlatformDevice } from "./cloud-harness.js";
import { provisionTenant } from "./provision-tenant.js";
import { createTenantRouter, TENANT_HEADER, type TenantRouter, type TenantRouterOptions } from "./tenant-router.js";
import { COMPANY_NAME_MAX_LENGTH, tenantSchema } from "@mezan/domain";
import { parseEnv } from "./env.js";

function reachableRouter(options: TenantRouterOptions): TenantRouter {
  const router = createTenantRouter(options);
  reachable(router.app);
  return router;
}

const T = "2026-01-15T00:00:00.000Z";
const PG_URL = process.env.MEZAN_TEST_PG_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the two-process signup test runs on Postgres.");

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
  readonly adminPassword: string | null;
  readonly alreadyVerified: boolean;
}

async function boot(mode: SignupMode = SignupMode.Open): Promise<CloudApp> {
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
  if (mode !== SignupMode.Approval) await setSignupMode(app, mode);
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
  const body = (await login.json()) as { token: string };
  rememberPlatformDevice(body);
  return body.token;
}

function platformCall(app: CloudApp, token: string, route: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...bearerHeaders(token), ...(init.body ? { "content-type": "application/json" } : {}) };
  return Promise.resolve(app.root.fetch(new Request(`http://cloud.internal/api/platform${route}`, { ...init, headers })));
}

async function setSignupMode(app: CloudApp, mode: SignupMode): Promise<void> {
  const res = await platformCall(app, await platformBearer(app), "/settings/signup-mode", { method: "PUT", body: JSON.stringify({ mode }) });
  expect(res.status).toBe(200);
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
  const signedIn = (await login.json()) as { token: string };
  rememberPlatformDevice(signedIn);
  const { token } = signedIn;
  const moved = await app.root.fetch(
    new Request(`http://cloud.internal/api/platform/tenants/${tenantId}/${transition}`, {
      method: "POST",
      headers: { ...bearerHeaders(token) },
    }),
  );
  expect(moved.status).toBe(200);
}

async function listedTenantCodes(app: CloudApp): Promise<string[]> {
  const login = await post(app, "/api/platform/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  const signedIn = (await login.json()) as { token: string };
  rememberPlatformDevice(signedIn);
  const { token } = signedIn;
  const listed = await app.root.fetch(new Request("http://cloud.internal/api/platform/tenants", { headers: { ...bearerHeaders(token) } }));
  return ((await listed.json()) as { tenant: { code: string } }[]).map((row) => row.tenant.code);
}

describe("sign-ups the platform owner approves", () => {
  it("holds a verified sign-up for review, then the owner approves it onto the package they pick and receives the password", async () => {
    const app = await boot(SignupMode.Approval);
    const token = await startAndReadToken(app, "reviewme");

    const verified = await post(app, "/api/signup/verify", { token });
    expect(verified.status).toBe(409);
    expect(((await verified.json()) as { error: string }).error).toBe("SIGNUP_AWAITING_APPROVAL");
    expect(await listedTenantCodes(app)).not.toContain("reviewme");
    expect((await post(app, "/api/signup", signupBody("reviewme", "متجر آخر"))).status).toBe(409);

    const owner = await platformBearer(app);
    const queue = (await (await platformCall(app, owner, "/signup-requests")).json()) as { id: string; code: string; ownerEmail: string }[];
    expect(queue).toMatchObject([{ code: "reviewme", ownerEmail: "owner@reviewme.example" }]);

    const approve = (trial: boolean) =>
      platformCall(app, owner, `/signup-requests/${queue[0]!.id}/approve`, { method: "POST", body: JSON.stringify({ planId: "PLAN-CORE", billingCycle: "monthly", trial }) });
    const approved = await approve(false);
    expect(approved.status).toBe(201);
    const result = (await approved.json()) as { tenant: { code: string; status: string }; adminPassword: string };
    expect(result.tenant).toMatchObject({ code: "reviewme", status: "active" });
    expect(result.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await approve(false)).status).toBe(409);
    expect(await (await platformCall(app, owner, "/signup-requests")).json()).toEqual([]);

    const again = await post(app, "/api/signup/verify", { token });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alreadyVerified: true, adminPassword: null });
  });

  it("a rejected sign-up never becomes a company, frees its code, and its link stops working", async () => {
    const app = await boot(SignupMode.Approval);
    const token = await startAndReadToken(app, "nothanks");
    expect((await post(app, "/api/signup/verify", { token })).status).toBe(409);
    const owner = await platformBearer(app);
    const [request] = (await (await platformCall(app, owner, "/signup-requests")).json()) as { id: string }[];

    expect((await platformCall(app, owner, `/signup-requests/${request!.id}/reject`, { method: "POST" })).status).toBe(200);
    expect((await platformCall(app, owner, `/signup-requests/${request!.id}/reject`, { method: "POST" })).status).toBe(409);
    expect(
      (await platformCall(app, owner, `/signup-requests/${request!.id}/approve`, { method: "POST", body: JSON.stringify({ planId: "PLAN-CORE", billingCycle: "monthly", trial: true }) })).status,
    ).toBe(409);
    expect((await post(app, "/api/signup/verify", { token })).status).toBe(400);
    expect(await listedTenantCodes(app)).not.toContain("nothanks");
    expect((await post(app, "/api/signup", signupBody("nothanks", "متجر جديد"))).status).toBe(201);
  });

  it("a sign-up that became a company while sign-up was open never shows as awaiting approval, even after switching to approval", async () => {
    const app = await boot(SignupMode.Open);
    const token = await startAndReadToken(app, "openshop");
    expect((await post(app, "/api/signup/verify", { token })).status).toBe(200);

    await setSignupMode(app, SignupMode.Approval);
    const owner = await platformBearer(app);
    expect(await (await platformCall(app, owner, "/signup-requests")).json()).toEqual([]);
    const again = await post(app, "/api/signup/verify", { token });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alreadyVerified: true });
  });

  it("closed refuses new sign-ups, approval is the default, and only the owner changes the mode", async () => {
    const app = await boot(SignupMode.Approval);
    const status = async () => ((await (await app.root.fetch(new Request("http://cloud.internal/api/signup/status"))).json()) as { mode: string }).mode;
    expect(await status()).toBe("approval");

    await setSignupMode(app, SignupMode.Closed);
    expect(await status()).toBe("closed");
    const refused = await post(app, "/api/signup", signupBody("closedshop", "متجر مغلق"));
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("SIGNUP_CLOSED");

    const noSession = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/settings/signup-mode", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "open" }) }),
    );
    expect(noSession.status).toBe(401);
    expect(await status()).toBe("closed");
  });
});

describe("a sold-out package", () => {
  it("stays on the public list marked sold out, and a new sign-up cannot choose it", async () => {
    const app = await boot();
    const owner = await platformBearer(app);
    const plans = (await (await platformCall(app, owner, "/plans")).json()) as (Record<string, unknown> & { id: string; code: string; status: string })[];
    const core = plans.find((p) => p.id === "PLAN-CORE")!;
    const { id: _id, code: _code, status: _status, createdAt: _createdAt, features: _features, ...editable } = core;
    const marked = await platformCall(app, owner, "/plans/PLAN-CORE", { method: "PUT", body: JSON.stringify({ ...editable, soldOut: true }) });
    expect(marked.status).toBe(200);

    const listed = (await (await app.root.fetch(new Request("http://cloud.internal/api/signup/plans"))).json()) as { id: string; soldOut: boolean }[];
    expect(listed.find((p) => p.id === "PLAN-CORE")?.soldOut).toBe(true);
    const refused = await post(app, "/api/signup", signupBody("latecomer", "متجر متأخر"));
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { message: string }).message).toContain("نفدت");
  });
});

describe("self-serve signup routes", () => {
  it("answers a signup posted to /api/signup itself, not the tenant router's TENANT_REQUIRED", async () => {
    const app = await boot();
    const res = await post(app, "/api/signup", {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("provisions on the first verification and hands over a generated password once", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const res = await post(app, "/api/signup/verify", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { code: string; status: string }; adminPassword: string | null; alreadyVerified: boolean };
    expect(body.tenant).toMatchObject({ code: "yasmin", status: "active" });
    expect(body.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(body.alreadyVerified).toBe(false);
  });

  it("answers a link opened a second time as already verified, with no password — never TENANT_CODE_TAKEN for the owner's own account", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const first = (await (await post(app, "/api/signup/verify", { token })).json()) as { adminPassword: string };

    const again = await post(app, "/api/signup/verify", { token });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { tenant: { code: string }; adminEmail: string; adminPassword: string | null; alreadyVerified: boolean };
    expect(body).toMatchObject({ tenant: { code: "yasmin" }, adminEmail: "owner@yasmin.example", adminPassword: null, alreadyVerified: true });

    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "yasmin" },
        body: JSON.stringify({ username: "owner@yasmin.example", password: first.adminPassword }),
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
    const passwords = bodies.map((body) => body.adminPassword).filter((password): password is string => password !== null);
    expect(passwords).toHaveLength(1);
    expect(passwords[0]).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(bodies.map((body) => body.alreadyVerified).sort()).toEqual([false, true]);
    expect(bodies.map((body) => body.tenant.status)).toEqual(["active", "active"]);
    expect(new Set(bodies.map((body) => body.tenant.id)).size).toBe(1);
    expect((await listedTenantCodes(app)).filter((code) => code === "yasmin")).toHaveLength(1);

    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "yasmin" },
        body: JSON.stringify({ username: "owner@yasmin.example", password: passwords[0] }),
      }),
    );
    expect(login.status).toBe(200);
  });

  it("still answers already verified, with no password, for a tenant the operator has suspended", async () => {
    const app = await boot();
    const token = await startAndReadToken(app, "yasmin");
    const first = (await (await post(app, "/api/signup/verify", { token })).json()) as VerifyBody;
    await moveTenant(app, first.tenant.id, TenantTransition.Suspend);

    const again = await post(app, "/api/signup/verify", { token });

    expect(again.status).toBe(200);
    expect((await again.json()) as VerifyBody).toMatchObject({ tenant: { code: "yasmin", status: "suspended" }, adminPassword: null, alreadyVerified: true });
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
    expect(body.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mezan-tenant": "longest" },
        body: JSON.stringify({ username: "owner@longest.example", password: body.adminPassword }),
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
        headers: { "content-type": "application/json", ...bearerHeaders(token) },
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
    const first = (await (await post(app, "/api/signup/verify/", { token: await startAndReadToken(app, "slashes") })).json()) as VerifyBody;
    expect(first.tenant).toMatchObject({ code: "slashes", status: "active" });

    const platformLogin = await post(app, "/api/platform/auth/login/", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    expect(platformLogin.status).toBe(200);
    const platformSession = (await platformLogin.json()) as { token: string };
    rememberPlatformDevice(platformSession);
    const bearer = platformSession.token;

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

    expect(plans.find((plan) => plan.code === "free")?.quotas).toEqual({ [QuotaKind.SalesInvoicesPerMonth]: 100 });
    expect(plans.find((plan) => plan.code === "core")?.quotas).toEqual({});
  });

  it("still refuses a tenant route that carries no session, slash or not", async () => {
    const app = await boot();
    await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "closed") });

    const customers = await app.root.fetch(new Request("http://cloud.internal/api/customers/", { headers: { "x-mezan-tenant": "closed" } }));

    expect(customers.status).toBe(401);
  });
});

describe("the platform owner resets a tenant owner's password", () => {
  it("issues a new password once, retires the old one and ends the owner's open sessions", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "locked") })).json()) as VerifyBody;
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
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "paused") })).json()) as VerifyBody;
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
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "guarded") })).json()) as VerifyBody;
    const password = first.adminPassword ?? "";
    const tenantSession = ((await (await cloudLogin(app, "guarded", password)).json()) as { token: string }).token;

    expect((await resetOwnerPassword(app, first.tenant.id, null)).status).toBe(401);
    expect((await resetOwnerPassword(app, first.tenant.id, tenantSession)).status).toBe(401);
    expect((await cloudLogin(app, "guarded", password)).status).toBe(200);
  });

  it("is not reachable on the tenant's own API, with or without the tenant's admin session", async () => {
    const app = await boot();
    const first = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "inside") })).json()) as VerifyBody;
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
    const linkToken = await startAndReadToken(app, "moved");
    const first = (await (await post(app, "/api/signup/verify", { token: linkToken })).json()) as VerifyBody;
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
    const reopened = await post(app, "/api/signup/verify", { token: linkToken });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()) as VerifyBody).toMatchObject({ adminEmail: "sara@moved-shop.example", adminPassword: null, alreadyVerified: true });
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
    const failed = await console_("/tenants", { ...signupBody("retried", "منشأة أعيد تجهيزها"), trial: false });
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
  await platform.stores.settings.set(PlatformSettingKey.SignupMode, SignupMode.Open, T);
  return platform;
}

type SignupStores = PlatformHandle["stores"];

interface SignupProcessOptions {
  readonly saveSubscription?: (save: SaveSubscription) => SaveSubscription;
  readonly now?: () => Date;
  readonly stores?: (stores: SignupStores, outsideTheTurn: PlatformHandle["outsideTheTurn"]) => Partial<SignupStores>;
  readonly provisionWaitMs?: number;
  readonly provisionHeartbeatMs?: number;
  readonly postgres?: TenantRouterOptions["postgres"];
}

function signupProcess(platform: PlatformHandle, dataDir: string, options: SignupProcessOptions | SignupProcessOptions["saveSubscription"] = {}): SignupProcess {
  const { saveSubscription, now = () => new Date(T), stores, provisionWaitMs, provisionHeartbeatMs, postgres } = typeof options === "function" ? { saveSubscription: options } : options;
  const router = reachableRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now,
    ...(postgres ? { postgres } : {}),
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
  const seen: PlatformHandle = { ...platform, stores: { ...withSubscriptions, ...stores?.(withSubscriptions, platform.outsideTheTurn) } };
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

// A frozen process holds nothing of its own platform connection while it is
// frozen, so the stall is taken with the turn handed back.
function stallingAfterThePassword(gate: ReturnType<typeof deferred>): (stores: SignupStores, outsideTheTurn: PlatformHandle["outsideTheTurn"]) => Partial<SignupStores> {
  return (stores, outsideTheTurn) => {
    const subscriptions = Object.create(stores.subscriptions) as SignupStores["subscriptions"];
    subscriptions.findLiveByTenant = async (tenantId) => {
      gate.arrive();
      await outsideTheTurn(() => gate.promise);
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

function tenantLogin(router: TenantRouter, code: string, password: string | null): Promise<Response> {
  return Promise.resolve(
    router.app.fetch(
      new Request("http://ignored/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", [TENANT_HEADER]: code },
        body: JSON.stringify({ username: `owner@${code}.example`, password }),
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

describe("a sign-up awaiting approval whose company an approval left half-made", () => {
  it("is not finished by the visitor's own link: it keeps waiting for the owner", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    await platform.stores.settings.set(PlatformSettingKey.SignupMode, SignupMode.Approval, T);
    const { signup } = signupProcess(platform, dataDir);
    const token = await startOn(signup, "halfmade");
    expect((await send(signup, "/verify", { token })).status).toBe(409);

    await createTenant({ id: "T-HALF", code: "halfmade", nameAr: "منشأة", ownerEmail: "owner@halfmade.example", now: T }, platform.stores.tenants);
    const again = await send(signup, "/verify", { token });

    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("SIGNUP_AWAITING_APPROVAL");
    expect((await platform.stores.tenants.findById("T-HALF"))?.status).toBe(TenantStatusCode.Provisioning);
    expect((await platform.stores.signupRequests.listAwaitingDecision(T)).map((r) => r.code)).toEqual(["halfmade"]);
  });
});

describe("signup verification when provisioning fails or is shared between processes", () => {
  it("hands the owner a fresh password when the link is opened again after a provision that failed once the admin existed", async () => {
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
    expect(body.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(body.alreadyVerified).toBe(false);
    expect((await tenantLogin(router, "retry", body.adminPassword)).status).toBe(200);

    const third = await send(signup, "/verify", { token });
    expect((await third.json()) as VerifyBody).toMatchObject({ adminPassword: null, alreadyVerified: true });
    expect((await tenantLogin(router, "retry", body.adminPassword)).status).toBe(200);
  });

  // Two SQLite connections in ONE event loop cannot model two processes: an async
  // BEGIN IMMEDIATE on one blocks the thread the other needs to commit. The cloud
  // shares its platform database across processes on Postgres, so this runs there.
  it.skipIf(!PG_URL)("provisions a link once when two server processes on one platform database verify it at the same moment", async () => {
    const dataDir = platformDir();
    const schema = `t_signup_${randomUUID().replaceAll("-", "")}`;
    const processes = [new TenantDatabases({ connectionString: PG_URL!, secret: "d".repeat(64) }), new TenantDatabases({ connectionString: PG_URL!, secret: "d".repeat(64) })];
    await processes[0]!.provision(schema);
    const openPgPlatform = async (databases: TenantDatabases): Promise<PlatformHandle> => {
      const opened = await createPlatform({ db: databases.get(schema).db, auditChainKey: "c".repeat(64), fallbackBase: path.join(dataDir, "platform"), now: () => new Date(T) });
      platforms.push(opened);
      await opened.stores.settings.set(PlatformSettingKey.SignupMode, SignupMode.Open, T);
      return opened;
    };
    onTestFinished(async () => {
      await processes[1]!.close();
      for (const tenant of await platform.stores.tenants.list()) await processes[0]!.drop(tenantSchema(tenant.id));
      await processes[0]!.drop(schema);
      await processes[0]!.close();
    });
    const platform = await openPgPlatform(processes[0]!);
    const one = signupProcess(platform, dataDir, { postgres: { databases: processes[0]!, auditChainKey: "c".repeat(64) } });
    const two = signupProcess(await openPgPlatform(processes[1]!), dataDir, { postgres: { databases: processes[1]!, auditChainKey: "c".repeat(64) } });
    const token = await startOn(one.signup, "twice");

    const answers = await Promise.all([send(one.signup, "/verify", { token }), send(two.signup, "/verify", { token })]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    const passwords = bodies.map((body) => body.adminPassword).filter((password): password is string => password !== null);
    expect(passwords).toHaveLength(1);
    expect(bodies.map((body) => body.alreadyVerified).sort()).toEqual([false, true]);
    expect(new Set(bodies.map((body) => body.tenant.id)).size).toBe(1);
    expect((await platform.stores.tenants.list()).filter((tenant) => tenant.code === "twice")).toHaveLength(1);
    expect((await tenantLogin(one.router, "twice", passwords[0] ?? null)).status).toBe(200);
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

  it("hands exactly one working password when a second process takes a stalled provision over and the first then wakes up", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const stalled = deferred();
    const takeover = deferred();
    const waiting = deferred();
    const first = signupProcess(platform, dataDir, {
      stores: (stores, outsideTheTurn) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.provisioningClaimedAt = async (tokenHash) => {
          waiting.arrive();
          return stores.signupRequests.provisioningClaimedAt(tokenHash);
        };
        return { ...stallingAfterThePassword(stalled)(stores, outsideTheTurn), signupRequests };
      },
    });
    const second = signupProcess(await openPlatform(dataDir), dataDir, { now: () => new Date(LATER), stores: stallingAfterThePassword(takeover) });
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
    const passwords = bodies.map((body) => body.adminPassword).filter((password): password is string => password !== null);
    expect(passwords).toHaveLength(1);
    expect((await tenantLogin(second.router, "contested", passwords[0] ?? null)).status).toBe(200);
    expect(bodies[0]).toMatchObject({ adminPassword: null, alreadyVerified: true });
    expect(bodies[1]).toMatchObject({ alreadyVerified: false });
    expect((await platform.stores.subscriptions.listByTenant(bodies[1]?.tenant.id ?? "")).length).toBe(1);
  });

  it("never hands out a dead password when a holder freezes after its last claim check, just before it writes the password, and is superseded meanwhile", async () => {
    const EVEN_LATER = "2026-01-15T00:06:00.000Z";
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const firstStalled = deferred();
    const frozenBeforeThePassword = deferred();
    const first = signupProcess(platform, dataDir, { stores: stallingAfterThePassword(firstStalled) });
    let checks = 0;
    const second = signupProcess(await openPlatform(dataDir), dataDir, {
      now: () => new Date(LATER),
      stores: (stores, outsideTheTurn) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.renewProvisioning = async (...args) => {
          const ours = await stores.signupRequests.renewProvisioning(...args);
          if ((checks += 1) === 1) {
            frozenBeforeThePassword.arrive();
            await outsideTheTurn(() => frozenBeforeThePassword.promise);
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
    await frozenBeforeThePassword.reached;
    const winner = await send(third.signup, "/verify", { token });
    frozenBeforeThePassword.release();
    firstStalled.release();

    const answers = [await abandoned, await superseded, winner];
    const bodies = (await Promise.all(answers.map((answer) => answer.json()))) as VerifyBody[];
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    const passwords = bodies.map((body) => body.adminPassword).filter((password): password is string => password !== null);
    expect(passwords).toEqual([bodies[2]?.adminPassword]);
    expect((await tenantLogin(third.router, "frozen", passwords[0] ?? null)).status).toBe(200);
  });

  it("answers 503 with a retry hint to a second opener that outwaits a live provision, without writing to the platform database while it waits", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const stalled = deferred();
    const holder = signupProcess(platform, dataDir, { stores: stallingAfterThePassword(stalled) });
    let claimAttempts = 0;
    let claimReads = 0;
    const waiter = signupProcess(await openPlatform(dataDir), dataDir, {
      provisionWaitMs: 400,
      stores: (stores, outsideTheTurn) => {
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
    expect(delivered.adminPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await tenantLogin(holder.router, "patient", delivered.adminPassword)).status).toBe(200);
    const reopened = await send(waiter.signup, "/verify", { token });
    expect((await reopened.json()) as VerifyBody).toMatchObject({ adminPassword: null, alreadyVerified: true });
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
      stores: (stores, outsideTheTurn) => {
        const signupRequests = Object.create(stores.signupRequests) as SignupStores["signupRequests"];
        signupRequests.renewProvisioning = async (tokenHash, claimId, nowIso) => {
          const kept = await stores.signupRequests.renewProvisioning(tokenHash, claimId, nowIso);
          if (nowIso === LATER) renewed.arrive();
          return kept;
        };
        return { ...stallingAfterThePassword(stalled)(stores, outsideTheTurn), signupRequests };
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
    expect((await tenantLogin(holder.router, "living", delivered.adminPassword)).status).toBe(200);
  });
});

describe("a verification link long after it was used", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("answers already activated for thirty days, then retires: no password, no account details, nothing provisioned or claimed", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    let clock = new Date(T).getTime();
    let claimAttempts = 0;
    const { signup, router } = signupProcess(platform, dataDir, {
      now: () => new Date(clock),
      stores: (stores, outsideTheTurn) => {
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
    expect((await onTheLastDay.json()) as VerifyBody).toMatchObject({ adminPassword: null, alreadyVerified: true });
    const attemptsWhileValid = claimAttempts;

    clock += 1;
    const retired = await send(signup, "/verify", { token });

    expect(retired.status).toBe(410);
    expect(await retired.json()).toEqual({ error: "SIGNUP_ALREADY_ACTIVATED", message: "تم تفعيل هذا الحساب مسبقًا. سجّل الدخول برمز منشأتك وبريدك." });
    expect(claimAttempts).toBe(attemptsWhileValid);
    expect(await platform.stores.tenants.findByCode("aged")).toEqual(tenantBefore);
    expect((await platform.stores.subscriptions.listByTenant(first.tenant.id)).length).toBe(1);
    expect((await tenantLogin(router, "aged", first.adminPassword)).status).toBe(200);
  });
});

describe("a verification link long after it was used, for an account that never finished activating", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const subscriptionsDown = (): SaveSubscription => async () => {
    throw new Error("the platform database refused the subscription");
  };

  it("says the activation did not complete, instead of telling the owner to sign in to an account that does not open", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    let clock = new Date(T).getTime();
    const { signup } = signupProcess(platform, dataDir, { now: () => new Date(clock), saveSubscription: subscriptionsDown });
    const token = await startOn(signup, "stuck");
    expect((await send(signup, "/verify", { token })).status).toBe(500);
    const tenantBefore = await platform.stores.tenants.findByCode("stuck");
    expect(tenantBefore?.status).toBe(TenantStatusCode.Provisioning);

    clock += 30 * DAY_MS + 1;
    const retired = await send(signup, "/verify", { token });

    expect(retired.status).toBe(409);
    expect(await retired.json()).toEqual({
      error: "SIGNUP_ACTIVATION_INCOMPLETE",
      message: "لم يكتمل تفعيل هذا الحساب، وانتهت صلاحية رابط التفعيل. تواصل مع الدعم لإكمال التفعيل.",
    });
    expect(await platform.stores.tenants.findByCode("stuck")).toEqual(tenantBefore);
    expect(await platform.stores.subscriptions.listByTenant(tenantBefore?.id ?? "")).toEqual([]);
  });
});

describe("releasing a tenant stuck in provisioning", () => {
  const subscriptionsDown = (): SaveSubscription => async () => {
    throw new Error("the platform database refused the subscription");
  };

  async function stuckTenant(code: string) {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const broken = signupProcess(platform, dataDir, { saveSubscription: subscriptionsDown });
    const oldToken = await startOn(broken.signup, code);
    expect((await send(broken.signup, "/verify", { token: oldToken })).status).toBe(500);
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant) throw new Error("the stuck tenant was not created");
    await broken.router.close();
    const working = signupProcess(platform, dataDir);
    return { dataDir, platform, tenant, oldToken, working };
  }

  it("archives it under a code of its own, leaves its database where it was, and frees the code for a new signup that gets a new database", async () => {
    const { dataDir, platform, tenant, oldToken, working } = await stuckTenant("freed");
    const oldFile = path.join(dataDir, tenant.dbFile);
    expect(existsSync(oldFile)).toBe(true);

    const released = await releaseProvisioningTenant({ platform, router: working.router, dataDir, now: () => new Date(T) }, { tenant, actorId: "op-1" });

    expect(released).toMatchObject({ id: tenant.id, status: TenantStatusCode.Archived, code: `released-${tenant.id}` });
    expect(existsSync(oldFile)).toBe(true);
    expect(released.dbFile).toBe(tenant.dbFile);
    expect(await platform.stores.tenants.findByCode("freed")).toBeNull();
    const rows = await platform.audit.query("security");
    expect(rows.filter((row) => row.action === "TENANT_RELEASED")).toMatchObject([
      { entityId: tenant.id, actor: "platform:op-1", details: { code: "freed", releasedAs: `released-${tenant.id}` } },
    ]);

    const stale = await send(working.signup, "/verify", { token: oldToken });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toMatchObject({ error: "SIGNUP_TOKEN_INVALID" });
    expect(await platform.stores.tenants.findByCode("freed")).toBeNull();

    const again = await send(working.signup, "/", { ...signupBody("freed", "متجر جديد"), ownerEmail: "someone-new@freed.example" });
    expect(again.status).toBe(201);
    const newToken = new URL(((await again.json()) as { devVerifyUrl: string }).devVerifyUrl).searchParams.get("token") ?? "";
    const verified = (await (await send(working.signup, "/verify", { token: newToken })).json()) as VerifyBody;
    expect(verified.tenant).toMatchObject({ code: "freed", status: TenantStatusCode.Active });
    expect(verified.tenant.id).not.toBe(tenant.id);
    expect((await platform.stores.tenants.findByCode("freed"))?.dbFile).not.toBe(tenant.dbFile);
    const token = await signInChangingPassword((request) => working.router.app.fetch(request), "http://ignored", "freed", "someone-new@freed.example", verified.adminPassword ?? "");
    const users = (await (
      await working.router.app.fetch(
        new Request("http://ignored/users", { headers: { authorization: `Bearer ${token}`, [TENANT_HEADER]: "freed" } }),
      )
    ).json()) as { email: string }[];
    expect(users.map((user) => user.email)).toContain("someone-new@freed.example");
    expect(users.map((user) => user.email)).not.toContain("owner@freed.example");
  });

  it("refuses a tenant that is not provisioning, and leaves it exactly as it was", async () => {
    const dataDir = platformDir();
    const platform = await openPlatform(dataDir);
    const { signup, router } = signupProcess(platform, dataDir);
    await send(signup, "/verify", { token: await startOn(signup, "live") });
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
    const { router } = signupProcess(platform, dataDir);
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
    const odd = (await (await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "oddone") })).json()) as VerifyBody;
    await post(app, "/api/signup/verify", { token: await startAndReadToken(app, "fineone") });
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
    const router = reachableRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
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
    const router = reachableRouter({ platform, dataDir, sweepEveryMs: 0, now: () => new Date(T) });
    routers.push(router);
    const env = { ...parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" }), platformDir: dataDir };
    return createSignupRoutes({ platform, router, env, now: () => new Date(T), sourceReporter: { unresolved: () => undefined } });
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

