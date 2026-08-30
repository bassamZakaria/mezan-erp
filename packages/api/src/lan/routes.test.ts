import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createLanRoutes } from "./routes.js";

const LICENSED_FLAG = { "lan.multi_till": true };

function buildApp(params: { seats: number; licensed: boolean; sseHeartbeatMs?: number }) {
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

  const registry = new SeatSessionRegistry(params.seats);
  const app = createLanRoutes({
    resolveEntitlements: () => entitlements,
    registry,
    sseHeartbeatMs: params.sseHeartbeatMs,
  });
  return { app, registry };
}

/**
 * Since S8 the device-management routes need a session, and enumerating or
 * disconnecting OTHER people's devices additionally needs
 * `admin.settings.view` / `.edit`. A licence is not a credential: these are the
 * routes reachable from every device on the shop wifi, and without a session
 * any of them could list the connected tills, burn every seat so no real till
 * could connect, or disconnect the counter mid-sale.
 */
const ADMIN = { "x-permissions": "admin.settings.view,admin.settings.edit" };

function connectReq(body: unknown) {
  return new Request("http://local/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("LAN license-flag gate", () => {
  it("rejects /sessions with 403 LAN_MODE_NOT_LICENSED when the feature flag is off", async () => {
    const { app } = buildApp({ seats: 5, licensed: false });
    const res = await app.fetch(connectReq({ sessionId: "s1", deviceId: "till-1" }));
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
    const res = await app.fetch(connectReq({ sessionId: "s1", deviceId: "till-1" }));
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

describe("LAN seat enforcement over HTTP", () => {
  it("allows connecting up to N devices, then rejects the (N+1)th with 409", async () => {
    const { app } = buildApp({ seats: 2, licensed: true });

    const r1 = await app.fetch(connectReq({ sessionId: "s1", deviceId: "till-1", deviceLabel: "Front till" }));
    expect(r1.status).toBe(201);
    const session1 = await r1.json();
    expect(session1).toMatchObject({ sessionId: "s1", deviceId: "till-1", deviceLabel: "Front till" });

    const r2 = await app.fetch(connectReq({ sessionId: "s2", deviceId: "till-2" }));
    expect(r2.status).toBe(201);

    const r3 = await app.fetch(connectReq({ sessionId: "s3", deviceId: "till-3" }));
    expect(r3.status).toBe(409);
    expect(await r3.json()).toMatchObject({
      error: "SEAT_LIMIT_EXCEEDED",
      seats: 2,
      connected: 2,
    });
  });

  it("frees a slot on disconnect, and the freed slot is immediately reusable", async () => {
    const { app } = buildApp({ seats: 1, licensed: true });

    const r1 = await app.fetch(connectReq({ sessionId: "s1", deviceId: "till-1" }));
    expect(r1.status).toBe(201);

    const r2 = await app.fetch(connectReq({ sessionId: "s2", deviceId: "till-2" }));
    expect(r2.status).toBe(409);

    const delRes = await app.fetch(new Request("http://local/sessions/s1", { method: "DELETE", headers: ADMIN }));
    expect(delRes.status).toBe(204);

    const r3 = await app.fetch(connectReq({ sessionId: "s2", deviceId: "till-2" }));
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
    await app.fetch(connectReq({ sessionId: "s1", deviceId: "till-1", deviceLabel: "Front till" }));
    await app.fetch(connectReq({ sessionId: "s2", deviceId: "till-2", deviceLabel: "Back office" }));

    const res = await app.fetch(new Request("http://local/sessions", { headers: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seats: number;
      connected: number;
      sessions: Array<{ sessionId: string; deviceLabel: string }>;
    };
    expect(body.seats).toBe(3);
    expect(body.connected).toBe(2);
    expect(body.sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  it("rejects a malformed connect body with 400 before touching the registry", async () => {
    const { app, registry } = buildApp({ seats: 2, licensed: true });
    const res = await app.fetch(connectReq({ deviceId: "till-1" })); // missing sessionId
    expect(res.status).toBe(400);
    expect(registry.connectedCount).toBe(0);
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
    registry.connect({ sessionId: "s1", deviceId: "till-1", deviceLabel: "كاشير ١" });
    const cashier = { "x-permissions": "sales.invoice.view" };

    const list = await app.fetch(new Request("http://local/sessions", { headers: cashier }));
    const disconnect = await app.fetch(
      new Request("http://local/sessions/s1", { method: "DELETE", headers: cashier }),
    );

    expect(list.status).toBe(403);
    expect(disconnect.status).toBe(403);
    // And the refusal did not free the seat — a 403 that still disconnected
    // the till would be the same denial of service with a different number.
    expect(registry.list()).toHaveLength(1);
  });

  it("still lets an admin list and disconnect (the negative control)", async () => {
    const { app, registry } = buildApp({ seats: 2, licensed: true });
    registry.connect({ sessionId: "s1", deviceId: "till-1", deviceLabel: "كاشير ١" });

    const list = await app.fetch(new Request("http://local/sessions", { headers: ADMIN }));
    expect(list.status).toBe(200);

    const disconnect = await app.fetch(
      new Request("http://local/sessions/s1", { method: "DELETE", headers: ADMIN }),
    );
    expect(disconnect.status).toBe(204);
    expect(registry.list()).toHaveLength(0);
  });
});
