import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createLanRoutes } from "./routes.js";

import { insecureHeaderAuthContextResolver } from "../permission-gate.js";
import type { SessionRegistry } from "../session-auth.js";
const LICENSED_FLAG = { "lan.multi_till": true };

function buildApp(params: {
  seats: number;
  licensed: boolean;
  sseHeartbeatMs?: number;
  maxSeatsPerUser?: number;
  sessions?: SessionRegistry;
}) {
  const entitlements = params.licensed
    ? createEntitlements({
        plan: "ENTERPRISE",
        activeModules: ["sales"],
        features: LICENSED_FLAG,
        seats: params.seats,
        expiresAt: null,
      })
    : createEntitlements({
        plan: "STANDARD",
        activeModules: ["sales"],
        features: {},
        seats: params.seats,
        expiresAt: null,
      });

  const registry = new SeatSessionRegistry(params.seats, { maxSeatsPerUser: params.maxSeatsPerUser });
  const app = createLanRoutes({
    resolveEntitlements: () => entitlements,
    registry,
    sseHeartbeatMs: params.sseHeartbeatMs,
    resolveAuthContext: insecureHeaderAuthContextResolver,
    sessions: params.sessions,
  });
  return { app, registry };
}

/** A fake auth `SessionRegistry` that just records which tokens got revoked. */
function fakeAuthSessions(): { sessions: SessionRegistry; revoked: string[] } {
  const revoked: string[] = [];
  return {
    sessions: {
      issue: async () => "unused",
      issueDeviceBound: async () => ({ token: "unused", deviceSecret: "unused" }),
      needsStepUp: async () => false,
      confirmStepUp: async () => {},
      find: async () => null,
      inspect: async () => ({ grant: null, refusal: null }),
      revoke: async (token: string) => {
        revoked.push(token);
      },
      revokeUser: async () => {},
    },
    revoked,
  };
}

/**
 * Since S8 the device-management routes need a session, and enumerating
 * needs `admin.devices.view` while disconnecting needs `admin.devices.manage`
 * (re-gated off `admin.settings.*` by PR #54 review finding #4 — no seeded
 * role held `admin.settings.edit`, so only the tenant's `isCompanyAdmin`
 * account could ever free a stuck seat).
 */
const ADMIN = { "x-permissions": "admin.devices.view,admin.devices.manage" };

/** Connects a device as `userId` — the seat identity the server derives, never a body field any more. */
function connectReq(params: { deviceId: string; deviceLabel?: string; userId?: string }) {
  const { userId = "u1", ...body } = params;
  return new Request("http://local/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify(body),
  });
}

describe("LAN license-flag gate", () => {
  it("rejects /sessions with 403 LAN_MODE_NOT_LICENSED when the feature flag is off", async () => {
    const { app } = buildApp({ seats: 5, licensed: false });
    const res = await app.fetch(connectReq({ deviceId: "till-1" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "LAN_MODE_NOT_LICENSED",
      feature: "lan.multi_till",
    });
  });

  it("rejects GET /sessions and DELETE /sessions/:id the same way when unlicensed", async () => {
    const { app } = buildApp({ seats: 5, licensed: false });
    const listRes = await app.fetch(new Request("http://local/sessions"));
    expect(listRes.status).toBe(403);

    const delRes = await app.fetch(new Request("http://local/sessions/s1", { method: "DELETE" }));
    expect(delRes.status).toBe(403);
  });

  it("allows /sessions once the license carries the lan.multi_till feature flag", async () => {
    const { app } = buildApp({ seats: 5, licensed: true });
    const res = await app.fetch(connectReq({ deviceId: "till-1" }));
    expect(res.status).toBe(201);
  });

  it("/status is never gated: reports licensed:false without a flag, true with one", async () => {
    const { app: unlicensedApp } = buildApp({ seats: 5, licensed: false });
    const unlicensedRes = await unlicensedApp.fetch(new Request("http://local/status"));
    expect(unlicensedRes.status).toBe(200);
    expect(await unlicensedRes.json()).toEqual({ licensed: false, seats: 0, connected: 0 });

    const { app: licensedApp } = buildApp({ seats: 3, licensed: true });
    const licensedRes = await licensedApp.fetch(new Request("http://local/status"));
    expect(await licensedRes.json()).toEqual({ licensed: true, seats: 3, connected: 0 });
  });
});

describe("the seat is a server identity, not a caller-supplied one (S54 review finding #1)", () => {
  it("connect response carries a server-derived sessionId; the body has no such field to send", async () => {
    const { app } = buildApp({ seats: 5, licensed: true });
    const res = await app.fetch(connectReq({ deviceId: "till-1", deviceLabel: "Front till", userId: "u1" }));
    expect(res.status).toBe(201);
    const session = (await res.json()) as { sessionId: string; userId: string; deviceId: string; deviceLabel: string };
    expect(session.userId).toBe("u1");
    expect(session.deviceId).toBe("till-1");
    expect(session.deviceLabel).toBe("Front till");
    expect(typeof session.sessionId).toBe("string");
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it("reconnecting the SAME account+device is idempotent and does not consume a second seat", async () => {
    const { app, registry } = buildApp({ seats: 1, licensed: true });
    const r1 = await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));
    const r2 = await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(registry.connectedCount).toBe(1);
  });

  it("caps concurrent seats for one account, so looping fresh device ids under one login cannot exhaust the tenant's seats", async () => {
    // Regression guard: before this fix, seat identity was a caller-supplied
    // sessionId, so any signed-in account could loop with a fresh random id
    // until SeatLimitExceededError. With deviceId also caller-named, the
    // per-account cap is what actually stops the loop.
    const { app } = buildApp({ seats: 10, licensed: true, maxSeatsPerUser: 2 });

    const r1 = await app.fetch(connectReq({ deviceId: "d1", userId: "attacker" }));
    const r2 = await app.fetch(connectReq({ deviceId: "d2", userId: "attacker" }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const r3 = await app.fetch(connectReq({ deviceId: "d3", userId: "attacker" }));
    expect(r3.status).toBe(409);
    const refusal = (await r3.json()) as { error: string; maxSeatsPerUser: number; message: string; messageEn: string };
    expect(refusal).toMatchObject({ error: "USER_SEAT_LIMIT_EXCEEDED", maxSeatsPerUser: 2 });
    expect(refusal.message).toBe("هذا الحساب متصل بالفعل من 2 جهاز، وهو الحد الأقصى للحساب الواحد. افصل أحد أجهزته من «الأجهزة المتصلة» ثم أعد المحاولة، أو استخدم حساباً آخر على هذا الجهاز.");
    expect(refusal.messageEn).toContain("already holds 2 concurrent device session");

    // A different, legitimate account can still connect — the tenant's other
    // 8 seats were never touched by the capped account.
    const r4 = await app.fetch(connectReq({ deviceId: "till-1", userId: "someone-else" }));
    expect(r4.status).toBe(201);
  });
});

describe("LAN seat enforcement over HTTP", () => {
  it("allows connecting up to N devices, then rejects the (N+1)th with 409", async () => {
    const { app } = buildApp({ seats: 2, licensed: true });

    const r1 = await app.fetch(connectReq({ deviceId: "till-1", deviceLabel: "Front till", userId: "u1" }));
    expect(r1.status).toBe(201);
    const session1 = await r1.json();
    expect(session1).toMatchObject({ deviceId: "till-1", deviceLabel: "Front till", userId: "u1" });

    const r2 = await app.fetch(connectReq({ deviceId: "till-2", userId: "u2" }));
    expect(r2.status).toBe(201);

    const r3 = await app.fetch(connectReq({ deviceId: "till-3", userId: "u3" }));
    expect(r3.status).toBe(409);
    const full = (await r3.json()) as { message: string; messageEn: string };
    expect(full).toMatchObject({
      error: "SEAT_LIMIT_EXCEEDED",
      seats: 2,
      connected: 2,
    });
    expect(full.message).toBe("اكتمل عدد الأجهزة التي يسمح بها الترخيص (2 من 2). افصل جهازاً من «الأجهزة المتصلة» قبل توصيل جهاز آخر.");
    expect(full.messageEn).toContain("Seat limit reached");
  });

  it("frees a slot on disconnect, and the freed slot is immediately reusable", async () => {
    const { app } = buildApp({ seats: 1, licensed: true });

    const r1 = await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));
    expect(r1.status).toBe(201);
    const { sessionId } = (await r1.json()) as { sessionId: string };

    const r2 = await app.fetch(connectReq({ deviceId: "till-2", userId: "u2" }));
    expect(r2.status).toBe(409);

    const delRes = await app.fetch(
      new Request(`http://local/sessions/${sessionId}`, { method: "DELETE", headers: ADMIN }),
    );
    expect(delRes.status).toBe(204);

    const r3 = await app.fetch(connectReq({ deviceId: "till-2", userId: "u2" }));
    expect(r3.status).toBe(201);
  });

  it("disconnecting an unknown session returns 404", async () => {
    const { app } = buildApp({ seats: 2, licensed: true });
    const res = await app.fetch(new Request("http://local/sessions/ghost", { method: "DELETE", headers: ADMIN }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "DEVICE_SESSION_NOT_FOUND" });
  });

  it("GET /sessions lists connected devices for the admin panel", async () => {
    const { app } = buildApp({ seats: 3, licensed: true });
    await app.fetch(connectReq({ deviceId: "till-1", deviceLabel: "Front till", userId: "u1" }));
    await app.fetch(connectReq({ deviceId: "till-2", deviceLabel: "Back office", userId: "u2" }));

    const res = await app.fetch(new Request("http://local/sessions", { headers: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seats: number;
      connected: number;
      sessions: Array<{ deviceId: string; deviceLabel: string; userId: string }>;
    };
    expect(body.seats).toBe(3);
    expect(body.connected).toBe(2);
    expect(body.sessions.map((s) => s.deviceId).sort()).toEqual(["till-1", "till-2"]);
    expect(body.sessions.map((s) => s.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("rejects a malformed connect body with 400 before touching the registry", async () => {
    const { app, registry } = buildApp({ seats: 2, licensed: true });
    const res = await app.fetch(
      new Request("http://local/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "u1" },
        body: JSON.stringify({ deviceLabel: "no deviceId here" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(registry.connectedCount).toBe(0);
  });
});

describe("device-management gating is admin.devices.* (PR #54 review finding #4)", () => {
  it("a caller with only admin.devices.view can list but not disconnect", async () => {
    const { app } = buildApp({ seats: 2, licensed: true });
    await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));

    const viewer = { "x-permissions": "admin.devices.view" };
    const list = await app.fetch(new Request("http://local/sessions", { headers: viewer }));
    expect(list.status).toBe(200);

    const disconnect = await app.fetch(
      new Request("http://local/sessions/anything", { method: "DELETE", headers: viewer }),
    );
    expect(disconnect.status).toBe(403);
  });
});

describe("disconnect actually evicts the device (PR #54 review finding #3)", () => {
  it("revokes the exact auth token the device connected with, not every session for the account", async () => {
    const { sessions, revoked } = fakeAuthSessions();
    const { app } = buildApp({ seats: 2, licensed: true, sessions });

    const connectRes = await app.fetch(
      new Request("http://local/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "u1",
          authorization: "Bearer till-1-token",
        },
        body: JSON.stringify({ deviceId: "till-1" }),
      }),
    );
    const { sessionId } = (await connectRes.json()) as { sessionId: string };

    const delRes = await app.fetch(
      new Request(`http://local/sessions/${sessionId}`, { method: "DELETE", headers: ADMIN }),
    );
    expect(delRes.status).toBe(204);
    expect(revoked).toEqual(["till-1-token"]);
  });

  it("without a wired auth SessionRegistry, disconnect still frees the seat (no crash)", async () => {
    const { app } = buildApp({ seats: 1, licensed: true });
    const connectRes = await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));
    const { sessionId } = (await connectRes.json()) as { sessionId: string };

    const delRes = await app.fetch(
      new Request(`http://local/sessions/${sessionId}`, { method: "DELETE", headers: ADMIN }),
    );
    expect(delRes.status).toBe(204);
  });

  it("pushes a per-session 'disconnected' event on /lan/events so the affected till knows", async () => {
    const { app } = buildApp({ seats: 2, licensed: true, sseHeartbeatMs: 60_000 });
    const connectRes = await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }));
    const { sessionId } = (await connectRes.json()) as { sessionId: string };

    const controller = new AbortController();
    const eventsRes = await app.fetch(new Request("http://local/events", { signal: controller.signal, headers: { "x-user-id": "u1" } }));
    const reader = eventsRes.body!.getReader();
    await reader.read(); // the initial "connected" event

    const delRes = await app.fetch(
      new Request(`http://local/sessions/${sessionId}`, { method: "DELETE", headers: ADMIN }),
    );
    expect(delRes.status).toBe(204);

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain("event: disconnected");
    expect(chunk).toContain(sessionId);

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it("tells nobody else's till, and tells whoever keeps the device register (D111)", async () => {
    const { app } = buildApp({ seats: 3, licensed: true, sseHeartbeatMs: 40 });
    const { sessionId } = (await (await app.fetch(connectReq({ deviceId: "till-1", userId: "u1" }))).json()) as { sessionId: string };
    const listen = async (headers: Record<string, string>) => {
      const controller = new AbortController();
      const res = await app.fetch(new Request("http://local/events", { signal: controller.signal, headers }));
      const reader = res.body!.getReader();
      await reader.read();
      return { reader, controller };
    };
    const otherTill = await listen({ "x-user-id": "u2" });
    const registerKeeper = await listen({ "x-user-id": "u3", "x-permissions": "admin.devices.view" });
    const branchRegisterKeeper = await listen({ "x-user-id": "u4", "x-permissions": "admin.devices.view", "x-branch-scope": "BR-ALEX" });

    await app.fetch(new Request(`http://local/sessions/${sessionId}`, { method: "DELETE", headers: ADMIN }));

    const next = async (listener: { reader: ReadableStreamDefaultReader<Uint8Array> }) => new TextDecoder().decode((await listener.reader.read()).value);
    expect(await next(registerKeeper)).toContain(sessionId);
    const heardByOther = await next(otherTill);
    expect(heardByOther).toContain("event: ping");
    expect(heardByOther).not.toContain(sessionId);
    expect(await next(branchRegisterKeeper)).not.toContain(sessionId);

    for (const listener of [otherTill, registerKeeper, branchRegisterKeeper]) {
      listener.controller.abort();
      await listener.reader.cancel().catch(() => {});
    }
  });
});

describe("LAN SSE events endpoint", () => {
  it("streams text/event-stream and an initial 'connected' event", async () => {
    const { app } = buildApp({ seats: 2, licensed: true, sseHeartbeatMs: 5 });
    const controller = new AbortController();

    const res = await app.fetch(
      new Request("http://local/events", { signal: controller.signal }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain("event: connected");
    expect(chunk).toContain('"seats":2');

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  /**
   * guards N-12: ONE MACHINE HOLDING UNLIMITED STREAMS IS A DENIAL OF SERVICE.
   *
   * Each subscriber is a live socket plus a heartbeat timer on the host's
   * single event loop — the loop every SQLite call in the product runs on — and
   * nothing counted them, so a signed-in till looping `GET /lan/events` could
   * take the shop down without ever exceeding its seat or its permissions.
   */
  it("refuses a session that holds too many concurrent streams, and frees the slot when one closes", async () => {
    const { app } = buildApp({ seats: 2, licensed: true, sseHeartbeatMs: 5 });
    const open: Array<{ controller: AbortController; reader: ReadableStreamDefaultReader }> = [];

    for (let i = 0; i < 3; i += 1) {
      const controller = new AbortController();
      const res = await app.fetch(
        new Request("http://local/events", {
          signal: controller.signal,
          headers: { authorization: "Bearer till-token" },
        }),
      );
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      // Read the `connected` frame so the stream is genuinely established.
      await reader.read();
      open.push({ controller, reader });
    }

    const refused = await app.fetch(
      new Request("http://local/events", {
        signal: new AbortController().signal,
        headers: { authorization: "Bearer till-token" },
      }),
    );
    expect(refused.status).toBe(429);

    // A different session is unaffected — the cap belongs to the session, not
    // to the host.
    const other = await app.fetch(
      new Request("http://local/events", {
        signal: new AbortController().signal,
        headers: { authorization: "Bearer other-token" },
      }),
    );
    expect(other.status).toBe(200);
    await other.body!.cancel().catch(() => {});

    // Closing one frees exactly one slot — released in `finally`, so a stream
    // that dies mid-write does not strand its slot forever.
    const first = open.shift()!;
    first.controller.abort();
    await first.reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 20));

    const afterClose = await app.fetch(
      new Request("http://local/events", {
        signal: new AbortController().signal,
        headers: { authorization: "Bearer till-token" },
      }),
    );
    expect(afterClose.status).toBe(200);
    await afterClose.body!.cancel().catch(() => {});

    for (const held of open) {
      held.controller.abort();
      await held.reader.cancel().catch(() => {});
    }
  });
});

describe("a licence is not a credential (S8)", () => {
  it("refuses every device-management route to a caller with no session at all", async () => {
    // Measured before the fix: `/lan/*` was gated on the `lan.multi_till`
    // feature flag and nothing else. Anyone on the shop wifi could do all of
    // this without an account.
    const { app } = buildApp({ seats: 2, licensed: true });

    const list = await app.fetch(new Request("http://local/sessions"));
    const disconnect = await app.fetch(new Request("http://local/sessions/s1", { method: "DELETE" }));

    expect([401, 403]).toContain(list.status);
    expect([401, 403]).toContain(disconnect.status);
  });

  it("refuses a caller who is signed in but holds the wrong permission", async () => {
    // A session alone is not enough for the routes that act on OTHER people's
    // devices. A cashier must not be able to disconnect the counter.
    const { app, registry } = buildApp({ seats: 2, licensed: true });
    registry.connect({ userId: "u1", deviceId: "till-1", deviceLabel: "كاشير ١" });
    const seatId = registry.list()[0]!.sessionId;
    const cashier = { "x-permissions": "sales.invoice.view" };

    const list = await app.fetch(new Request("http://local/sessions", { headers: cashier }));
    const disconnect = await app.fetch(
      new Request(`http://local/sessions/${seatId}`, { method: "DELETE", headers: cashier }),
    );

    expect(list.status).toBe(403);
    expect(disconnect.status).toBe(403);
    // And the refusal did not free the seat — a 403 that still disconnected
    // the till would be the same denial of service with a different number.
    expect(registry.list()).toHaveLength(1);
  });

  it("still lets an admin list and disconnect (the negative control)", async () => {
    const { app, registry } = buildApp({ seats: 2, licensed: true });
    registry.connect({ userId: "u1", deviceId: "till-1", deviceLabel: "كاشير ١" });
    const seatId = registry.list()[0]!.sessionId;

    const list = await app.fetch(new Request("http://local/sessions", { headers: ADMIN }));
    expect(list.status).toBe(200);

    const disconnect = await app.fetch(
      new Request(`http://local/sessions/${seatId}`, { method: "DELETE", headers: ADMIN }),
    );
    expect(disconnect.status).toBe(204);
    expect(registry.list()).toHaveLength(0);
  });
});
