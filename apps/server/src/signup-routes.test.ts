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

async function boot(): Promise<CloudApp> {
  const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-signup-platform-"));
  dirs.push(platformDir);
  const app = await createCloudApp(
    { ...parseEnv({}), platformDir, webDist: path.join(platformDir, "no-web-dist"), backupIntervalMinutes: 0 },
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

  it("refuses a token nobody was issued", async () => {
    const app = await boot();
    const res = await post(app, "/api/signup/verify", { token: "not-a-real-token" });
    expect(res.status).toBe(400);
  });
});
