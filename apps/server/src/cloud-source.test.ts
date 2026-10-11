import { afterEach, describe, expect, it } from "vitest";
import { bootCloudHarness, HARNESS_PROXY_HOP, type CloudHarness } from "./cloud-harness.js";

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

async function boot(): Promise<CloudHarness> {
  const h = await bootCloudHarness({ vars: { MEZAN_PAYMOB_TEST_MODE: "1" } });
  harnesses.push(h);
  return h;
}

async function provision(h: CloudHarness, code = "acme"): Promise<{ adminEmail: string; adminPin: string }> {
  const res = await h.send("/api/platform/tenants", {
    method: "POST",
    token: await h.platformToken(),
    body: JSON.stringify({
      code, nameAr: "منشأة", ownerEmail: `owner@${code}.example`, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: false,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { adminEmail: string; adminPin: string };
}

async function signIn(h: CloudHarness, admin: { adminEmail: string; adminPin: string }, init: { client?: string; chain?: string | null } = {}) {
  return h.send("/api/auth/login", { method: "POST", tenant: "acme", body: JSON.stringify({ username: admin.adminEmail, pin: admin.adminPin }), ...init });
}

describe("a cloud caller behind the two-hop proxy", () => {
  it("stays signed in across the tenant's own routes and the billing routes in front of them", async () => {
    const h = await boot();
    const admin = await provision(h);
    const login = await signIn(h, admin);
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };

    expect((await h.send("/api/profile", { token, tenant: "acme" })).status).toBe(200);
    const subscription = await h.send("/api/billing/subscription", { token, tenant: "acme" });
    expect(subscription.status).toBe(200);
    const body = (await subscription.json()) as { today: string | null; limits: unknown[] };
    expect(body.today).not.toBeNull();
    expect(body.limits.length).toBeGreaterThan(0);
    expect((await h.send("/api/profile", { token, tenant: "acme" })).status).toBe(200);
  });

  it("reads the plan usage as the caller, so the tenant backend answers it rather than refusing an unknown address", async () => {
    const h = await boot();
    const admin = await provision(h);
    const { token } = (await (await signIn(h, admin)).json()) as { token: string };
    const direct = (await (await h.send("/api/plan-usage", { token, tenant: "acme" })).json()) as { today: string; limits: unknown[] };
    const viaBilling = (await (await h.send("/api/billing/subscription", { token, tenant: "acme" })).json()) as { today: string; limits: unknown[] };
    expect(viaBilling.today).toBe(direct.today);
    expect(viaBilling.limits).toEqual(direct.limits);
  });

  it("refuses a request whose forwarded chain is one hop short, and counts none of its sign-ins against the account", async () => {
    const h = await boot();
    const admin = await provision(h);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const res = await h.send("/api/auth/login", {
        method: "POST", tenant: "acme", chain: HARNESS_PROXY_HOP, body: JSON.stringify({ username: admin.adminEmail, pin: String(100000 + i) }),
      });
      statuses.push(res.status);
    }
    expect(new Set(statuses)).toEqual(new Set([503]));
    const refusal = await h.send("/api/auth/login", { method: "POST", tenant: "acme", chain: null, body: JSON.stringify({ username: admin.adminEmail, pin: "000000" }) });
    expect(refusal.status).toBe(503);
    expect(((await refusal.json()) as { error: string }).error).toBe("SOURCE_UNRESOLVED");

    expect((await signIn(h, admin)).status).toBe(200);
  });

  it("refuses an unresolved caller on billing, signup and the platform console alike", async () => {
    const h = await boot();
    for (const path of ["/api/billing/subscription", "/api/signup/plans", "/api/platform/auth/me", "/api/profile"]) {
      const res = await h.send(path, { tenant: "acme", chain: "unknown, 130.176.1.1" });
      expect([path, res.status]).toEqual([path, 503]);
    }
  });

  it("does not accept the platform owner's token from a second address", async () => {
    const h = await boot();
    const token = await h.platformToken();
    expect((await h.send("/api/platform/tenants", { token })).status).toBe(200);
    expect((await h.send("/api/platform/tenants", { token, client: "66.66.66.66" })).status).toBe(401);
  });

  it("lets a phone roam between addresses on a device-bound session, on the tenant's routes and on billing, and refuses the token alone", async () => {
    const h = await boot();
    const admin = await provision(h);
    const login = await h.send("/api/auth/login", {
      method: "POST", tenant: "acme", headers: { "x-mezan-device-binding": "1" },
      body: JSON.stringify({ username: admin.adminEmail, pin: admin.adminPin }),
    });
    const { token, deviceSecret } = (await login.json()) as { token: string; deviceSecret: string };
    const device = { "x-mezan-device": deviceSecret };

    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device })).status).toBe(200);
    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device, client: "102.44.7.1" })).status).toBe(200);
    expect((await h.send("/api/billing/subscription", { token, tenant: "acme", headers: device, client: "197.55.1.9" })).status).toBe(200);
    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device, client: "2a01:db8:5::77" })).status).toBe(200);

    expect((await h.send("/api/profile", { token, tenant: "acme", client: "102.44.7.1" })).status).toBe(401);
    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device })).status).toBe(401);
  });

  describe("a browser's device secret", () => {
    async function browserSignIn(h: CloudHarness, admin: { adminEmail: string; adminPin: string }, headers: Record<string, string> = {}) {
      const res = await h.send("/api/auth/login", {
        method: "POST", tenant: "acme", headers: { "x-mezan-device-binding": "cookie", ...headers },
        body: JSON.stringify({ username: admin.adminEmail, pin: admin.adminPin }),
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      const body = (await res.json()) as { token: string; deviceSecret?: string };
      return { status: res.status, setCookie, body, cookie: setCookie.split(";")[0] ?? "" };
    }

    it("is set as an httpOnly, same-site cookie under /api and never handed to the page's script", async () => {
      const h = await boot();
      const admin = await provision(h);
      const plain = await browserSignIn(h, admin);
      expect(plain.status).toBe(200);
      expect(plain.body.deviceSecret).toBeUndefined();
      expect(plain.setCookie).toMatch(/^mezan_device=[A-Za-z0-9_-]{40,}; /);
      expect(plain.setCookie).toContain("Path=/api");
      expect(plain.setCookie).toContain("HttpOnly");
      expect(plain.setCookie).toContain("SameSite=Strict");
      expect(plain.setCookie).not.toContain("Secure");

      const https = await browserSignIn(h, admin, { "x-forwarded-proto": "https" });
      expect(https.setCookie).toContain("Secure");
    });

    it("lets the browser change address, on the tenant's routes and on billing, and records each move once as information", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { body, cookie } = await browserSignIn(h, admin);
      const browser = { token: body.token, tenant: "acme", headers: { cookie } };

      expect((await h.send("/api/profile", browser)).status).toBe(200);
      expect((await h.send("/api/profile", { ...browser, client: "102.44.7.1" })).status).toBe(200);
      expect((await h.send("/api/billing/subscription", { ...browser, client: "197.55.1.9" })).status).toBe(200);
      expect((await h.send("/api/profile", { ...browser, client: "197.55.1.9" })).status).toBe(200);

      const audit = await (await h.send("/api/audit?action=SESSION_ADDRESS_CHANGED", { ...browser, client: "197.55.1.9" })).text();
      expect(audit.match(/"action":"SESSION_ADDRESS_CHANGED"/g) ?? []).toHaveLength(2);
    });

    it("is not a credential: a cross-site request carrying only the cookie is refused, and so is the token without the cookie", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { body, cookie } = await browserSignIn(h, admin);

      const crossSite = await h.send("/api/item-brands", {
        method: "POST", tenant: "acme", headers: { cookie, origin: "https://evil.example" },
        body: JSON.stringify({ id: "b-x", code: "BX", name: "x", nameAr: "س" }),
      });
      expect(crossSite.status).toBe(401);
      expect((await h.send("/api/profile", { tenant: "acme", headers: { cookie } })).status).toBe(401);
      expect((await h.send("/api/profile", { token: body.token, tenant: "acme", headers: { cookie } })).status).toBe(200);

      expect((await h.send("/api/profile", { token: body.token, tenant: "acme" })).status).toBe(401);
    });

    it("is cleared on sign-out", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { body, cookie } = await browserSignIn(h, admin);
      const out = await h.send("/api/auth/logout", { method: "POST", token: body.token, tenant: "acme", headers: { cookie } });
      expect(out.headers.get("set-cookie")).toMatch(/^mezan_device=; .*Max-Age=0/);
      expect((await h.send("/api/profile", { token: body.token, tenant: "acme", headers: { cookie } })).status).toBe(401);
    });
  });

  it("reads the deletion form's caller only after the origin secret has proved the request crossed the edge", async () => {
    const h = await bootCloudHarness({ vars: { MEZAN_ORIGIN_SECRET: "edge-secret", MEZAN_SUPPORT_EMAIL: "support@mezan.test" } });
    harnesses.push(h);
    const post = (headers: Record<string, string>) =>
      h.send("/legal/account-deletion", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({ companyCode: "acme", email: "a@acme.test" }).toString(),
      });

    expect((await post({})).status).toBe(403);
    expect((await post({ "x-mezan-origin": "edge-secret" })).status).not.toBe(403);
    expect((await h.send("/legal/privacy")).status).toBe(200);
  });
});
