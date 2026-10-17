import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createSessionRegistry, DEVICE_MISMATCH_LIMIT } from "@mezan/api";
import { CurrentSecretRefusal, DEVICE_SECRET_HEADER } from "@mezan/contracts";
import { ALL_SCOPE, createMemorySecurityEventFallback, createPlatformUser, type PlatformUser } from "@mezan/domain";
import { createPlatform, type PlatformHandle } from "./create-platform.js";
import { createPlatformAuth, PLATFORM_SESSION_LIMITS, PlatformSecurityAction } from "./platform-auth.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00Z");

const platforms: PlatformHandle[] = [];
afterEach(() => {
  for (const p of platforms.splice(0)) p.close();
});

async function newPlatform(): Promise<PlatformHandle> {
  const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
  platforms.push(platform);
  return platform;
}

async function seedOwner(platform: PlatformHandle, overrides: Partial<{ email: string; password: string; status: PlatformUser["status"] }> = {}) {
  const user = await createPlatformUser(
    { id: "PU-OWNER", email: overrides.email ?? "owner@mezan.app", password: overrides.password ?? "correct horse battery", role: "owner", now: "2026-01-01T00:00:00.000Z" },
    platform.stores.platformUsers,
    platform.hasher,
  );
  if (overrides.status === "inactive") {
    await platform.stores.platformUsers.save({ ...user, status: "inactive" });
  }
  return user;
}

async function seedSupport(platform: PlatformHandle) {
  return createPlatformUser(
    { id: "PU-SUPPORT", email: "support@mezan.app", password: "correct horse battery", role: "support", now: "2026-01-01T00:00:00.000Z" },
    platform.stores.platformUsers,
    platform.hasher,
  );
}

function newAuth(platform: PlatformHandle) {
  const sessions = createSessionRegistry();
  return createPlatformAuth({ platform, sessions, now: FIXED_NOW });
}

async function json(res: Response) {
  return res.json();
}

describe("createPlatformAuth", () => {
  it("logs in the seeded owner and records a success audit row", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    const auth = newAuth(platform);
    const res = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as { token: string; user: { id: string; email: string; role: string } };
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.user).toEqual({ id: "PU-OWNER", email: "owner@mezan.app", role: "owner" });

    const rows = await platform.audit.query("security");
    expect(rows.some((r) => r.action === "PLATFORM_LOGIN_SUCCEEDED" && r.actor === "PU-OWNER")).toBe(true);
  });

  it("refuses a wrong password with 401 and records a failure audit row", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    const auth = newAuth(platform);
    const res = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "wrong password entirely" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة" });
    const rows = await platform.audit.query("security");
    expect(rows.some((r) => r.action === "PLATFORM_LOGIN_FAILED")).toBe(true);
  });

  it("refuses an inactive user with 401, even with the right password", async () => {
    const platform = await newPlatform();
    await seedOwner(platform, { status: "inactive" });
    const auth = newAuth(platform);
    const res = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /me returns the caller with a bearer token, and 401 without one", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    const auth = newAuth(platform);
    const loginRes = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
      }),
    );
    const { token, deviceSecret } = (await json(loginRes)) as { token: string; deviceSecret: string };

    const meRes = await auth.app.fetch(new Request("http://x/me", { headers: { authorization: `Bearer ${token}`, [DEVICE_SECRET_HEADER]: deviceSecret } }));
    expect(meRes.status).toBe(200);
    expect(await json(meRes)).toEqual({ id: "PU-OWNER", email: "owner@mezan.app", role: "owner" });

    const anonRes = await auth.app.fetch(new Request("http://x/me"));
    expect(anonRes.status).toBe(401);
    expect(await json(anonRes)).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("POST /logout revokes the session", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    const auth = newAuth(platform);
    const loginRes = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
      }),
    );
    const { token, deviceSecret } = (await json(loginRes)) as { token: string; deviceSecret: string };
    const headers = { authorization: `Bearer ${token}`, [DEVICE_SECRET_HEADER]: deviceSecret };

    const logoutRes = await auth.app.fetch(new Request("http://x/logout", { method: "POST", headers }));
    expect(logoutRes.status).toBe(200);
    expect((await platform.audit.query("security")).map((e) => e.action)).toContain("PLATFORM_LOGGED_OUT");

    const meRes = await auth.app.fetch(new Request("http://x/me", { headers }));
    expect(meRes.status).toBe(401);
  });

  it("requirePlatform('owner') passes an owner and refuses a support session with 403", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    await seedSupport(platform);
    const auth = newAuth(platform);

    const testApp = new Hono();
    testApp.get("/owner-only", auth.requirePlatform("owner"), (c) => c.json({ ok: true }));

    async function login(email: string) {
      const res = await auth.app.fetch(
        new Request("http://x/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "correct horse battery" }),
        }),
      );
      const { token, deviceSecret } = (await json(res)) as { token: string; deviceSecret: string };
      return { authorization: `Bearer ${token}`, [DEVICE_SECRET_HEADER]: deviceSecret };
    }

    const ownerHeaders = await login("owner@mezan.app");
    const supportHeaders = await login("support@mezan.app");

    const ownerRes = await testApp.fetch(new Request("http://x/owner-only", { headers: ownerHeaders }));
    expect(ownerRes.status).toBe(200);

    const supportRes = await testApp.fetch(new Request("http://x/owner-only", { headers: supportHeaders }));
    expect(supportRes.status).toBe(403);
    expect(await json(supportRes)).toEqual({ error: "OWNER_ONLY", message: "هذا الإجراء لمالك المنصة فقط" });
  });

  it("refuses a session whose roleCode is not a platform role, e.g. a tenant-style session", async () => {
    const platform = await newPlatform();
    const sessions = createSessionRegistry();
    const auth = createPlatformAuth({ platform, sessions, now: FIXED_NOW });
    const token = sessions.issue({ userId: "U-TENANT", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });

    const testApp = new Hono();
    testApp.get("/anything", auth.requirePlatform(), (c) => c.json({ ok: true }));

    const res = await testApp.fetch(new Request("http://x/anything", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("locks out repeated wrong passwords with 429 and a lockout body, driven by the injected clock", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    let currentTime = new Date("2026-01-01T00:00:00Z");
    const sessions = createSessionRegistry();
    const auth = createPlatformAuth({ platform, sessions, now: () => currentTime });

    async function attempt(password: string) {
      return auth.app.fetch(
        new Request("http://x/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "owner@mezan.app", password }),
        }),
      );
    }

    for (let i = 0; i < 5; i++) {
      expect((await attempt("wrong password")).status).toBe(401);
    }
    const lockedRes = await attempt("wrong password");
    expect(lockedRes.status).toBe(429);
    const body = (await json(lockedRes)) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("TOO_MANY_ATTEMPTS");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(lockedRes.headers.get("retry-after")).toBe(String(body.retryAfterSeconds));

    // Advancing the INJECTED clock past the lock (not real time) proves the throttle reads `now`, not Date.now().
    currentTime = new Date(currentTime.getTime() + (body.retryAfterSeconds + 1) * 1000);
    const afterWaitRes = await attempt("correct horse battery");
    expect(afterWaitRes.status).toBe(200);
  });

  it("keeps a sign-in the audit log refused in the fallback, counted, without the password, and the login still succeeds", async () => {
    const platform = await newPlatform();
    await seedOwner(platform);
    const unrecorded = createMemorySecurityEventFallback();
    const brokenPlatform: PlatformHandle = {
      ...platform,
      audit: {
        append: async () => { throw new Error("audit sink down"); },
        query: platform.audit.query.bind(platform.audit),
        unrecorded,
      },
    };
    const sessions = createSessionRegistry();
    const auth = createPlatformAuth({ platform: brokenPlatform, sessions, now: FIXED_NOW });

    const res = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(200);
    const failed = await auth.app.fetch(
      new Request("http://x/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@mezan.app", password: "not the password" }),
      }),
    );
    expect(failed.status).toBe(401);
    const summary = unrecorded.summary();
    expect(summary.count).toBe(2);
    expect(summary.recent.map((entry) => entry.action)).toEqual(["PLATFORM_LOGIN_FAILED", "PLATFORM_LOGIN_SUCCEEDED"]);
    expect(summary.recent.every((entry) => entry.reason === "audit sink down")).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/correct horse battery|not the password/);
  });
});

describe("the platform console session", () => {
  const SOURCE = "x-test-source";

  async function rig() {
    const platform = await newPlatform();
    await seedOwner(platform);
    let clock = Date.parse("2026-01-01T09:00:00Z");
    const sessions = createSessionRegistry(() => clock, PLATFORM_SESSION_LIMITS);
    const auth = createPlatformAuth({ platform, sessions, now: FIXED_NOW, sourceOf: (c) => c.req.header(SOURCE) ?? null });
    const app = new Hono();
    app.route("/auth", auth.app);
    app.get("/read", auth.requirePlatform(), (c) => c.json({ ok: true }));
    app.post("/write", auth.requirePlatform(), (c) => c.json({ ok: true }));
    const login = async (from = "41.33.10.10") => {
      const res = await app.fetch(
        new Request("http://x/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", [SOURCE]: from },
          body: JSON.stringify({ email: "owner@mezan.app", password: "correct horse battery" }),
        }),
      );
      const { token, deviceSecret } = (await json(res)) as { token: string; deviceSecret: string };
      return { token, deviceSecret };
    };
    const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
      app.fetch(new Request(`http://x${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const actions = async () => (await platform.audit.query("security")).map((e) => e.action);
    return { app, login, call, actions, advance: (ms: number) => (clock += ms) };
  }

  it("is bound to the device that signed in: the token alone is refused, and the refusal is audited", async () => {
    const r = await rig();
    const { token, deviceSecret } = await r.login();
    expect((await r.call("GET", "/read", { authorization: `Bearer ${token}`, [SOURCE]: "41.33.10.10", [DEVICE_SECRET_HEADER]: deviceSecret })).status).toBe(200);
    expect((await r.call("GET", "/read", { authorization: `Bearer ${token}`, [SOURCE]: "41.33.10.10" })).status).toBe(401);
    expect(await r.actions()).toContain(PlatformSecurityAction.SessionDeviceRejected);
  });

  it("counts one refused device secret once per request, so the session ends on the documented limit and not before", async () => {
    const r = await rig();
    const { token, deviceSecret } = await r.login();
    for (let i = 1; i < DEVICE_MISMATCH_LIMIT; i++) {
      expect((await r.call("POST", "/write", { authorization: `Bearer ${token}`, [SOURCE]: "41.33.10.10" })).status).toBe(401);
    }
    expect((await r.call("GET", "/read", { authorization: `Bearer ${token}`, [SOURCE]: "41.33.10.10", [DEVICE_SECRET_HEADER]: deviceSecret })).status).toBe(200);
  });

  it("after a change of address reads on, but changes nothing until the password is entered again", async () => {
    const r = await rig();
    const { token, deviceSecret } = await r.login();
    const moved = { authorization: `Bearer ${token}`, [DEVICE_SECRET_HEADER]: deviceSecret, [SOURCE]: "102.44.7.1" };
    expect((await r.call("GET", "/read", moved)).status).toBe(200);
    const refused = await r.call("POST", "/write", moved);
    expect(refused.status).toBe(403);
    expect(((await json(refused)) as { error: string }).error).toBe("STEP_UP_REQUIRED");

    const wrong = await r.call("POST", "/auth/step-up", moved, { password: "wrong password" });
    expect(wrong.status).toBe(403);
    expect(((await json(wrong)) as { error: string }).error).toBe(CurrentSecretRefusal.IncorrectPassword);
    expect((await r.call("GET", "/read", moved)).status).toBe(200);
    expect((await r.call("POST", "/write", moved)).status).toBe(403);
    expect((await r.call("POST", "/auth/step-up", moved, { password: "correct horse battery" })).status).toBe(200);
    expect((await r.call("POST", "/write", moved)).status).toBe(200);

    expect(await r.actions()).toEqual(
      expect.arrayContaining([
        PlatformSecurityAction.SessionAddressChanged,
        PlatformSecurityAction.StepUpRequired,
        PlatformSecurityAction.StepUpFailed,
        PlatformSecurityAction.StepUpConfirmed,
      ]),
    );
  });

  it("ends after half an hour idle, and after eight hours however busy, and says so in the audit", async () => {
    const r = await rig();
    const idle = await r.login();
    const idleHeaders = { authorization: `Bearer ${idle.token}`, [DEVICE_SECRET_HEADER]: idle.deviceSecret, [SOURCE]: "41.33.10.10" };
    r.advance(PLATFORM_SESSION_LIMITS.idleMs + 1);
    expect((await r.call("GET", "/read", idleHeaders)).status).toBe(401);

    const busy = await r.login();
    const busyHeaders = { authorization: `Bearer ${busy.token}`, [DEVICE_SECRET_HEADER]: busy.deviceSecret, [SOURCE]: "41.33.10.10" };
    const step = PLATFORM_SESSION_LIMITS.idleMs / 2;
    for (let at = step; at <= PLATFORM_SESSION_LIMITS.maxMs - step; at += step) {
      r.advance(step);
      expect((await r.call("GET", "/read", busyHeaders)).status).toBe(200);
    }
    r.advance(step + 1);
    expect((await r.call("GET", "/read", busyHeaders)).status).toBe(401);
    expect((await r.actions()).filter((a) => a === PlatformSecurityAction.SessionExpired)).toHaveLength(2);
  });
});
