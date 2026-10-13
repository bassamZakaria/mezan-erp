import type { Context, MiddlewareHandler } from "hono";
import {
  ALL_SCOPE,
  can,
  createAuthContext,
  entitlementModuleOf,
  getPermission,
  isModuleLicensed,
  PermissionLabelLocale,
  permissionHumanLabel,
  type AuthContext,
} from "@mezan/domain";
import { moduleRefusal, readOnlyModuleOutcome } from "./module-gate.js";
import { SESSION_ENDED_HEADER, SessionEnded, sessionWasDisplaced } from "./session-ended.js";

/** Resolves the calling {@link AuthContext} for one request. */
export type AuthContextResolver = (c: Context) => AuthContext | Promise<AuthContext>;

/**
 * A real install, as opposed to a dev server or a test process.
 *
 * Read per call rather than captured at module load: the desktop main process
 * sets `MEZAN_PACKAGED` after import (main/index.ts), so a value snapshotted at
 * import time would be the wrong one on exactly the edition this guards.
 */
export function isProductionRuntime(): boolean {
  return process.env["MEZAN_PACKAGED"] === "1" || process.env["NODE_ENV"] === "production";
}

/**
 * THE CLIENT DECLARES ITS OWN AUTHORITY. Development and test only.
 *
 * Reads the effective permission set straight off headers (`x-permissions`:
 * comma-separated codes, `"*"` for a tenant admin; `x-branch-scope` /
 * `x-warehouse-scope`: comma-separated ids or `"*"` for all), which means any
 * caller that can write a header is a tenant admin.
 *
 * It is deliberately NOT the default of any route factory any more. It was,
 * and one composition that forgot to pass a real resolver (the desktop shell,
 * the single edition that binds a LAN socket) silently reverted every route on
 * the shop wifi to "send `x-permissions: *` and you are the owner" — defect S9.
 * A default that fails open is a hole with a countdown on it, so the parameter
 * is required everywhere and this function is named to be unreachable by
 * autocomplete for anyone who is not looking for it.
 *
 * On a packaged or production build it refuses to resolve anything at all.
 */
export function insecureHeaderAuthContextResolver(c: Context): AuthContext {
  if (isProductionRuntime()) {
    throw new Error(
      "insecureHeaderAuthContextResolver was reached on a production/packaged build. " +
        "Every route must be mounted with a session-backed AuthContextResolver.",
    );
  }
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
 * Where a refused request is reported.
 *
 * WHY THIS EXISTS. Every gated route in this product refused with a bare 403
 * and wrote NOTHING, so a clerk probing fifty screens they cannot reach left
 * zero rows — the reconnaissance half of an insider fraud was invisible, and
 * the refusal is itself a free oracle over the org's authority map, which is
 * exactly what makes the probing worth seeing.
 *
 * WHY IT RIDES ON THE REQUEST rather than in a module-level variable. The
 * first version of this was a process-wide singleton, on the reasoning that a
 * cross-cutting concern should not change the signature of ~68 route
 * factories. It was wrong for the reason a second backend is always the reason:
 * the security scenarios build a SECOND `createBackend` to exercise the LAN
 * mount, which replaced the reporter with one bound to that app's audit sink
 * and then closed it — after which every refusal on the first app was written
 * into a closed store and vanished. The suite caught it. One app, one reporter,
 * carried on the context the app already sets.
 *
 * Absent in any app that mounts no audit sink, in which case refusals are
 * simply not reported — never an error, and never a 500 on a legitimate 403.
 */
export interface PermissionRefusal {
  readonly userId: string;
  readonly permission: string;
  readonly method: string;
  readonly path: string;
  readonly authenticated: boolean;
}

export type PermissionRefusalReporter = (refusal: PermissionRefusal) => void;

const REFUSAL_REPORTER_KEY = "permissionRefusalReporter";

/**
 * Middleware that binds a refusal reporter to every request this app serves.
 * Mounted by `createApp`; there is no other way to install one.
 */
export function permissionRefusalReporting(report: PermissionRefusalReporter): MiddlewareHandler {
  return async function bindRefusalReporter(c, next) {
    c.set(REFUSAL_REPORTER_KEY, report);
    await next();
  };
}

function refuse(c: Context, ctx: AuthContext, permission: string) {
  const report = c.get(REFUSAL_REPORTER_KEY) as PermissionRefusalReporter | undefined;
  if (!report) return;
  try {
    report({
      userId: ctx.userId,
      permission,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      authenticated: ctx.authenticated,
    });
  } catch {
    // A forensic write must never turn a legitimate refusal into a 500.
  }
}

/**
 * The 403 a route should answer with for `permission`'s module, or `null` when
 * it is licensed (or licensing cannot be determined, e.g. no entitlements
 * bound, or an unrecognized code).
 *
 * For a route that authorizes inline rather than through `createPermissionGate`
 * — the permission code is only known once an entity is in hand, e.g.
 * `attachments-routes.ts` — call this before the `can()` check it already
 * does, so the module axis is checked everywhere a permission is.
 */
export function moduleRefusalFor(c: Context, permission: string): Response | null {
  const entitlements = c.get("entitlements");
  const permissionDef = getPermission(permission);
  if (!entitlements || !permissionDef || isModuleLicensed(permissionDef.module, entitlements)) return null;
  // A module the tenant once held reads and exports normally and refuses
  // writes by name (DEC-31 rule 5); only one it never had is a flat 403.
  const readOnly = readOnlyModuleOutcome(entitlements, entitlementModuleOf(permissionDef.module), c.req.method);
  if (readOnly === null) return null;
  if (readOnly) return c.json(readOnly, 403);
  return c.json(moduleRefusal(permissionDef.module), 403);
}

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
export function displacedSessionRefusal(c: Parameters<MiddlewareHandler>[0]): Response | null {
  if (!sessionWasDisplaced(c)) return null;
  c.header(SESSION_ENDED_HEADER, SessionEnded.Displaced);
  return c.json(
    { error: "SESSION_DISPLACED", message: "سجّل مستخدم آخر الدخول على هذا الجهاز، فانتهت جلستك هنا. سجّل الدخول من جديد للمتابعة." },
    401,
  );
}

export function unauthenticated(c: Parameters<MiddlewareHandler>[0]) {
  const displaced = displacedSessionRefusal(c);
  if (displaced) return displaced;
  return c.json(
    { error: "SESSION_EXPIRED", message: "انتهت الجلسة. سجّل الدخول من جديد." },
    401,
  );
}

/**
 * A gate that asks only "is this somebody?" — no permission code.
 *
 * For routes whose authority IS the session: a till reporting its own device,
 * a stream it subscribes to for itself. Without it such a route had to either
 * invent a permission nobody is granted, or stay open to the network.
 */
export function createAuthenticatedGate(resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  return async function authenticatedGate(c, next) {
    const ctx = await resolveAuthContext(c);
    if (!ctx.authenticated) return unauthenticated(c);
    c.set(AUTH_CONTEXT_KEY, ctx);
    await next();
  };
}

export interface PermissionDeniedBody {
  readonly error: "PERMISSION_DENIED";
  readonly permission: string;
  readonly message: string;
  readonly messageEn: string;
}

export function permissionDeniedBody(permission: string): PermissionDeniedBody {
  return {
    error: "PERMISSION_DENIED",
    permission,
    message: `هذا الإجراء يتطلب صلاحية «${permissionHumanLabel(permission, PermissionLabelLocale.Ar)}» غير المتاحة لحسابك.`,
    messageEn: `This action needs the “${permissionHumanLabel(permission, PermissionLabelLocale.En)}” permission, which your account does not have.`,
  };
}

export function createPermissionGate(resolveAuthContext: AuthContextResolver) {
  return function gate(permission: string): MiddlewareHandler {
    return async function permissionGate(c, next) {
      const ctx = await resolveAuthContext(c);
      if (!ctx.authenticated) return unauthenticated(c);
      const moduleResponse = moduleRefusalFor(c, permission);
      if (moduleResponse) {
        refuse(c, ctx, permission);
        return moduleResponse;
      }
      if (!can(ctx, permission)) {
        refuse(c, ctx, permission);
        return c.json(permissionDeniedBody(permission), 403);
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
      const moduleResponses = permissions.map((permission) => moduleRefusalFor(c, permission));
      const everyModuleUnlicensed = moduleResponses.length > 0 && moduleResponses.every((response) => response !== null);
      if (everyModuleUnlicensed) {
        refuse(c, ctx, permissions[0] ?? "");
        return moduleResponses[0]!;
      }
      if (!permissions.some((permission) => can(ctx, permission))) {
        refuse(c, ctx, permissions[0] ?? "");
        return c.json(permissionDeniedBody(permissions[0] ?? ""), 403);
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
  return roleCodesOf(getAuthContext(c));
}

/**
 * The same answer, from an AuthContext the caller already has.
 *
 * `callerRoleCodes` reads the context the GATE stashes, so on an ungated route
 * it answers `[]` however the caller is signed in — which silently killed the
 * tenant-admin bypass on `POST /workflow/requests` and held an admin's own
 * submission بانتظار الموافقة (D69). A route that resolves its own identity
 * uses this instead.
 */
export function roleCodesOf(ctx: AuthContext | undefined): string[] {
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
