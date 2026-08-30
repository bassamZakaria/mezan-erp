import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { requestOrigin } from "./request-origin.js";

/**
 * The whole value of this function is that it CANNOT be written by a client.
 * Every earlier attempt in this codebase to answer a security question from a
 * header — `x-permissions`, `x-user-id`, `x-role-codes` — turned out to be the
 * client answering it for itself, and the login throttle now keys on this to
 * decide whether a failed attempt was remote or from the host's own console.
 */
function ctx(env: unknown): Context {
  return { env } as unknown as Context;
}

describe("requestOrigin", () => {
  it("reports the remote address when the request arrived over a socket", () => {
    expect(requestOrigin(ctx({ incoming: { socket: { remoteAddress: "192.168.1.55" } } }))).toBe("192.168.1.55");
  });

  it("reports nothing for the in-process IPC mount, which has no env at all", () => {
    // The desktop renderer calls `app.fetch(request)` with no second argument,
    // so there is no `incoming` and no socket — which is exactly what makes
    // the host's own console immune to a lockout somebody triggered over wifi.
    expect(requestOrigin(ctx(undefined))).toBeNull();
  });

  it("reports nothing when the socket exists but has no address yet", () => {
    expect(requestOrigin(ctx({ incoming: { socket: {} } }))).toBeNull();
    expect(requestOrigin(ctx({ incoming: {} }))).toBeNull();
    expect(requestOrigin(ctx({}))).toBeNull();
  });

  it("treats an empty address as no address, rather than as the key \"\"", () => {
    // An empty string would collapse every remote caller onto one throttle key
    // and hand them each other's lockouts.
    expect(requestOrigin(ctx({ incoming: { socket: { remoteAddress: "" } } }))).toBeNull();
  });

  it("ignores a non-string the runtime should never produce", () => {
    expect(requestOrigin(ctx({ incoming: { socket: { remoteAddress: 42 } } }))).toBeNull();
  });
});
