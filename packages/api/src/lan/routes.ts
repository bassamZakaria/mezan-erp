import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  can,
  hasFeature,
  isScopeRestricted,
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
  getAuthContext,
  type AuthContextResolver,
} from "../permission-gate.js";

const DEVICE_REGISTER_PERMISSION = "admin.devices.view";
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

/** Concurrent `/lan/events` streams one session may hold. See `GET /events`. */
const MAX_STREAMS_PER_SESSION = 3;

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

  interface Subscriber {
    readonly emit: LanBroadcast;
    readonly userId: string | undefined;
    readonly keepsDeviceRegister: boolean;
  }

  /** Every open `/lan/events` SSE stream. */
  const subscribers = new Set<Subscriber>();

  /** How many streams each session currently holds. See `GET /events`. */
  const streamsByToken = new Map<string, number>();

  /**
   * SECURITY: a seat's event goes to the till that holds the seat and to
   * whoever may read the device register, which is the company's — not to
   * every signed-in stream, which told each till the others' session ids.
   */
  function tellSeat(seatUserId: string | undefined, event: string, data: unknown): void {
    for (const subscriber of subscribers) {
      if (!subscriber.keepsDeviceRegister && (seatUserId === undefined || subscriber.userId !== seatUserId)) continue;
      // A subscriber whose write fails is a stream that already dropped; its
      // own abort handling removes it from `subscribers`, so this is silent.
      void subscriber.emit(event, data).catch(() => {});
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

  app.get("/sessions", licensedGate, permission(DEVICE_REGISTER_PERMISSION), (c) => {
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
        appVersion: parsed.data.appVersion,
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
            message: `اكتمل عدد الأجهزة التي يسمح بها الترخيص (${err.connected} من ${err.seats}). افصل جهازاً من «الأجهزة المتصلة» قبل توصيل جهاز آخر.`,
            messageEn: err.message,
          },
          409,
        );
      }
      if (err instanceof UserSeatLimitExceededError) {
        return c.json(
          {
            error: err.code,
            maxSeatsPerUser: err.maxSeatsPerUser,
            message: `هذا الحساب متصل بالفعل من ${err.maxSeatsPerUser} جهاز، وهو الحد الأقصى للحساب الواحد. افصل أحد أجهزته من «الأجهزة المتصلة» ثم أعد المحاولة، أو استخدم حساباً آخر على هذا الجهاز.`,
            messageEn: err.message,
          },
          409,
        );
      }
      throw err;
    }
  });

  app.delete("/sessions/:sessionId", licensedGate, permission("admin.devices.manage"), async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const seatUserId = registry.list().find((session) => session.sessionId === sessionId)?.userId;
      registry.disconnect(sessionId);
      const token = tokenBySessionId.get(sessionId);
      tokenBySessionId.delete(sessionId);
      // Freeing the SEAT NUMBER was the whole fix before — the device kept
      // its bearer token and kept working. Revoking the exact token it
      // connected with is what makes the disconnect real (PR #54 review
      // finding #3).
      if (token && options.sessions) await options.sessions.revoke(token);
      tellSeat(seatUserId, "disconnected", { sessionId });
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
    /**
     * ONE MACHINE HOLDING A THOUSAND OPEN STREAMS IS A DENIAL OF SERVICE, and
     * nothing counted them. Each subscriber is a live socket plus a heartbeat
     * timer on the host's single event loop — the same loop every SQLite call
     * in the product runs on — so a signed-in till looping `GET /lan/events`
     * takes the shop down without ever exceeding its seat or its permissions.
     *
     * Counted per SESSION rather than per address: a till legitimately opens
     * one stream and, briefly, two across a reconnect. Three is slack for a
     * reload racing its own teardown; a fourth is a loop.
     */
    // The bearer token where there is one, the resolved user otherwise: the
    // desktop's own in-process mount carries no `authorization` header, and a
    // cap that silently did not apply there would be a cap with a hole in the
    // shape of "run it from the host".
    const token = readSessionToken(c) ?? callerUserId(c);
    const held = token ? (streamsByToken.get(token) ?? 0) : 0;
    if (held >= MAX_STREAMS_PER_SESSION) {
      return c.json(
        {
          error: "TOO_MANY_STREAMS",
          message: "هذا الجهاز يفتح عدداً كبيراً من الاتصالات المباشرة. أعد تشغيل البرنامج على الجهاز.",
        },
        429,
      );
    }
    if (token) streamsByToken.set(token, held + 1);
    const ctx = getAuthContext(c);

    return streamSSE(c, async (stream) => {
      const signal = c.req.raw.signal;
      const emit: LanBroadcast = async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      const subscriber: Subscriber = {
        emit,
        userId: callerUserId(c),
        keepsDeviceRegister: ctx !== undefined && can(ctx, DEVICE_REGISTER_PERMISSION) && !isScopeRestricted(ctx),
      };
      subscribers.add(subscriber);
      try {
        await emit("connected", { seats: registry.seats, connected: registry.connectedCount });
        while (!signal.aborted) {
          await stream.sleep(heartbeatMs);
          if (signal.aborted) break;
          await emit("ping", { at: Date.now(), connected: registry.connectedCount });
        }
      } finally {
        subscribers.delete(subscriber);
        if (token) {
          // In `finally`, so a stream that died mid-write releases its slot
          // too. Counting up on open and down only on a clean close is how a
          // cap becomes a permanent lockout after one dropped wifi link.
          const remaining = (streamsByToken.get(token) ?? 1) - 1;
          if (remaining <= 0) streamsByToken.delete(token);
          else streamsByToken.set(token, remaining);
        }
      }
    });
  });

  return app;
}
