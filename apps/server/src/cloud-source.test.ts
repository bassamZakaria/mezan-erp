import { afterEach, describe, expect, it } from "vitest";
import { DEVICE_MISMATCH_LIMIT } from "@mezan/api";
import { rmSync } from "node:fs";
import { bootCloudHarness, HARNESS_OWNER_EMAIL, HARNESS_OWNER_PASSWORD, HARNESS_PROXY_HOP, type CloudHarness } from "./cloud-harness.js";

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

  it("lets the platform owner's session read from a second address but change nothing there until the password is entered again", async () => {
    const h = await boot();
    const token = await h.platformToken();
    expect((await h.send("/api/platform/tenants", { token })).status).toBe(200);
    expect((await h.send("/api/platform/tenants", { token, client: "66.66.66.66" })).status).toBe(200);
    const moved = await h.send("/api/platform/plans", { method: "POST", token, client: "66.66.66.66", body: "{}" });
    expect(moved.status).toBe(403);
    expect(((await moved.json()) as { error: string }).error).toBe("STEP_UP_REQUIRED");
    expect((await h.send("/api/platform/tenants", { token, client: "66.66.66.66", headers: { "x-mezan-device": "stolen" } })).status).toBe(401);
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
    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device })).status).toBe(200);

    for (let i = 1; i < DEVICE_MISMATCH_LIMIT; i++) {
      expect((await h.send("/api/profile", { token, tenant: "acme", client: "102.44.7.1" })).status).toBe(401);
    }
    expect((await h.send("/api/profile", { token, tenant: "acme", headers: device })).status).toBe(401);
  });

  describe("a browser's cookie session", () => {
    interface Jar {
      readonly cookie: string;
      readonly csrf: string;
      readonly setCookies: readonly string[];
    }

    function jarOf(res: Response): Jar {
      const set = res.headers.getSetCookie();
      const values = new Map<string, string>();
      for (const line of set) {
        const first = line.split(";")[0] ?? "";
        const at = first.indexOf("=");
        if (/Max-Age=0/.test(line)) values.delete(first.slice(0, at));
        else values.set(first.slice(0, at), first.slice(at + 1));
      }
      return {
        cookie: [...values].map(([k, v]) => `${k}=${v}`).join("; "),
        csrf: decodeURIComponent(values.get("mezan_csrf") ?? values.get("mezan_platform_csrf") ?? ""),
        setCookies: set,
      };
    }

    async function browserSignIn(h: CloudHarness, admin: { adminEmail: string; adminPin: string }, headers: Record<string, string> = {}) {
      const res = await h.send("/api/auth/login", {
        method: "POST", tenant: "acme", headers: { "x-mezan-device-binding": "cookie", "sec-fetch-site": "same-origin", ...headers },
        body: JSON.stringify({ username: admin.adminEmail, pin: admin.adminPin }),
      });
      const body = (await res.json()) as { token?: string; deviceSecret?: string; userId?: string };
      return { status: res.status, body, jar: jarOf(res) };
    }

    const brand = { id: "b-x", code: "BX", name: "x", nameAr: "س" };

    it("keeps the session token and the device secret in HttpOnly cookies and hands neither to the page's script", async () => {
      const h = await boot();
      const admin = await provision(h);
      const plain = await browserSignIn(h, admin);
      expect(plain.status).toBe(200);
      expect(plain.body.token).toBeUndefined();
      expect(plain.body.deviceSecret).toBeUndefined();
      expect(plain.body.userId).toBeDefined();
      const session = plain.jar.setCookies.find((line) => line.startsWith("mezan_session="));
      const device = plain.jar.setCookies.find((line) => line.startsWith("mezan_device="));
      const csrf = plain.jar.setCookies.find((line) => line.startsWith("mezan_csrf="));
      for (const line of [session, device]) {
        expect(line).toContain("Path=/api");
        expect(line).toContain("HttpOnly");
        expect(line).toContain("SameSite=Strict");
        expect(line).not.toContain("Secure");
      }
      expect(session).toMatch(/^mezan_session=acme\./);
      expect(csrf).toContain("Path=/;");
      expect(csrf).not.toContain("HttpOnly");

      const https = await browserSignIn(h, admin, { "x-forwarded-proto": "https" });
      for (const line of https.jar.setCookies) expect(line).toContain("Secure");
    });

    it("serves reads with the cookie alone, on the tenant's routes and on billing, across a change of address", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { jar } = await browserSignIn(h, admin);
      const browser = { tenant: "acme", headers: { cookie: jar.cookie } };
      expect((await h.send("/api/profile", browser)).status).toBe(200);
      expect((await h.send("/api/profile", { ...browser, client: "102.44.7.1" })).status).toBe(200);
      expect((await h.send("/api/billing/subscription", { ...browser, client: "197.55.1.9" })).status).toBe(200);
    });

    it("refuses a state-changing request without the CSRF token, or from another origin, and accepts it with both", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { jar } = await browserSignIn(h, admin);
      const write = (headers: Record<string, string>) =>
        h.send("/api/item-brands", { method: "POST", tenant: "acme", headers: { cookie: jar.cookie, ...headers }, body: JSON.stringify(brand) });

      const noToken = await write({});
      expect(noToken.status).toBe(403);
      expect(((await noToken.json()) as { error: string }).error).toBe("CSRF_REFUSED");
      expect((await write({ "x-mezan-csrf": "forged" })).status).toBe(403);
      expect((await write({ "x-mezan-csrf": jar.csrf, origin: "https://evil.example" })).status).toBe(403);
      expect((await write({ "x-mezan-csrf": jar.csrf, "sec-fetch-site": "same-site" })).status).toBe(403);
      expect((await write({ "x-mezan-csrf": jar.csrf, origin: "http://cloud.internal" })).status).toBe(201);
    });

    it("keeps an open console session writable across a server restart instead of refusing it as a forged request", async () => {
      const first = await bootCloudHarness({ vars: { MEZAN_PAYMOB_TEST_MODE: "1" } });
      const signIn = await first.send("/api/platform/auth/login", {
        method: "POST",
        headers: { "x-mezan-device-binding": "cookie", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ email: HARNESS_OWNER_EMAIL, password: HARNESS_OWNER_PASSWORD }),
      });
      expect(signIn.status).toBe(200);
      const jar = jarOf(signIn);
      const write = (h: CloudHarness) =>
        h.send("/api/platform/settings/signup-mode", {
          method: "PUT",
          headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf, origin: "http://cloud.internal" },
          body: JSON.stringify({ mode: "closed" }),
        });
      expect((await write(first)).status).toBe(200);
      await first.app.close();

      const restarted = await bootCloudHarness({ vars: { MEZAN_PAYMOB_TEST_MODE: "1" }, env: { platformDir: first.env.platformDir } });
      try {
        expect((await write(restarted)).status).toBe(200);
      } finally {
        await restarted.close();
        rmSync(first.env.platformDir, { recursive: true, force: true });
        rmSync(first.env.webDist, { recursive: true, force: true });
      }
    });

    it("never presents one tenant's cookie to another tenant, and refuses that request without ending the session it belongs to", async () => {
      const h = await boot();
      const admin = await provision(h);
      await provision(h, "other");
      const { jar } = await browserSignIn(h, admin);
      const read = await h.send("/api/profile", { tenant: "other", headers: { cookie: jar.cookie } });
      const write = await h.send("/api/item-brands", { method: "POST", tenant: "other", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf }, body: JSON.stringify(brand) });
      const out = await h.send("/api/auth/logout", { method: "POST", tenant: "other", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf } });
      for (const refused of [read, write]) {
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as { error: string }).error).toBe("SESSION_TENANT_MISMATCH");
      }
      for (const answer of [read, write, out]) expect(answer.headers.getSetCookie()).toEqual([]);
      expect((await h.send("/api/profile", { tenant: "acme", headers: { cookie: jar.cookie } })).status).toBe(200);
    });

    it("keeps a device-bound phone and a bearer client working beside the browser", async () => {
      const h = await boot();
      const admin = await provision(h);
      const browser = await browserSignIn(h, admin);
      const phone = (await (await h.send("/api/auth/login", {
        method: "POST", tenant: "acme", headers: { "x-mezan-device-binding": "1" }, body: JSON.stringify({ username: admin.adminEmail, pin: admin.adminPin }),
      })).json()) as { token: string; deviceSecret: string };
      const plain = (await (await signIn(h, admin)).json()) as { token: string };
      const statuses = [
        (await h.send("/api/profile", { tenant: "acme", headers: { cookie: browser.jar.cookie } })).status,
        (await h.send("/api/profile", { token: phone.token, tenant: "acme", headers: { "x-mezan-device": phone.deviceSecret } })).status,
        (await h.send("/api/profile", { token: plain.token, tenant: "acme" })).status,
        (await h.send("/api/item-brands", { method: "POST", token: plain.token, tenant: "acme", body: JSON.stringify(brand) })).status,
      ];
      expect(statuses).toEqual([200, 200, 200, 201]);
    });

    it("ends the session on the server and clears every cookie on sign-out", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { jar } = await browserSignIn(h, admin);
      const out = await h.send("/api/auth/logout", { method: "POST", tenant: "acme", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf } });
      expect(out.status).toBe(200);
      const cleared = out.headers.getSetCookie();
      for (const name of ["mezan_session", "mezan_device", "mezan_csrf"]) {
        expect(cleared.some((line) => line.startsWith(`${name}=;`) && /Max-Age=0/.test(line))).toBe(true);
      }
      expect((await h.send("/api/profile", { tenant: "acme", headers: { cookie: jar.cookie } })).status).toBe(401);
    });

    it("signs in again over a cookie whose session the server has already forgotten, and expires a dead cookie on first contact", async () => {
      const h = await boot();
      const admin = await provision(h);
      const stale = "mezan_session=acme.forgotten; mezan_csrf=forgotten";
      const again = await browserSignIn(h, admin, { cookie: stale });
      expect(again.status).toBe(200);
      expect(again.jar.setCookies.some((line) => line.startsWith("mezan_session=acme."))).toBe(true);

      const dead = await h.send("/api/profile", { tenant: "acme", headers: { cookie: stale } });
      expect(dead.status).toBe(401);
      expect(dead.headers.getSetCookie().some((line) => line.startsWith("mezan_session=;") && /Max-Age=0/.test(line))).toBe(true);

      const platform = await h.send("/api/platform/auth/login", {
        method: "POST", headers: { "x-mezan-device-binding": "cookie", cookie: "mezan_platform_session=forgotten" },
        body: JSON.stringify({ email: "owner@mezan.local", password: "owner-password-123" }),
      });
      expect(platform.status).toBe(200);
      const deadConsole = await h.send("/api/platform/tenants", { headers: { cookie: "mezan_platform_session=forgotten" } });
      expect(deadConsole.status).toBe(401);
      expect(deadConsole.headers.getSetCookie().some((line) => line.startsWith("mezan_platform_session=;"))).toBe(true);
    });

    it("keeps the cookies when a live session's request is refused for a wrong password", async () => {
      const h = await boot();
      const admin = await provision(h);
      const { jar } = await browserSignIn(h, admin);
      const wrong = await h.send("/api/profile/change-password", {
        method: "POST", tenant: "acme", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf },
        body: JSON.stringify({ currentPassword: "not-the-password", newPassword: "a-new-password-1" }),
      });
      expect(wrong.status).toBe(403);
      expect(((await wrong.json()) as { error: string }).error).toBe("INCORRECT_PASSWORD");
      expect(wrong.headers.getSetCookie()).toEqual([]);
      expect((await h.send("/api/profile", { tenant: "acme", headers: { cookie: jar.cookie } })).status).toBe(200);
    });

    it("keeps the platform console's session in its own cookies, with the same CSRF rule", async () => {
      const h = await boot();
      const login = await h.send("/api/platform/auth/login", {
        method: "POST", headers: { "x-mezan-device-binding": "cookie" },
        body: JSON.stringify({ email: "owner@mezan.local", password: "owner-password-123" }),
      });
      expect(login.status).toBe(200);
      expect(((await login.json()) as { token?: string }).token).toBeUndefined();
      const set = login.headers.getSetCookie();
      expect(set.find((line) => line.startsWith("mezan_platform_session="))).toContain("Path=/api/platform");
      expect(set.find((line) => line.startsWith("mezan_platform_session="))).toContain("Max-Age=28800");
      expect(set.find((line) => line.startsWith("mezan_platform_device="))).toContain("HttpOnly");
      const jar = jarOf(login);
      expect((await h.send("/api/platform/tenants", { headers: { cookie: jar.cookie } })).status).toBe(200);
      expect((await h.send("/api/platform/plans", { method: "POST", headers: { cookie: jar.cookie }, body: "{}" })).status).toBe(403);
      expect((await h.send("/api/platform/plans", { method: "POST", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf }, body: "{}" })).status).toBe(400);
      const out = await h.send("/api/platform/auth/logout", { method: "POST", headers: { cookie: jar.cookie, "x-mezan-csrf": jar.csrf } });
      expect(out.headers.getSetCookie().some((line) => line.startsWith("mezan_platform_session=;"))).toBe(true);
      expect((await h.send("/api/platform/tenants", { headers: { cookie: jar.cookie } })).status).toBe(401);
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
