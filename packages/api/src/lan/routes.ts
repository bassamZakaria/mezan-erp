import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  hasFeature,
  LAN_MULTI_TILL_FEATURE,
  SeatLimitExceededError,
  DeviceSessionNotFoundError,
  type SeatSessionRegistry,
} from "@mezan/domain";
import { connectDeviceRequestSchema } from "@mezan/contracts";
import { createLanGate, type EntitlementsResolver, type LanGateVariables } from "./gate.js";

export interface LanRoutesOptions {
  readonly resolveEntitlements: EntitlementsResolver;
  readonly registry: SeatSessionRegistry;
  /** SSE keep-alive interval in ms (default 15s). Overridable so tests don't wait. */
  readonly sseHeartbeatMs?: number;
}

/**
 * LAN multi-till routes — mounted at `/lan` on the shared Hono app (both the
 * IPC mount and the LAN-socket mount, per docs/plan.md §2.2's "one HTTP app,
 * two mount points"). Session-level seat enforcement lives in the injected
 * `SeatSessionRegistry` (@mezan/domain); this layer validates, keeps the
 * registry's cap in sync with the freshly-resolved `entitlements.seats` on
 * every gated call (so a re-verified license takes effect immediately, with
 * no separate "seats" config to drift out of sync), maps domain errors to
 * HTTP status, and serializes.
 *
 *   GET    /status          — whether LAN mode is licensed + current seat usage
 *                              (NOT gated: this is the one endpoint an
 *                              unlicensed client needs to learn WHY it can't
 *                              connect, rather than getting an opaque 403).
 *   GET    /sessions        — connected-devices list (admin panel data source)
 *   POST   /sessions        — connect a device; idempotent by sessionId
 *   DELETE /sessions/:id    — disconnect a device (frees its seat; also the
 *                              admin panel's "disconnect" action)
 *   GET    /events          — SSE keep-alive stream (docs/plan.md §2.6: tills
 *                              connect over http+SSE)
 */
export function createLanRoutes(options: LanRoutesOptions) {
  const { registry } = options;
  const app = new Hono<{ Variables: LanGateVariables }>();
  const gate = createLanGate(options.resolveEntitlements);

  app.get("/status", async (c) => {
    const entitlements = await options.resolveEntitlements(c);
    const licensed = !!entitlements && hasFeature(entitlements, LAN_MULTI_TILL_FEATURE);
    return c.json({
      licensed,
      seats: licensed ? entitlements!.seats : 0,
      connected: registry.connectedCount,
    });
  });

  app.get("/sessions", gate, (c) => {
    registry.setSeats(c.get("lanEntitlements").seats);
    return c.json({
      seats: registry.seats,
      connected: registry.connectedCount,
      sessions: registry.list(),
    });
  });

  app.post("/sessions", gate, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = connectDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    registry.setSeats(c.get("lanEntitlements").seats);
    try {
      const session = registry.connect(parsed.data);
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
      throw err;
    }
  });

  app.delete("/sessions/:sessionId", gate, (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      registry.disconnect(sessionId);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof DeviceSessionNotFoundError) {
        return c.json({ error: err.code, message: err.message }, 404);
      }
      throw err;
    }
  });

  app.get("/events", gate, (c) => {
    const heartbeatMs = options.sseHeartbeatMs ?? 15_000;
    return streamSSE(c, async (stream) => {
      const signal = c.req.raw.signal;
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ seats: registry.seats, connected: registry.connectedCount }),
      });
      while (!signal.aborted) {
        await stream.sleep(heartbeatMs);
        if (signal.aborted) break;
        await stream.writeSSE({
          event: "ping",
          data: JSON.stringify({ at: Date.now(), connected: registry.connectedCount }),
        });
      }
    });
  });

  return app;
}
