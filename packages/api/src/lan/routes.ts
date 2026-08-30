import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  hasFeature,
  LAN_MULTI_TILL_FEATURE,
  SeatLimitExceededError,
  UserSeatLimitExceededError,
  DeviceSessionNotFoundError,
  type SeatSessionRegistry,
} from "@mezan/domain";
import { connectDeviceRequestSchema } from "@mezan/contracts";
import {
  createAuthenticatedGate,
  createPermissionGate,
  callerUserId,
  type AuthContextResolver,
} from "../permission-gate.js";
import { readSessionToken, type SessionRegistry } from "../session-auth.js";
import { createLanGate, type EntitlementsResolver, type LanGateVariables } from "./gate.js";

export interface LanRoutesOptions {
  readonly resolveEntitlements: EntitlementsResolver;
  readonly registry: SeatSessionRegistry;
  /** SSE keep-alive interval in ms (default 15s). Overridable so tests don't wait. */
  readonly sseHeartbeatMs?: number;
  /**
   * Who the caller is. Required, not optional-with-a-default: these routes are
   * the ones reached over a LAN socket, and a resolver that reads the caller's
   * own `x-permissions` header is the single thing that must never run there.
   */
  readonly resolveAuthContext: AuthContextResolver;
  /**
   * The AUTH session registry (../session-auth.ts), so a device disconnect can
   * revoke the bearer token that device connected with — not just the seat.
   * Optional so callers that don't wire real sessions (older desktop builds,
   * unit tests) still get seat enforcement; without it, `DELETE
   * /sessions/:id` frees the seat but the till's token stays live (PR #54
   * review finding #3: "disconnect is cosmetic — it frees a number, not a
   * connection").
   */
  readonly sessions?: SessionRegistry;
}

/** One `disconnected`/`connected`/`ping` push to every open `/lan/events` stream. */
type LanBroadcast = (event: string, data: unknown) => Promise<void>;

/**
 * LAN multi-till routes — mounted at `/lan` on the shared Hono app (both the
 * IPC mount and the LAN-socket mount, per docs/archive/plan.md §2.2's "one HTTP app,
 * two mount points"). Session-level seat enforcement lives in the injected
 * `SeatSessionRegistry` (@mezan/domain); this layer validates, keeps the
 * registry's cap in sync with the freshly-resolved `entitlements.seats` on
 * every gated call (so a re-verified license takes effect immediately, with
 * no separate "seats" config to drift out of sync), maps domain errors to
 * HTTP status, and serializes.
 *
 *   GET    /status          — whether LAN mode is licensed + current seat usage.
 *                              Not LICENSE-gated (it is the one endpoint an
 *                              unlicensed client needs to learn WHY it can't
 *                              connect, rather than getting an opaque 403), but
 *                              it still needs a session: seat occupancy is a
 *                              fact about the shop, not a public one.
 *   GET    /sessions        — connected-devices list (admin panel data source)
 *   POST   /sessions        — connect a device; idempotent per (account, deviceId)
 *   DELETE /sessions/:id    — disconnect a device (frees its seat, revokes its
 *                              auth session when one is wired, and pushes a
 *                              `disconnected` SSE event; also the admin
 *                              panel's "disconnect" action)
 *   GET    /events          — SSE keep-alive stream (docs/archive/plan.md §2.6: tills
 *                              connect over http+SSE)
 */
export function createLanRoutes(options: LanRoutesOptions) {
  const { registry } = options;
  const app = new Hono<{ Variables: LanGateVariables }>();
  const licensedGate = createLanGate(options.resolveEntitlements);
  const resolveAuth = options.resolveAuthContext;
  const permission = createPermissionGate(resolveAuth);

  /**
   * A LICENSE IS NOT A CREDENTIAL. These routes were gated on the
   * `lan.multi_till` feature flag and nothing else, and they are the routes
   * that are, by design, reachable from every device on the shop wifi: any of
   * them could enumerate the connected tills, burn every seat so no real till
   * could connect, or disconnect the counter mid-sale — with no account.
   *
   * Every route now needs a session. Connecting a device is something any
   * signed-in user's till does for itself; enumerating or disconnecting OTHER
   * people's devices is administration, and gated as such.
   */
  const signedIn = createAuthenticatedGate(resolveAuth);

  /**
   * Which bearer token connected each seat, so a disconnect can revoke that
   * EXACT token rather than `sessions.revokeUser` (which would also sign out
   * every other device the same account is legitimately using elsewhere).
   * Pruned against the registry's own list on every connect/list so a seat
   * the registry reaped for going idle doesn't leak its entry here forever.
   */
  const tokenBySessionId = new Map<string, string>();

  function pruneTokens(live: readonly { sessionId: string }[]): void {
    const liveIds = new Set(live.map((s) => s.sessionId));
    for (const sessionId of tokenBySessionId.keys()) {
      if (!liveIds.has(sessionId)) tokenBySessionId.delete(sessionId);
    }
  }

  /** Every open `/lan/events` SSE stream, so a disconnect can push to all of them. */
  const subscribers = new Set<LanBroadcast>();

  function broadcast(event: string, data: unknown): void {
    for (const emit of subscribers) {
      // A subscriber whose write fails is a stream that already dropped; its
      // own abort handling removes it from `subscribers`, so this is silent.
      void emit(event, data).catch(() => {});
    }
  }

  app.get("/status", signedIn, async (c) => {
    const entitlements = await options.resolveEntitlements(c);
    const licensed = !!entitlements && hasFeature(entitlements, LAN_MULTI_TILL_FEATURE);
    return c.json({
      licensed,
      seats: licensed ? entitlements!.seats : 0,
      connected: registry.connectedCount,
    });
  });

  app.get("/sessions", licensedGate, permission("admin.devices.view"), (c) => {
    registry.setSeats(c.get("lanEntitlements").seats);
    const sessions = registry.list();
    pruneTokens(sessions);
    return c.json({
      seats: registry.seats,
      connected: registry.connectedCount,
      sessions,
    });
  });

  app.post("/sessions", licensedGate, signedIn, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = connectDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    // The seat's identity is the AUTHENTICATED caller, never anything the
    // body names — see @mezan/domain's session-registry.ts module doc for
    // the seat-exhaustion defect this closes.
    const userId = callerUserId(c);
    if (!userId) {
      return c.json(
        { error: "SESSION_EXPIRED", message: "انتهت الجلسة. سجّل الدخول من جديد." },
        401,
      );
    }

    registry.setSeats(c.get("lanEntitlements").seats);
    try {
      const session = registry.connect({
        userId,
        deviceId: parsed.data.deviceId,
        deviceLabel: parsed.data.deviceLabel,
      });
      const token = readSessionToken(c);
      if (token) tokenBySessionId.set(session.sessionId, token);
      pruneTokens(registry.list());
      return c.json(session, 201);
    } catch (err) {
      if (err instanceof SeatLimitExceededError) {
        return c.json(
          {
            error: err.code,
            seats: err.seats,
            connected: err.connected,
            message: err.message,
          },
          409,
        );
      }
      if (err instanceof UserSeatLimitExceededError) {
        return c.json(
          {
            error: err.code,
            maxSeatsPerUser: err.maxSeatsPerUser,
            message: err.message,
          },
          409,
        );
      }
      throw err;
    }
  });

  app.delete("/sessions/:sessionId", licensedGate, permission("admin.devices.manage"), (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      registry.disconnect(sessionId);
      const token = tokenBySessionId.get(sessionId);
      tokenBySessionId.delete(sessionId);
      // Freeing the SEAT NUMBER was the whole fix before — the device kept
      // its bearer token and kept working. Revoking the exact token it
      // connected with is what makes the disconnect real (PR #54 review
      // finding #3).
      if (token && options.sessions) options.sessions.revoke(token);
      broadcast("disconnected", { sessionId });
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof DeviceSessionNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      throw err;
    }
  });

  app.get("/events", licensedGate, signedIn, (c) => {
    const heartbeatMs = options.sseHeartbeatMs ?? 15_000;
    return streamSSE(c, async (stream) => {
      const signal = c.req.raw.signal;
      const emit: LanBroadcast = async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(emit);
      try {
        await emit("connected", { seats: registry.seats, connected: registry.connectedCount });
        while (!signal.aborted) {
          await stream.sleep(heartbeatMs);
          if (signal.aborted) break;
          await emit("ping", { at: Date.now(), connected: registry.connectedCount });
        }
      } finally {
        subscribers.delete(emit);
      }
    });
  });

  return app;
}
