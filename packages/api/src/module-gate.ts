import type { Context, MiddlewareHandler } from "hono";
import { hasModule, MODULES, type Entitlements } from "@mezan/domain";

declare module "hono" {
  interface ContextVariableMap {
    entitlements?: Entitlements;
  }
}

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
 * Binds the request's entitlements onto the Hono context, once, for every
 * permission gate below it to read (`permission-gate.ts`). Mirrors
 * `permissionRefusalReporting`'s shape: mounted once by `createApp`, and the
 * only way `c.get("entitlements")` is ever populated.
 *
 * Sets nothing when the resolver has nothing to say — a desktop app or a unit
 * test that builds routes directly never mounts this, and the permission
 * gates treat an absent binding as "no module check", not as a refusal.
 */
export function entitlementsBinding(resolve: EntitlementsResolver): MiddlewareHandler {
  return async function bindEntitlements(c, next) {
    const entitlements = await resolve(c);
    if (entitlements) c.set("entitlements", entitlements);
    await next();
  };
}

/** The 403 body a permission gate answers with when its permission's module isn't licensed. */
export function moduleRefusal(moduleId: string): { error: "MODULE_NOT_LICENSED"; module: string; message: string } {
  const labelAr = MODULES.find((m) => m.id === moduleId)?.labelAr ?? moduleId;
  return {
    error: "MODULE_NOT_LICENSED",
    module: moduleId,
    message: `وحدة ${labelAr} غير مفعّلة في باقتكم`,
  };
}

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
