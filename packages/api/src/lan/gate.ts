import type { MiddlewareHandler } from "hono";
import { hasFeature, LAN_MULTI_TILL_FEATURE, type Entitlements } from "@mezan/domain";
import type { EntitlementsResolver } from "../module-gate.js";

export type { EntitlementsResolver };

/** Hono context variables the LAN gate stashes for downstream handlers. */
export interface LanGateVariables {
  lanEntitlements: Entitlements;
}

/**
 * LAN gate middleware — rejects every gated `/lan/*` call with 403 unless the
 * current entitlements carry the `lan.multi_till` feature flag (docs/archive/plan.md
 * §6.3.3: "gate it behind a license flag"). Same shape as `createModuleGate`
 * in ../module-gate.ts (and reuses its `EntitlementsResolver` type), but
 * reads a feature flag rather than a module, since LAN serving is a
 * capability layered under module activation, not a module of its own.
 *
 * On success it stashes the resolved `Entitlements` on the context (as
 * `lanEntitlements`) so downstream handlers read the SAME resolution used for
 * the gate check — e.g. to keep the seat registry's cap in lock-step with
 * `entitlements.seats` rather than re-resolving (and risking drift) per route.
 */
export function createLanGate(
  resolveEntitlements: EntitlementsResolver,
): MiddlewareHandler<{ Variables: LanGateVariables }> {
  return async function lanGate(c, next) {
    const entitlements = await resolveEntitlements(c);
    if (!entitlements || !hasFeature(entitlements, LAN_MULTI_TILL_FEATURE)) {
      return c.json(
        {
          error: "LAN_MODE_NOT_LICENSED",
          feature: LAN_MULTI_TILL_FEATURE,
          message: "LAN multi-till mode is not enabled for this license.",
        },
        403,
      );
    }
    c.set("lanEntitlements", entitlements);
    await next();
  };
}
