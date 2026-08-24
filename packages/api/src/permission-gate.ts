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

/**
 * The warehouses this request may see, or `undefined` for all of them.
 *
 * The shell's warehouse selector sends `x-warehouse-scope`, and
 * `headerAuthContextResolver` resolves it — but until this existed no list
 * route consulted it, so changing the selector relabelled the chrome and
 * changed nothing on screen. A list route must narrow by this; it must never
 * widen past it.
 */
export function warehouseScopeOf(c: Context): readonly string[] | undefined {
  const scope = getAuthContext(c)?.warehouseScope;
  return !scope || scope === ALL_SCOPE ? undefined : scope;
}

/** The branches this request may see, or `undefined` for all of them. See {@link warehouseScopeOf}. */
export function branchScopeOf(c: Context): readonly string[] | undefined {
  const scope = getAuthContext(c)?.branchScope;
  return !scope || scope === ALL_SCOPE ? undefined : scope;
}

/** Narrows `rows` to the scope, by whichever key carries the id. Returns `rows` untouched when unscoped. */
export function withinScope<T>(rows: readonly T[], scope: readonly string[] | undefined, idOf: (row: T) => string | null | undefined): readonly T[] {
  if (!scope) return rows;
  const allowed = new Set(scope);
  return rows.filter((row) => {
    const id = idOf(row);
    // A row with no id on the scoping dimension is not attributable, so it
    // stays visible rather than silently vanishing under a narrowed scope.
    return id == null || allowed.has(id);
  });
}
