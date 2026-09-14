import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createSessionRegistry } from "@mezan/api";
import { createPlatformUser, type PlatformUser } from "@mezan/domain";
import { createPlatform, type PlatformHandle } from "./create-platform.js";
import { createPlatformAuth } from "./platform-auth.js";

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
    const { token } = (await json(loginRes)) as { token: string };

    const meRes = await auth.app.fetch(new Request("http://x/me", { headers: { authorization: `Bearer ${token}` } }));
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
    const { token } = (await json(loginRes)) as { token: string };

    const logoutRes = await auth.app.fetch(new Request("http://x/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(logoutRes.status).toBe(200);

    const meRes = await auth.app.fetch(new Request("http://x/me", { headers: { authorization: `Bearer ${token}` } }));
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
      return ((await json(res)) as { token: string }).token;
    }

    const ownerToken = await login("owner@mezan.app");
    const supportToken = await login("support@mezan.app");

    const ownerRes = await testApp.fetch(new Request("http://x/owner-only", { headers: { authorization: `Bearer ${ownerToken}` } }));
    expect(ownerRes.status).toBe(200);

    const supportRes = await testApp.fetch(new Request("http://x/owner-only", { headers: { authorization: `Bearer ${supportToken}` } }));
    expect(supportRes.status).toBe(403);
    expect(await json(supportRes)).toEqual({ error: "OWNER_ONLY", message: "هذا الإجراء لمالك المنصة فقط" });
  });
});
