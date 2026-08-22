import type { Context, MiddlewareHandler } from "hono";
import { ALL_SCOPE, can, createAuthContext, type AuthContext } from "@mezan/domain";

/** Resolves the calling {@link AuthContext} for one request. */
export type AuthContextResolver = (c: Context) => AuthContext | Promise<AuthContext>;

/**
 * Default resolver for the spike editions: reads the effective permission set
 * straight off headers (`x-permissions`: comma-separated codes, `"*"` for a
 * tenant admin; `x-branch-scope` / `x-warehouse-scope`: comma-separated ids or
 * `"*"` for all). Real cloud/desktop editions swap this for one that derives
 * the context from the JWT claims or the local user store — the permission
 * gate itself only depends on the `AuthContext` shape (docs/plan.md §3.3).
 */
export function headerAuthContextResolver(c: Context): AuthContext {
  const permissions = (c.req.header("x-permissions") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const branchHeader = c.req.header("x-branch-scope");
  const warehouseHeader = c.req.header("x-warehouse-scope");
  return createAuthContext({
    userId: c.req.header("x-user-id") ?? "anonymous",
    permissions,
    branchScope: !branchHeader || branchHeader === "*" ? ALL_SCOPE : branchHeader.split(","),
    warehouseScope: !warehouseHeader || warehouseHeader === "*" ? ALL_SCOPE : warehouseHeader.split(","),
  });
}

const AUTH_CONTEXT_KEY = "authContext";

/**
 * Builds a permission-gate factory bound to one {@link AuthContextResolver}.
 * Mirrors `createModuleGate`'s shape (./module-gate.ts) but checks a specific
 * permission code via the domain's `can()` instead of module entitlement.
 *
 *   const gate = createPermissionGate(headerAuthContextResolver);
 *   app.get("/accounts", gate("accounting.coa.view"), handler);
 */
export function createPermissionGate(resolveAuthContext: AuthContextResolver) {
  return function gate(permission: string): MiddlewareHandler {
    return async function permissionGate(c, next) {
      const ctx = await resolveAuthContext(c);
      if (!can(ctx, permission)) {
        return c.json(
          {
            error: "PERMISSION_DENIED",
            permission,
            message: `Missing permission '${permission}'.`,
          },
          403,
        );
      }
      c.set(AUTH_CONTEXT_KEY, ctx);
      await next();
    };
  };
}

/** Reads the {@link AuthContext} a `createPermissionGate` middleware stashed on the request. */
export function getAuthContext(c: Context): AuthContext | undefined {
  return c.get(AUTH_CONTEXT_KEY) as AuthContext | undefined;
}
