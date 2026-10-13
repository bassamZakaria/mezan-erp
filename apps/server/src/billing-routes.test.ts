import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSqliteConnection } from "@mezan/persistence";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { createPaymobWebhookRoutes, PAYMOB_WEBHOOK_PATH, trustedReturnOrigin } from "./billing-routes.js";
import type { CardCheckoutService, WebhookResult } from "./card-checkout.js";
import { SettlementDetail, SettlementStatus } from "./card-checkout.js";
import { parseEnv, type CloudEnv } from "./env.js";
import { reachable } from "./cloud-harness.js";

const PROXY_HOPS = 2;
const PROXIED = { MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: String(PROXY_HOPS) };
const T = "2026-01-15T00:00:00.000Z";

const apps: CloudApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function testEnv(): CloudEnv {
  const webDist = tempDir("mezan-billing-web-");
  writeFileSync(path.join(webDist, "index.html"), "<!doctype html><body>مزان</body>");
  return {
    ...parseEnv({ ...PROXIED, MEZAN_PAYMOB_TEST_MODE: "1" }),
    platformDir: tempDir("mezan-billing-platform-"),
    webDist,
    platformOwnerEmail: "owner@mezan.local",
    platformOwnerPassword: "owner-password-123",
    backupIntervalMinutes: 0,
  };
}

async function boot(): Promise<CloudApp> {
  const app = await createCloudApp(testEnv(), { now: () => new Date(T) });
  apps.push(app);
  reachable(app.root, PROXY_HOPS);
  return app;
}

function send(app: CloudApp, pathname: string, init: RequestInit & { token?: string; tenant?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.tenant) headers.set("x-mezan-tenant", init.tenant);
  return app.root.fetch(new Request(`http://cloud.internal${pathname}`, { ...init, headers }));
}

async function platformToken(app: CloudApp): Promise<string> {
  const res = await send(app, "/api/platform/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@mezan.local", password: "owner-password-123" }),
  });
  return ((await res.json()) as { token: string }).token;
}

interface TenantLogin {
  readonly id: string;
  readonly code: string;
  readonly token: string;
}

async function provisionAndLogin(app: CloudApp, owner: string, code: string): Promise<TenantLogin> {
  const res = await send(app, "/api/platform/tenants", {
    method: "POST",
    token: owner,
    body: JSON.stringify({
      code, nameAr: `منشأة ${code}`, ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false,
    }),
  });
  expect(res.status).toBe(201);
  const provisioned = (await res.json()) as { tenant: { id: string }; adminEmail: string; adminPin: string };
  const login = await send(app, "/api/auth/login", {
    method: "POST",
    tenant: code,
    body: JSON.stringify({ username: provisioned.adminEmail, pin: provisioned.adminPin }),
  });
  expect(login.status).toBe(200);
  return { id: provisioned.tenant.id, code, token: ((await login.json()) as { token: string }).token };
}

describe("tenant billing routes — whose subscription a session may touch", () => {
  it("serves a tenant its own subscription and opens its own checkout", async () => {
    const app = await boot();
    const acme = await provisionAndLogin(app, await platformToken(app), "acme");

    const subscription = await send(app, "/api/billing/subscription", { token: acme.token, tenant: "acme" });
    const checkout = await send(app, "/api/billing/checkout", {
      method: "POST", token: acme.token, tenant: "acme", body: JSON.stringify({ returnPath: "/settings/billing" }),
    });

    expect(subscription.status).toBe(200);
    expect(await subscription.json()).toMatchObject({ cardCheckout: true, testMode: true, canRenew: true });
    expect(checkout.status).toBe(201);
    expect(await checkout.json()).toMatchObject({ tenantId: acme.id, status: "pending" });
  });

  it("refuses tenant A's token presented with tenant B's header, on every billing route", async () => {
    const app = await boot();
    const owner = await platformToken(app);
    const acme = await provisionAndLogin(app, owner, "acme");
    const beta = await provisionAndLogin(app, owner, "beta");

    const read = await send(app, "/api/billing/subscription", { token: acme.token, tenant: "beta" });
    const open = await send(app, "/api/billing/checkout", {
      method: "POST", token: acme.token, tenant: "beta", body: JSON.stringify({ returnPath: "/settings/billing" }),
    });
    const trial = await send(app, "/api/billing/module-trials", {
      method: "POST", token: acme.token, tenant: "beta", body: JSON.stringify({ module: "hr" }),
    });

    expect([read.status, open.status, trial.status]).toEqual([401, 401, 401]);
    const betaCheckouts = await send(app, `/api/platform/tenants/${beta.id}/card-checkouts`, { token: owner });
    expect(((await betaCheckouts.json()) as { checkouts: unknown[] }).checkouts).toEqual([]);
  });

  it("answers 404, not another tenant's checkout, when a checkout id belongs elsewhere", async () => {
    const app = await boot();
    const owner = await platformToken(app);
    const acme = await provisionAndLogin(app, owner, "acme");
    const beta = await provisionAndLogin(app, owner, "beta");
    const opened = await send(app, "/api/billing/checkout", {
      method: "POST", token: beta.token, tenant: "beta", body: JSON.stringify({ returnPath: "/settings/billing" }),
    });
    const { id } = (await opened.json()) as { id: string };

    const peek = await send(app, `/api/billing/checkouts/${id}`, { token: acme.token, tenant: "acme" });
    const own = await send(app, `/api/billing/checkouts/${id}`, { token: beta.token, tenant: "beta" });

    expect(peek.status).toBe(404);
    expect(own.status).toBe(200);
  });

  it("refuses a request with no session, and one with no tenant", async () => {
    const app = await boot();
    const acme = await provisionAndLogin(app, await platformToken(app), "acme");

    expect((await send(app, "/api/billing/subscription", { tenant: "acme" })).status).toBe(401);
    expect((await send(app, "/api/billing/subscription", { token: acme.token })).status).toBe(400);
    expect((await send(app, "/api/billing/subscription", { token: acme.token, tenant: "nobody" })).status).toBe(404);
  });

  it("refuses a return path that is not a same-origin path", async () => {
    const app = await boot();
    const acme = await provisionAndLogin(app, await platformToken(app), "acme");

    for (const returnPath of ["//evil.example/x", "https://evil.example/x", "/ok?next=//evil.example"]) {
      const res = await send(app, "/api/billing/checkout", { method: "POST", token: acme.token, tenant: "acme", body: JSON.stringify({ returnPath }) });
      expect(res.status).toBe(400);
    }
  });
});

describe("the fake hosted checkout, end to end through the real webhook path", () => {
  it("renews the tenant once however many times the success button is pressed", async () => {
    const app = await boot();
    const owner = await platformToken(app);
    const acme = await provisionAndLogin(app, owner, "acme");
    const before = (await (await send(app, `/api/platform/tenants/${acme.id}`, { token: owner })).json()) as { subscription: { currentPeriodEnd: string } };
    const opened = await send(app, "/api/billing/checkout", {
      method: "POST", token: acme.token, tenant: "acme", body: JSON.stringify({ returnPath: "/settings/billing" }),
    });
    const { id } = (await opened.json()) as { id: string };
    const press = () =>
      app.root.fetch(
        new Request(`http://cloud.internal/billing/test-checkout/${id}/complete`, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=success",
        }),
      );

    const responses = [await press(), await press()];

    expect(responses.map((res) => res.status)).toEqual([303, 303]);
    const after = (await (await send(app, `/api/platform/tenants/${acme.id}`, { token: owner })).json()) as {
      subscription: { currentPeriodEnd: string };
      payments: unknown[];
    };
    expect(after.payments).toHaveLength(1);
    expect(after.subscription.currentPeriodEnd > before.subscription.currentPeriodEnd).toBe(true);
  });
});

describe("the Paymob webhook route", () => {
  function hook(result: WebhookResult) {
    const seen: Array<{ rawBody: string; signature: string }> = [];
    const service = {
      handleWebhook: async (rawBody: string, signature: string) => {
        seen.push({ rawBody, signature });
        return result;
      },
    } as unknown as CardCheckoutService;
    return { app: createPaymobWebhookRoutes(service), seen };
  }
  const post = (app: ReturnType<typeof hook>["app"], body: string, query = "?hmac=abc", headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://cloud.internal/${query}`, { method: "POST", body, headers }));

  it("is mounted where Paymob is told to call", () => {
    expect(PAYMOB_WEBHOOK_PATH).toBe("/api/billing/paymob/webhook");
  });

  it("hands the raw body and the hmac query parameter to the service untouched", async () => {
    const { app, seen } = hook({ status: SettlementStatus.Ok, detail: SettlementDetail.Paid });
    const raw = '{"type":"TRANSACTION",  "obj": {"id": 1}}';

    const res = await post(app, raw, "?hmac=DEADBEEF");

    expect(res.status).toBe(200);
    expect(seen).toEqual([{ rawBody: raw, signature: "DEADBEEF" }]);
  });

  it("answers 401 to an unverified callback, so the provider's log shows the refusal", async () => {
    const { app } = hook({ status: SettlementStatus.Rejected });
    const res = await post(app, "{}", "");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("answers 503 when the settlement asks to be retried", async () => {
    const { app } = hook({ status: SettlementStatus.Retry });
    expect((await post(app, "{}")).status).toBe(503);
  });

  it("refuses an oversized body without reading it into the service", async () => {
    const { app, seen } = hook({ status: SettlementStatus.Ok, detail: SettlementDetail.Paid });

    const declared = await post(app, "{}", "?hmac=abc", { "content-length": String(10 * 1024 * 1024) });
    const actual = await post(app, "x".repeat(300 * 1024));

    expect([declared.status, actual.status]).toEqual([413, 413]);
    expect(seen).toEqual([]);
  });
});

describe("trustedReturnOrigin", () => {
  const live: CloudEnv = {
    ...parseEnv({
      MEZAN_PAYMOB_SECRET_KEY: "sk", MEZAN_PAYMOB_PUBLIC_KEY: "pk", MEZAN_PAYMOB_HMAC_SECRET: "h", MEZAN_PAYMOB_INTEGRATION_ID: "1",
      MEZAN_PAYMOB_PUBLIC_URL: "https://app.mezan.test",
    }),
    tenantDomain: "mezan.test",
  };
  const from = (host: string) => new Request("http://internal/api/billing/checkout", { headers: { host } });

  const served = async (code: string) => code === "acme";

  it("sends the browser back to the tenant's own subdomain", async () => {
    expect(await trustedReturnOrigin(from("acme.mezan.test"), live, served)).toBe("https://acme.mezan.test");
  });

  it("falls back to the configured public URL for any host it does not own", async () => {
    expect(await trustedReturnOrigin(from("evil.example"), live, served)).toBe("https://app.mezan.test");
    expect(await trustedReturnOrigin(from("acme.mezan.test.evil.example"), live, served)).toBe("https://app.mezan.test");
    expect(await trustedReturnOrigin(from("a.b.mezan.test"), live, served)).toBe("https://app.mezan.test");
  });
});

describe("card events the platform's audit log cannot record", () => {
  it("are read back by the console's owner: the checkout that was opened and the summary of the sweep that followed, each with what it carried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = testEnv();
    const app = await createCloudApp(env, { now: () => new Date(T) });
    apps.push(app);
    reachable(app.root, PROXY_HOPS);
    const owner = await platformToken(app);
    const acme = await provisionAndLogin(app, owner, "acme");
    const before = (await (await send(app, "/api/platform/security/unrecorded", { token: owner })).json()) as { count: number };
    expect(before.count).toBe(0);

    const { sqlite: platformDb } = openSqliteConnection(path.join(env.platformDir, "platform.db"));
    platformDb.exec("CREATE TRIGGER audit_down BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'audit sink down'); END;");
    try {
      const opened = await send(app, "/api/billing/checkout", {
        method: "POST", token: acme.token, tenant: "acme", body: JSON.stringify({ returnPath: "/settings/billing" }),
      });
      expect(opened.status).toBe(201);
      const checkoutId = ((await opened.json()) as { id: string }).id;
      const swept = await send(app, "/api/platform/card-checkouts/sweep", { method: "POST", token: owner });
      expect(swept.status).toBe(200);

      const unrecorded = (await (await send(app, "/api/platform/security/unrecorded", { token: owner })).json()) as {
        count: number;
        recent: { action: string; entityId: string | null; reason: string; details: Record<string, unknown> | null }[];
      };
      expect(unrecorded.count).toBe(2);
      expect(unrecorded.recent.map((event) => event.action)).toEqual(["CARD_CHECKOUT_SWEEP_RUN", "CARD_CHECKOUT_OPENED"]);
      expect(unrecorded.recent[0]!.details).toMatchObject({ examined: expect.any(Number), paid: expect.any(Number), stillPending: expect.any(Number) });
      expect(unrecorded.recent[1]).toMatchObject({ entityId: acme.id, reason: expect.stringContaining("audit sink down"), details: { checkoutId } });
    } finally {
      platformDb.exec("DROP TRIGGER audit_down;");
      platformDb.close();
    }
  }, 60_000);
});
