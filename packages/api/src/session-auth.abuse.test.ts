import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_SCOPE, type AuthContext } from "@mezan/domain";
import {
  createSessionAuthContextResolver,
  createSessionRegistry,
  readSessionToken,
  tokensMatch,
  DISPLACED_SESSIONS_REMEMBERED,
  SessionRefusalKind,
} from "./session-auth.js";
import { createPermissionGate } from "./permission-gate.js";

const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function guardedApp(sessions: ReturnType<typeof createSessionRegistry>) {
  const gate = createPermissionGate(createSessionAuthContextResolver(sessions));
  const app = new Hono();
  app.get("/secret", gate("accounting.coa.view"), (c) => c.json({ ok: true }));
  app.get("/whoami", gate("accounting.coa.view"), (c) => {
    const ctx = (c as unknown as { get(key: string): AuthContext }).get("authContext");
    return c.json({
      userId: ctx.userId,
      branchScope: ctx.branchScope === ALL_SCOPE ? "*" : [...ctx.branchScope],
      warehouseScope: ctx.warehouseScope === ALL_SCOPE ? "*" : [...ctx.warehouseScope],
    });
  });
  return app;
}

function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } };
}

const clerkGrant = {
  userId: "USER-CLERK",
  permissions: ["accounting.coa.view"],
  roleCode: "CLERK",
  branchScope: ["BR-CAIRO"] as readonly string[],
  warehouseScope: ["WH-MAIN"] as readonly string[],
};

describe("session tokens — brute force and forgery", () => {
  it("refuses 2,000 forged tokens without ever granting a session", async () => {
    const sessions = createSessionRegistry();
    sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const statuses = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const forged = Buffer.from(`guess-${i}`.padEnd(32, "x")).toString("base64url");
      const res = await app.fetch(new Request("http://local/secret", bearer(forged)));
      statuses.add(res.status);
    }
    expect([...statuses]).toEqual([401]);
  });

  it("refuses every malformed Authorization header shape", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const headers: Record<string, string>[] = [
      { authorization: token },
      { authorization: `Basic ${token}` },
      { authorization: "Bearer" },
      { authorization: "Bearer " },
      { authorization: `bearer  ${token}` },
      { authorization: `Bearer ${token.slice(0, -1)}` },
      { authorization: `Bearer ${token.toUpperCase()}` },
      { "x-session-token": `${token}x` },
      { "x-session-token": "" },
    ];
    for (const header of headers) {
      const res = await app.fetch(new Request("http://local/secret", { headers: header }));
      expect(res.status, JSON.stringify(header)).toBe(401);
    }
  });

  it("ignores anything after the token in the Authorization header rather than failing open", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const withJunk = await app.fetch(
      new Request("http://local/secret", { headers: { authorization: `Bearer ${token} extra` } }),
    );
    expect(withJunk.status).toBe(200);

    const junkOnly = await app.fetch(
      new Request("http://local/secret", { headers: { authorization: `Bearer extra ${token}` } }),
    );
    expect(junkOnly.status).toBe(401);
  });

  it("never accepts client-asserted permissions — x-permissions is inert", async () => {
    const sessions = createSessionRegistry();
    const app = guardedApp(sessions);

    for (const value of ["*", "accounting.coa.view", "accounting.coa.view,accounting.coa.manage"]) {
      const res = await app.fetch(
        new Request("http://local/secret", { headers: { "x-permissions": value, "x-user-id": "USER-ADMIN" } }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("a revoked token is dead immediately, and revoking twice is harmless", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    expect((await app.fetch(new Request("http://local/secret", bearer(token)))).status).toBe(200);
    sessions.revoke(token);
    sessions.revoke(token);
    expect((await app.fetch(new Request("http://local/secret", bearer(token)))).status).toBe(401);
  });

  it("revokeUser kills every session that user holds, and no one else's", async () => {
    const sessions = createSessionRegistry();
    const first = sessions.issue(clerkGrant);
    const second = sessions.issue(clerkGrant);
    const other = sessions.issue({ ...clerkGrant, userId: "USER-OTHER" });
    const app = guardedApp(sessions);

    sessions.revokeUser("USER-CLERK");
    expect((await app.fetch(new Request("http://local/secret", bearer(first)))).status).toBe(401);
    expect((await app.fetch(new Request("http://local/secret", bearer(second)))).status).toBe(401);
    expect((await app.fetch(new Request("http://local/secret", bearer(other)))).status).toBe(200);
  });

  it("an idle session expires, and a used one survives the idle clock", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = sessions.issue(clerkGrant);

    clock += IDLE_TIMEOUT_MS - 1;
    expect(sessions.find(token)).not.toBeNull();

    // Used, so the idle clock restarted — a shop laptop left signed in all day
    // is not signed out at lunchtime.
    clock += IDLE_TIMEOUT_MS - 1;
    expect(sessions.find(token)).toBeNull(); // ...but the absolute cap has passed

    const fresh = sessions.issue(clerkGrant);
    clock += IDLE_TIMEOUT_MS - 1;
    expect(sessions.find(fresh)).not.toBeNull();
    clock += IDLE_TIMEOUT_MS + 1;
    expect(sessions.find(fresh)).toBeNull();
  });

  it("caps a session that is in constant use, which the idle timeout alone never did", () => {
    // `lastSeenAt` refreshes on every find(), so before the absolute cap a
    // token that was POLLED never expired at any point in its life — which is
    // exactly the state a token lifted from a till is in.
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = sessions.issue(clerkGrant);

    for (let hour = 1; hour <= 16; hour += 1) {
      clock += 60 * 60 * 1000;
      expect(sessions.find(token)).not.toBeNull();
    }
    clock += 1;
    expect(sessions.find(token)).toBeNull();
  });

  it("two logins mint different tokens, and killing one leaves the other alive", () => {
    const sessions = createSessionRegistry();
    const first = sessions.issue(clerkGrant);
    const second = sessions.issue(clerkGrant);
    expect(first).not.toBe(second);
    sessions.revoke(first);
    expect(sessions.find(first)).toBeNull();
    expect(sessions.find(second)).not.toBeNull();
  });

  it("issued tokens carry at least 256 bits of entropy and never repeat", () => {
    const sessions = createSessionRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const token = sessions.issue(clerkGrant);
      expect(token.length).toBeGreaterThanOrEqual(42);
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});

describe("scope headers — a caller may narrow, never widen", () => {
  it("ignores a branch outside the grant and keeps the granted scope", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const res = await app.fetch(
      new Request("http://local/whoami", {
        headers: { authorization: `Bearer ${token}`, "x-branch-scope": "BR-ALEX", "x-warehouse-scope": "WH-VAN" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "USER-CLERK",
      branchScope: ["BR-CAIRO"],
      warehouseScope: ["WH-MAIN"],
    });
  });

  it("keeps only the granted ids when a request mixes granted and foreign ones", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue({ ...clerkGrant, branchScope: ["BR-CAIRO", "BR-GIZA"] });
    const app = guardedApp(sessions);

    const res = await app.fetch(
      new Request("http://local/whoami", {
        headers: { authorization: `Bearer ${token}`, "x-branch-scope": "BR-GIZA,BR-ALEX" },
      }),
    );
    expect((await res.json() as { branchScope: string[] }).branchScope).toEqual(["BR-GIZA"]);
  });

  it("a `*` scope header does not promote a scoped user to all branches", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const res = await app.fetch(
      new Request("http://local/whoami", {
        headers: { authorization: `Bearer ${token}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
      }),
    );
    expect(await res.json()).toEqual({
      userId: "USER-CLERK",
      branchScope: ["BR-CAIRO"],
      warehouseScope: ["WH-MAIN"],
    });
  });

  it("an all-scope grant narrows to exactly what the request asks for", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue({ ...clerkGrant, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const app = guardedApp(sessions);

    const res = await app.fetch(
      new Request("http://local/whoami", {
        headers: { authorization: `Bearer ${token}`, "x-branch-scope": "BR-ALEX" },
      }),
    );
    expect(await res.json()).toEqual({
      userId: "USER-CLERK",
      branchScope: ["BR-ALEX"],
      warehouseScope: "*",
    });
  });

  it("survives a scope header stuffed with 10,000 ids without widening anything", async () => {
    const sessions = createSessionRegistry();
    const token = sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    const flood = Array.from({ length: 10_000 }, (_, i) => `BR-${i}`).join(",");
    const res = await app.fetch(
      new Request("http://local/whoami", {
        headers: { authorization: `Bearer ${token}`, "x-branch-scope": flood },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { branchScope: string[] }).branchScope).toEqual(["BR-CAIRO"]);
  });
});

describe("token reader and comparison", () => {
  it("prefers the Authorization header and falls back to x-session-token", () => {
    const read = (headers: Record<string, string>) =>
      readSessionToken({ req: { header: (name: string) => headers[name.toLowerCase()] } } as never);

    expect(read({ authorization: "Bearer abc" })).toBe("abc");
    expect(read({ "x-session-token": "xyz" })).toBe("xyz");
    expect(read({ authorization: "Bearer abc", "x-session-token": "xyz" })).toBe("abc");
    expect(read({})).toBeNull();
    expect(read({ authorization: "Token abc" })).toBeNull();
  });

  it("compares tokens without leaking length through an exception", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
    expect(tokensMatch("abc", "")).toBe(false);
  });
});

describe("a second sign-in from a device that already holds a session's secret", () => {
  const grantOf = (userId: string) => ({ userId, permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });

  it("keeps the same user's first session alive, bound to the secret the device already holds", () => {
    const sessions = createSessionRegistry();
    const first = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    const second = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10", first.deviceSecret);

    expect(second.deviceSecret).toBe(first.deviceSecret);
    expect(second.token).not.toBe(first.token);
    expect(sessions.inspect(first.token, "41.33.10.10", second.deviceSecret).grant?.userId).toBe("u-1");
    expect(sessions.inspect(second.token, "41.33.10.10", second.deviceSecret).grant?.userId).toBe("u-1");
  });

  it("ends another user's session on that device and says why — displaced by a sign-in, never a stolen device or a moved address", () => {
    const sessions = createSessionRegistry();
    const first = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    const second = sessions.issueDeviceBound(grantOf("u-2"), "41.33.10.10", first.deviceSecret);

    expect(second.deviceSecret).not.toBe(first.deviceSecret);
    const ended = sessions.inspect(first.token, "41.33.10.10", second.deviceSecret);
    expect(ended.grant).toBeNull();
    expect(ended.refusal).toMatchObject({ reason: SessionRefusalKind.Displaced, userId: "u-1" });
    expect(ended.addressChange ?? null).toBeNull();
    expect(sessions.inspect(first.token, "41.33.10.10", second.deviceSecret).refusal?.reason).toBe(SessionRefusalKind.Displaced);
    expect(sessions.inspect(second.token, "41.33.10.10", second.deviceSecret).grant?.userId).toBe("u-2");
  });

  it("forgets that a session was displaced once the session would have idled out anyway, and never remembers more than a bounded number", () => {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const first = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    sessions.issueDeviceBound(grantOf("u-2"), "41.33.10.10", first.deviceSecret);
    now += 12 * 60 * 60 * 1000 + 1;
    expect(sessions.inspect(first.token, "41.33.10.10", null)).toEqual({ grant: null, refusal: null });

    const crowded = createSessionRegistry(() => now);
    const tokens: string[] = [];
    let held = crowded.issueDeviceBound(grantOf("u-0"), "41.33.10.10");
    for (let i = 1; i <= DISPLACED_SESSIONS_REMEMBERED + 5; i += 1) {
      tokens.push(held.token);
      held = crowded.issueDeviceBound(grantOf(`u-${i}`), "41.33.10.10", held.deviceSecret);
    }
    expect(crowded.inspect(tokens[0]!, "41.33.10.10", null)).toEqual({ grant: null, refusal: null });
    expect(crowded.inspect(tokens.at(-1)!, "41.33.10.10", null).refusal?.reason).toBe(SessionRefusalKind.Displaced);
  });

  it("does not call a signed-out or revoked session displaced", () => {
    const sessions = createSessionRegistry();
    const first = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    sessions.revoke(first.token);
    expect(sessions.inspect(first.token, "41.33.10.10", first.deviceSecret)).toEqual({ grant: null, refusal: null });
  });

  it("never adopts a secret no live session was issued with", () => {
    const sessions = createSessionRegistry();
    const planted = "attacker-chosen-secret";
    const issued = sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10", planted);

    expect(issued.deviceSecret).not.toBe(planted);
    expect(sessions.inspect(issued.token, "41.33.10.10", planted).grant).toBeNull();
  });
});
