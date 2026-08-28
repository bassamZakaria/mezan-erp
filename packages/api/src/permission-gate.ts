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
/**
 * The refusal for a caller the server cannot identify.
 *
 * 401, not 403: the client's only correct response is to send the person back
 * to sign in, and it cannot know that from a 403 — which also means "you are
 * signed in and this particular thing is not yours". A screen that guesses
 * shows an empty list instead, which reads as data.
 */
function unauthenticated(c: Parameters<MiddlewareHandler>[0]) {
  return c.json(
    { error: "SESSION_EXPIRED", message: "انتهت الجلسة. سجّل الدخول من جديد." },
    401,
  );
}

export function createPermissionGate(resolveAuthContext: AuthContextResolver) {
  return function gate(permission: string): MiddlewareHandler {
    return async function permissionGate(c, next) {
      const ctx = await resolveAuthContext(c);
      if (!ctx.authenticated) return unauthenticated(c);
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

/**
 * A gate that passes when the caller holds ANY of the listed permissions.
 *
 * The catalog grants visibility in tiers — `.confirm` implies `.view_own`,
 * `.view_all` implies `.view` — and gating a read route on `.view` alone locked
 * out everyone whose grant was a different tier of the same permission: a user
 * who could confirm invoices could not open the list to find one (D31). The
 * route gates on the weakest tier that should see anything, then NARROWS.
 */
export function createAnyPermissionGate(resolveAuthContext: AuthContextResolver) {
  return function gateAny(...permissions: string[]): MiddlewareHandler {
    return async function anyPermissionGate(c, next) {
      const ctx = await resolveAuthContext(c);
      if (!ctx.authenticated) return unauthenticated(c);
      if (!permissions.some((permission) => can(ctx, permission))) {
        return c.json(
          {
            error: "PERMISSION_DENIED",
            permission: permissions[0],
            message: `Missing any of '${permissions.join("', '")}'.`,
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
 * The user this request is FROM, for stamping a document's actor and the
 * workflow gate's `submittedBy`.
 *
 * Read off the resolved context, never `x-user-id`. Recording an actor the
 * caller named makes the audit trail and the approval chain fiction: a clerk
 * could submit as somebody else and, holding the approver role, approve it.
 */
export function callerUserId(c: Context): string | undefined {
  const id = getAuthContext(c)?.userId;
  return id && id !== "anonymous" ? id : undefined;
}

/**
 * The custom roles the caller holds, for matching a workflow step's approver
 * role.
 *
 * Read off the RESOLVED context the gate stashed, never off `x-role-codes`.
 * The header form let any caller name any role, so the approval chain was a
 * suggestion: a clerk could send the finance manager's role code and approve
 * their own payment. A tenant admin (`"*"`) still satisfies every step.
 */
export function callerRoleCodes(c: Context): string[] {
  const ctx = getAuthContext(c);
  if (!ctx) return [];
  if (ctx.permissions.has("*")) return ["*"];
  return [...ctx.roleCodes];
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
