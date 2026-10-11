import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { TenantStatusCode, type Subscription } from "@mezan/domain";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { createSignupRoutes } from "./signup-routes.js";
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

function signupProcess(platform: PlatformHandle, dataDir: string, saveSubscription?: (save: SaveSubscription) => SaveSubscription): SignupProcess {
  const router = createTenantRouter({
    platform,
    dataDir,
    sweepEveryMs: 0,
    now: () => new Date(T),
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
  const subscriptions = Object.create(platform.stores.subscriptions) as PlatformHandle["stores"]["subscriptions"];
  if (saveSubscription) subscriptions.save = saveSubscription((subscription) => platform.stores.subscriptions.save(subscription));
  const seen: PlatformHandle = saveSubscription ? { ...platform, stores: { ...platform.stores, subscriptions } } : platform;
  const signup = createSignupRoutes({ platform: seen, router, env: { ...parseEnv({}), platformDir: dataDir }, now: () => new Date(T) });
  return { signup, router };
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
