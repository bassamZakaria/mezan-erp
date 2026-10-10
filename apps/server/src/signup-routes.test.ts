import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { parseEnv } from "./env.js";

const T = "2026-01-15T00:00:00.000Z";

const apps: CloudApp[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
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

async function startAndReadToken(app: CloudApp, code: string): Promise<string> {
  const started = await post(app, "/api/signup", {
    code,
    nameAr: "متجر الياسمين",
    ownerEmail: `owner@${code}.example`,
    ownerNameAr: "سارة",
    planId: "PLAN-CORE",
    billingCycle: "monthly",
  });
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

  it("refuses a token nobody was issued", async () => {
    const app = await boot();
    const res = await post(app, "/api/signup/verify", { token: "not-a-real-token" });
    expect(res.status).toBe(400);
  });
});
