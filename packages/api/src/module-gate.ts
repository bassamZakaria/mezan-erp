import type { Context, MiddlewareHandler } from "hono";
import { hasModule, type Entitlements } from "@mezan/domain";

/**
 * Module-gate middleware — rejects calls into a module the current
 * entitlements do not license, with 403 (docs/archive/plan.md §2.5, §5.2).
 *
 * The domain owns the actual capability check (`hasModule`); this is only the
 * transport binding. The entitlements themselves are resolved per request via
 * the injected `resolveEntitlements` — cloud pulls them off the JWT/tenant,
 * desktop off the verified license — so the API layer never assumes a source.
 */
export type EntitlementsResolver = (
  c: Context,
) => Entitlements | null | undefined | Promise<Entitlements | null | undefined>;

/**
 * Builds a gate factory bound to one entitlements resolver. Apply the returned
 * `gate(moduleId)` to any route or router that belongs to a licensable module.
 *
 *   const gate = createModuleGate((c) => c.get("entitlements"));
 *   app.use("/pos/*", gate("pos"));
 */
export function createModuleGate(resolveEntitlements: EntitlementsResolver) {
  return function gate(moduleId: string): MiddlewareHandler {
    return async function moduleGate(c, next) {
      const entitlements = await resolveEntitlements(c);
      if (!entitlements || !hasModule(entitlements, moduleId)) {
        return c.json(
          {
            error: "MODULE_NOT_LICENSED",
            module: moduleId,
            message: `Module '${moduleId}' is not activated for this license.`,
          },
          403,
        );
      }
      await next();
    };
  };
}
