import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_SCOPE, type AuthContext } from "@mezan/domain";
import {
  createSessionAuthContextResolver,
  createSessionRegistry,
  readSessionToken,
  tokensMatch,
  DEVICE_MISMATCH_LIMIT,
  DEVICE_MISMATCH_WINDOW_MS,
  DISPLACED_SESSIONS_REMEMBERED,
  MAX_SESSION_MS,
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
    await sessions.issue(clerkGrant);
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
    const token = await sessions.issue(clerkGrant);
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
    const token = await sessions.issue(clerkGrant);
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
    const token = await sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    expect((await app.fetch(new Request("http://local/secret", bearer(token)))).status).toBe(200);
    await sessions.revoke(token);
    await sessions.revoke(token);
    expect((await app.fetch(new Request("http://local/secret", bearer(token)))).status).toBe(401);
  });

  it("revokeUser kills every session that user holds, and no one else's", async () => {
    const sessions = createSessionRegistry();
    const first = await sessions.issue(clerkGrant);
    const second = await sessions.issue(clerkGrant);
    const other = await sessions.issue({ ...clerkGrant, userId: "USER-OTHER" });
    const app = guardedApp(sessions);

    await sessions.revokeUser("USER-CLERK");
    expect((await app.fetch(new Request("http://local/secret", bearer(first)))).status).toBe(401);
    expect((await app.fetch(new Request("http://local/secret", bearer(second)))).status).toBe(401);
    expect((await app.fetch(new Request("http://local/secret", bearer(other)))).status).toBe(200);
  });

  it("an idle session expires, and a used one survives the idle clock", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = await sessions.issue(clerkGrant);

    clock += IDLE_TIMEOUT_MS - 1;
    expect(await sessions.find(token)).not.toBeNull();

    // Used, so the idle clock restarted — a shop laptop left signed in all day
    // is not signed out at lunchtime.
    clock += IDLE_TIMEOUT_MS - 1;
    expect(await sessions.find(token)).toBeNull(); // ...but the absolute cap has passed

    const fresh = await sessions.issue(clerkGrant);
    clock += IDLE_TIMEOUT_MS - 1;
    expect(await sessions.find(fresh)).not.toBeNull();
    clock += IDLE_TIMEOUT_MS + 1;
    expect(await sessions.find(fresh)).toBeNull();
  });

  it("caps a session that is in constant use, which the idle timeout alone never did", async () => {
    // `lastSeenAt` refreshes on every find(), so before the absolute cap a
    // token that was POLLED never expired at any point in its life — which is
    // exactly the state a token lifted from a till is in.
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = await sessions.issue(clerkGrant);

    for (let hour = 1; hour <= 16; hour += 1) {
      clock += 60 * 60 * 1000;
      expect(await sessions.find(token)).not.toBeNull();
    }
    clock += 1;
    expect(await sessions.find(token)).toBeNull();
  });

  it("two logins mint different tokens, and killing one leaves the other alive", async () => {
    const sessions = createSessionRegistry();
    const first = await sessions.issue(clerkGrant);
    const second = await sessions.issue(clerkGrant);
    expect(first).not.toBe(second);
    await sessions.revoke(first);
    expect(await sessions.find(first)).toBeNull();
    expect(await sessions.find(second)).not.toBeNull();
  });

  it("issued tokens carry at least 256 bits of entropy and never repeat", async () => {
    const sessions = createSessionRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const token = await sessions.issue(clerkGrant);
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
    const token = await sessions.issue(clerkGrant);
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
    const token = await sessions.issue({ ...clerkGrant, branchScope: ["BR-CAIRO", "BR-GIZA"] });
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
    const token = await sessions.issue(clerkGrant);
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
    const token = await sessions.issue({ ...clerkGrant, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
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
    const token = await sessions.issue(clerkGrant);
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

  it("keeps the secret the device already holds and ends the same user's earlier session on it, whose cookie the sign-in overwrites", async () => {
    const sessions = createSessionRegistry();
    const first = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    const elsewhere = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    const second = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10", first.deviceSecret);

    expect(second.deviceSecret).toBe(first.deviceSecret);
    expect(second.token).not.toBe(first.token);
    expect(await sessions.inspect(first.token, "41.33.10.10", second.deviceSecret)).toEqual({ grant: null, refusal: null });
    expect((await sessions.inspect(second.token, "41.33.10.10", second.deviceSecret)).grant?.userId).toBe("u-1");
    expect((await sessions.inspect(elsewhere.token, "41.33.10.10", elsewhere.deviceSecret)).grant?.userId).toBe("u-1");
  });

  it("ends another user's session on that device and says why — displaced by a sign-in, never a stolen device or a moved address", async () => {
    const sessions = createSessionRegistry();
    const first = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    const second = await sessions.issueDeviceBound(grantOf("u-2"), "41.33.10.10", first.deviceSecret);

    expect(second.deviceSecret).not.toBe(first.deviceSecret);
    const ended = await sessions.inspect(first.token, "41.33.10.10", second.deviceSecret);
    expect(ended.grant).toBeNull();
    expect(ended.refusal).toMatchObject({ reason: SessionRefusalKind.Displaced, userId: "u-1" });
    expect(ended.addressChange ?? null).toBeNull();
    expect((await sessions.inspect(first.token, "41.33.10.10", second.deviceSecret)).refusal?.reason).toBe(SessionRefusalKind.Displaced);
    expect((await sessions.inspect(second.token, "41.33.10.10", second.deviceSecret)).grant?.userId).toBe("u-2");
  });

  it("forgets that a session was displaced once the session would have idled out anyway, and never remembers more than a bounded number", async () => {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const first = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    await sessions.issueDeviceBound(grantOf("u-2"), "41.33.10.10", first.deviceSecret);
    now += 12 * 60 * 60 * 1000 + 1;
    expect(await sessions.inspect(first.token, "41.33.10.10", null)).toEqual({ grant: null, refusal: null });

    const crowded = createSessionRegistry(() => now);
    const tokens: string[] = [];
    let held = await crowded.issueDeviceBound(grantOf("u-0"), "41.33.10.10");
    for (let i = 1; i <= DISPLACED_SESSIONS_REMEMBERED + 5; i += 1) {
      tokens.push(held.token);
      held = await crowded.issueDeviceBound(grantOf(`u-${i}`), "41.33.10.10", held.deviceSecret);
    }
    expect(await crowded.inspect(tokens[0]!, "41.33.10.10", null)).toEqual({ grant: null, refusal: null });
    expect((await crowded.inspect(tokens.at(-1)!, "41.33.10.10", null)).refusal?.reason).toBe(SessionRefusalKind.Displaced);
  });

  it("does not call a signed-out or revoked session displaced", async () => {
    const sessions = createSessionRegistry();
    const first = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    await sessions.revoke(first.token);
    expect(await sessions.inspect(first.token, "41.33.10.10", first.deviceSecret)).toEqual({ grant: null, refusal: null });
  });

  it("never adopts a secret no live session was issued with", async () => {
    const sessions = createSessionRegistry();
    const planted = "attacker-chosen-secret";
    const issued = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10", planted);

    expect(issued.deviceSecret).not.toBe(planted);
    expect((await sessions.inspect(issued.token, "41.33.10.10", planted)).grant).toBeNull();
  });
});

describe("a bearer token presented without the secret of the device it was issued to", () => {
  const grantOf = (userId: string) => ({ userId, permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const MINUTE = 60_000;

  async function bound() {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const session = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    return { sessions, session, advance: (ms: number) => void (now += ms) };
  }

  it("is refused, and the holder's session is still there for the device that has the secret", async () => {
    const { sessions, session } = (await bound());

    const stolen = await sessions.inspect(session.token, "196.221.5.5", null);
    const wrong = await sessions.inspect(session.token, "196.221.5.5", "not-the-secret");

    expect(stolen.grant).toBeNull();
    expect(stolen.refusal).toMatchObject({ reason: SessionRefusalKind.Device, userId: "u-1", sessionEnded: false });
    expect(wrong.refusal).toMatchObject({ reason: SessionRefusalKind.Device, sessionEnded: false });
    expect((await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret)).grant?.userId).toBe("u-1");
  });

  it(`ends the session on the ${DEVICE_MISMATCH_LIMIT}th refusal inside ${DEVICE_MISMATCH_WINDOW_MS / MINUTE} minutes, and says so on that refusal`, async () => {
    const { sessions, session } = (await bound());
    const ended: (boolean | undefined)[] = [];
    for (let i = 0; i < DEVICE_MISMATCH_LIMIT; i += 1) ended.push((await sessions.inspect(session.token, "196.221.5.5", null)).refusal?.sessionEnded);

    expect(ended).toEqual([...Array<boolean>(DEVICE_MISMATCH_LIMIT - 1).fill(false), true]);
    expect(await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret)).toEqual({ grant: null, refusal: null });
  });

  it("does not end it for refusals spread wider than the window, however many there are", async () => {
    const { sessions, session, advance } = (await bound());
    for (let i = 0; i < DEVICE_MISMATCH_LIMIT * 3; i += 1) {
      expect((await sessions.inspect(session.token, "196.221.5.5", null)).refusal?.sessionEnded).toBe(false);
      advance(DEVICE_MISMATCH_WINDOW_MS / (DEVICE_MISMATCH_LIMIT - 1) + 1);
      expect((await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret)).grant?.userId).toBe("u-1");
    }
  });

  it("is not forgiven by the holder's own requests in between: the count belongs to the refusals", async () => {
    const { sessions, session } = (await bound());
    for (let i = 0; i < DEVICE_MISMATCH_LIMIT - 1; i += 1) {
      await sessions.inspect(session.token, "196.221.5.5", null);
      await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret);
    }
    expect((await sessions.inspect(session.token, "196.221.5.5", null)).refusal?.sessionEnded).toBe(true);
  });
});

describe("how long a device-bound session and its secret live", () => {
  const grantOf = (userId: string) => ({ userId, permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const HOUR = 60 * 60_000;

  it("serves a session in steady use right up to its cap, so the secret a browser holds must be kept that long", async () => {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const session = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    for (let hour = 1; hour <= 15; hour += 1) {
      now += HOUR;
      expect((await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret)).grant?.userId).toBe("u-1");
    }
    expect(MAX_SESSION_MS).toBe(16 * HOUR);
    now += HOUR + 1;
    expect((await sessions.inspect(session.token, "41.33.10.10", session.deviceSecret)).refusal?.reason).toBe(SessionRefusalKind.Aged);
  });

  it("does not adopt the secret of the same user's session once that session has expired", async () => {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const first = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10");
    now += IDLE_TIMEOUT_MS + 1;

    const second = await sessions.issueDeviceBound(grantOf("u-1"), "41.33.10.10", first.deviceSecret);

    expect(second.deviceSecret).not.toBe(first.deviceSecret);
    expect((await sessions.inspect(second.token, "41.33.10.10", first.deviceSecret)).grant).toBeNull();
    expect((await sessions.inspect(second.token, "41.33.10.10", second.deviceSecret)).grant?.userId).toBe("u-1");
  });
});
