/**
 * AuthContext — the identity + authority object the adapter builds and hands to
 * the domain (docs/plan.md §3.3). Its permission checks are identical in both
 * editions: cloud derives it from JWT claims, desktop from the local user store.
 *
 * Two orthogonal dimensions, exactly as the catalog documents (§add-user form):
 *   - WHAT a role permits (`permissions`, three-tier visibility), and
 *   - WHERE it may act (`branchScope` / `warehouseScope`).
 */

import { WILDCARD_PERMISSION } from "./catalog.js";
import { resolvePermissions } from "./resolve.js";

/**
 * A scope selection: either every entity (`"*"`, e.g. the "all warehouses"
 * default in the top-bar selector) or an explicit allow-list of ids.
 */
export type ScopeSelection = typeof ALL_SCOPE | readonly string[];

/** Sentinel for "all branches / all warehouses". */
export const ALL_SCOPE = "*" as const;

export interface AuthContextInput {
  readonly userId: string;
  /** Raw granted permission codes (pre dependency-resolution). `"*"` = admin. */
  readonly permissions: Iterable<string>;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
}

export interface AuthContext {
  readonly userId: string;
  /** Dependency-resolved effective permission set. */
  readonly permissions: ReadonlySet<string>;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
}

export interface ScopeQuery {
  readonly branch?: string;
  readonly warehouse?: string;
}

/**
 * Builds an `AuthContext`, resolving the granted permissions to their transitive
 * closure so downstream `can()` calls are a flat membership test.
 */
export function createAuthContext(input: AuthContextInput): AuthContext {
  return {
    userId: input.userId,
    permissions: resolvePermissions(input.permissions),
    branchScope: input.branchScope,
    warehouseScope: input.warehouseScope,
  };
}

/** True for a tenant admin (holds the `"*"` wildcard) — bypasses every gate. */
export function isTenantAdmin(ctx: AuthContext): boolean {
  return ctx.permissions.has(WILDCARD_PERMISSION);
}

function inScope(scope: ScopeSelection, id: string): boolean {
  return scope === ALL_SCOPE || scope.includes(id);
}

/**
 * The core authorization check: does this context hold `permission`, and — when
 * a branch/warehouse is supplied — may it act in that location?
 *
 * Tenant admins (`"*"`) pass unconditionally, including all scopes. Otherwise
 * the permission must be in the resolved set AND every supplied scope dimension
 * must be within the context's allow-list.
 */
export function can(
  ctx: AuthContext,
  permission: string,
  scope?: ScopeQuery,
): boolean {
  if (isTenantAdmin(ctx)) return true;
  if (!ctx.permissions.has(permission)) return false;
  if (scope?.branch !== undefined && !inScope(ctx.branchScope, scope.branch)) {
    return false;
  }
  if (
    scope?.warehouse !== undefined &&
    !inScope(ctx.warehouseScope, scope.warehouse)
  ) {
    return false;
  }
  return true;
}

/**
 * The highest visibility tier a context holds for an entity prefix
 * (e.g. `"sales.invoice"`), collapsing the three-tier model into a single
 * answer: cross-branch (`view_all`) > in-scope (`view`) > own-only (`view_own`)
 * > none. Admins always see `"all"`.
 */
export function visibilityTier(
  ctx: AuthContext,
  entityPrefix: string,
): "all" | "in_scope" | "own" | "none" {
  if (isTenantAdmin(ctx)) return "all";
  if (ctx.permissions.has(`${entityPrefix}.view_all`)) return "all";
  if (ctx.permissions.has(`${entityPrefix}.view`)) return "in_scope";
  if (ctx.permissions.has(`${entityPrefix}.view_own`)) return "own";
  return "none";
}
