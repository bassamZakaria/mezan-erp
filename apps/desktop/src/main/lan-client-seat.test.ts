import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanClientError, withSeatClaim, type LanClientResponse, type LanForward } from "./lan-client.js";
import type { ClientConfig } from "./client-config.js";

/**
 * Signing in is not connecting, and a client that does only the first renders
 * the whole shell over a host that refuses every screen. Both live two-machine
 * runs hit this, in two different ways — a fresh login and a resumed session —
 * so both paths are asserted here.
 */
const CONFIG: ClientConfig = {
  hostUrl: "https://192.168.1.7:4173",
  fingerprintSha256:
    "3D:9A:1F:04:B7:22:CE:65:80:11:AA:5E:F3:47:9C:D2:16:8B:70:E4:53:C1:0F:6A:29:BD:84:37:52:EE:C8:91",
  deviceId: "DEVICE-STABLE",
  deviceLabel: "مكتب المحاسب",
};

interface Call {
  readonly path: string;
  readonly method: string;
  readonly body?: string;
  readonly auth?: string;
}

/**
 * A host that behaves the way the real one does: everything outside the public
 * list is 404 until this device holds a seat.
 */
function fakeHost(options: { seatsAvailable?: boolean } = {}) {
  const calls: Call[] = [];
  let seated = false;

  const forward: LanForward = async (pathAndQuery, init = {}) => {
    const path = pathAndQuery.split("?")[0]!;
    calls.push({
      path: pathAndQuery,
      method: init.method ?? "GET",
      body: init.body,
      auth: init.headers?.["authorization"],
    });

    const reply = (status: number, body: unknown): LanClientResponse => ({
      status,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (path === "/auth/login") return reply(200, { userId: "USER-ADMIN", token: "TOKEN-1" });
    if (path === "/auth/logout") return reply(200, { ok: true });
    if (path === "/lan/sessions" && (init.method ?? "GET") === "POST") {
      if (options.seatsAvailable === false) return reply(409, { error: "SEAT_LIMIT_EXCEEDED" });
      seated = true;
      return reply(201, { sessionId: "USER-ADMIN::DEVICE-STABLE", userId: "USER-ADMIN" });
    }
    if (path.startsWith("/lan/sessions/") && init.method === "DELETE") {
      seated = false;
      return reply(200, { ok: true });
    }
    // The socket's own refusal carries the header; a 404 the APP produced (an id
    // that is not there) does not. See lan-host.ts.
    const refused = (): LanClientResponse => ({
      status: 404,
      headers: { "content-type": "text/plain", "x-mezan-lan-refused": "1" },
      body: "404 Not Found",
    });

    if (path === "/unknown-route") return refused();
    if (path === "/customers/GONE") return { status: 404, headers: {}, body: "not found" };
    return seated ? reply(200, [{ id: "ITEM-1" }]) : refused();
  };

  return {
    forward,
    calls,
    isSeated: () => seated,
    /** What `SeatSessionRegistry` does to a device it has not seen for 45s. */
    expireSeat: () => {
      seated = false;
    },
  };
}

describe("a client claims its seat as part of signing in", () => {
  it("takes a seat with its own stable device id straight after a successful login", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);

    const login = await client("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "a@b.c", pin: "123456" }),
    });

    expect(login.status).toBe(200);
    const seatCall = host.calls.find((c) => c.path === "/lan/sessions");
    expect(seatCall).toBeDefined();
    // The device id comes from client.json, never from the renderer: a
    // renderer-chosen id would burn a fresh seat on every launch.
    expect(JSON.parse(seatCall!.body!)).toEqual({
      deviceId: "DEVICE-STABLE",
      deviceLabel: "مكتب المحاسب",
    });
    expect(seatCall!.auth).toBe("Bearer TOKEN-1");

    expect((await client("/items")).status).toBe(200);
  });

  /**
   * "Logged in but seatless" is a state with no screen: the shell renders and
   * every page says «الصفحة غير موجودة». The refusal has to arrive as the login
   * result, which the renderer already knows how to show.
   */
  it("turns a full house into a refused login, not a login into an empty app", async () => {
    const host = fakeHost({ seatsAvailable: false });
    const client = withSeatClaim(host.forward, CONFIG);

    const login = await client("/auth/login", { method: "POST", body: "{}" });

    expect(login.status).toBe(403);
    expect(JSON.parse(login.body)).toMatchObject({ error: "NO_SEAT" });
    expect(login.body).toContain("مقاعد");
  });

  /**
   * The morning-after case. The renderer keeps its token across restarts, so a
   * reopened client posts no login at all — it goes straight to the dashboard
   * holding yesterday's token and no seat.
   */
  it("claims a seat and retries when a resumed session's first request is refused", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);

    const res = await client("/items", { headers: { authorization: "Bearer TOKEN-FROM-YESTERDAY" } });

    expect(res.status).toBe(200);
    expect(host.calls.map((c) => c.path)).toEqual(["/items", "/lan/sessions", "/items"]);
  });

  /**
   * The one that took a live run to find. The host reaps a seat whose device has
   * not been seen for 45 seconds, so a client that logs in and then reads
   * quietly loses its seat mid-session: the dashboard loads, and a minute later
   * every screen is empty again.
   *
   * A recovery guarded on "do I believe I hold a seat" answers YES here — the
   * id is still in memory — and never re-claims. So the guard is the 404 itself.
   */
  it("re-claims a seat the host has since reaped, mid-session", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);
    await client("/auth/login", { method: "POST", body: "{}" });
    expect((await client("/items", { headers: { authorization: "Bearer TOKEN-1" } })).status).toBe(200);

    host.expireSeat();

    const afterReap = await client("/items", { headers: { authorization: "Bearer TOKEN-1" } });
    expect(afterReap.status).toBe(200);
    expect(host.isSeated()).toBe(true);
  });

  it("does not retry forever on a route the socket keeps refusing", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);

    const res = await client("/unknown-route", { headers: { authorization: "Bearer TOKEN-1" } });

    // One claim, one retry, and then it stops — and it says "not authorised"
    // rather than "not there", because the socket refused it, twice.
    expect(res.status).toBe(401);
    expect(host.calls.map((c) => c.path)).toEqual(["/unknown-route", "/lan/sessions", "/unknown-route"]);
  });

  /**
   * The distinction the `x-mezan-lan-refused` header exists for. A document that
   * is genuinely gone must still read as gone — mapping every 404 to 401 would
   * turn "this customer was deleted" into "your session expired".
   */
  it("passes an app 404 straight through — a missing document is not a refusal", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);
    await client("/auth/login", { method: "POST", body: "{}" });

    const res = await client("/customers/GONE", { headers: { authorization: "Bearer TOKEN-1" } });

    expect(res.status).toBe(404);
    // No seat churn: nothing about a missing record says anything about a seat.
    expect(host.calls.filter((c) => c.path === "/lan/sessions")).toHaveLength(1);
  });

  /**
   * The client's boot sequence fires before the renderer restores its stored
   * session. On the host those unauthenticated calls get 401 and the shell shows
   * the login screen; over the LAN socket they got 404, and the shell read that
   * as "no such screen" — rendering the whole navigation over an empty app with
   * «الصفحة غير موجودة» in the content area, against a healthy host.
   */
  it("answers an unauthenticated boot request 401, the way the host would", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);

    expect((await client("/settings")).status).toBe(401);
    // Nothing to claim a seat with, so it does not try.
    expect(host.calls.map((c) => c.path)).toEqual(["/settings"]);
  });

  /**
   * Freeing the seat BEFORE the token dies. Afterwards the host cannot
   * attribute the disconnect, and the seat sits occupied until the stale-session
   * reaper gets to it — on a two-seat licence that is the whole shop.
   */
  it("releases its seat on logout, and does so before the session is revoked", async () => {
    const host = fakeHost();
    const client = withSeatClaim(host.forward, CONFIG);
    await client("/auth/login", { method: "POST", body: "{}" });

    await client("/auth/logout", { method: "POST", headers: { authorization: "Bearer TOKEN-1" } });

    const order = host.calls.map((c) => `${c.method} ${c.path}`);
    expect(order).toContain("DELETE /lan/sessions/USER-ADMIN%3A%3ADEVICE-STABLE");
    expect(order.indexOf("DELETE /lan/sessions/USER-ADMIN%3A%3ADEVICE-STABLE")).toBeLessThan(
      order.indexOf("POST /auth/logout"),
    );
    expect(host.isSeated()).toBe(false);
  });
});

/**
 * GUARDS U-10. `/health` answered `{ok:true}` and the client compared nothing,
 * so a till left on an old build after the host was updated kept working
 * against a schema it did not match — and the first symptom was wrong data
 * rather than a refusal. The screen is the LAN error screen; this emits the
 * distinct `VERSION_MISMATCH` code it renders.
 */
describe("the host must be running this build", () => {
  const localVersion = process.env["MEZAN_APP_VERSION"];
  const localSchema = process.env["MEZAN_SCHEMA_VERSION"];

  function hostOn(health: unknown): { forward: LanForward; paths: string[] } {
    const paths: string[] = [];
    const forward: LanForward = async (pathAndQuery, init = {}) => {
      const path = pathAndQuery.split("?")[0]!;
      paths.push(path);
      if (path === "/health") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(health),
        };
      }
      if (path === "/auth/login") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "TOKEN-1" }),
        };
      }
      return { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    };
    return { forward, paths };
  }

  beforeEach(() => {
    process.env["MEZAN_APP_VERSION"] = "1.4.0";
    process.env["MEZAN_SCHEMA_VERSION"] = "1";
  });

  afterEach(() => {
    if (localVersion === undefined) delete process.env["MEZAN_APP_VERSION"];
    else process.env["MEZAN_APP_VERSION"] = localVersion;
    if (localSchema === undefined) delete process.env["MEZAN_SCHEMA_VERSION"];
    else process.env["MEZAN_SCHEMA_VERSION"] = localSchema;
  });

  it("passes through when host and client agree", async () => {
    const host = hostOn({ ok: true, version: "1.4.0", schemaVersion: 1 });
    const client = withSeatClaim(host.forward, CONFIG);

    await expect(client("/settings", {})).resolves.toBeTruthy();
    expect(host.paths[0]).toBe("/health");
  });

  it("refuses with VERSION_MISMATCH when the host runs a different build", async () => {
    const host = hostOn({ ok: true, version: "1.5.0", schemaVersion: 2 });
    const client = withSeatClaim(host.forward, CONFIG);

    const failure = await client("/settings", {}).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LanClientError);
    expect((failure as LanClientError).code).toBe("VERSION_MISMATCH");
    expect((failure as LanClientError).host).toBe(CONFIG.hostUrl);
  });

  it("checks once per launch, not once per request", async () => {
    const host = hostOn({ ok: true, version: "1.4.0", schemaVersion: 1 });
    const client = withSeatClaim(host.forward, CONFIG);

    await client("/settings", {});
    await client("/branches", {});

    expect(host.paths.filter((p) => p === "/health")).toHaveLength(1);
  });

  it("does not block against an older host that cannot answer the question", async () => {
    // `{ok:true}` and nothing else: a real skew, but naming "0.0.0" as the
    // host's version would send a consultant after the wrong machine.
    const host = hostOn({ ok: true });
    const client = withSeatClaim(host.forward, CONFIG);

    await expect(client("/settings", {})).resolves.toBeTruthy();
  });

  it("does not block when this process does not know its own version", async () => {
    delete process.env["MEZAN_APP_VERSION"];
    const host = hostOn({ ok: true, version: "9.9.9", schemaVersion: 7 });
    const client = withSeatClaim(host.forward, CONFIG);

    await expect(client("/settings", {})).resolves.toBeTruthy();
  });
});
